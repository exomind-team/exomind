import { describe, expect, it, vi } from 'vitest';
import { createBetaDiagnosticsClient, type NativeDiagnosticsInvoke } from '@/beta/diagnostics-client';

const LIFECYCLE = 'a6f9f700-015d-4f11-8000-100000000001';
const AREAS = ['host_root', 'core_store', 'native_private_ui', 'local_source_store', 'peer_identity', 'unclassified'];

function metric(value: unknown, unit: string, availability: string, reason: string | null) {
  return { value, unit, availability, reason };
}

function processSample() {
  return {
    schemaVersion: 1,
    scope: 'native_host_process',
    identity: { pid: 731, collectorLifecycle: LIFECYCLE },
    sampledAtUnixMs: 1_795_000_000_000,
    monotonicElapsedNs: '9007199254740993',
    cpu: {
      cumulativeTime: metric('9007199254740993', 'nanoseconds', 'available', null),
      usageCores: metric(null, 'cpu_cores', 'unknown', 'initial_sample'),
      measurementWindow: metric(null, 'nanoseconds', 'unknown', 'initial_sample'),
    },
    memory: {
      workingSetBytes: metric(0, 'bytes', 'available', null),
      privateBytes: metric(null, 'bytes', 'unknown', 'unsupported'),
    },
  };
}

function sampleEnvelope(process: unknown = processSample()) {
  return { schemaVersion: 1, deviceId: 'device-a', runtimeId: 'runtime-a', process };
}

function storageReport() {
  return {
    schemaVersion: 1,
    scope: 'native_provided_host_root',
    recursiveWithoutLinks: true,
    status: 'partial',
    partialReasons: ['budget_exceeded'],
    startedAtUnixMs: 1_795_000_000_000,
    finishedAtUnixMs: 1_795_000_000_001,
    elapsedNs: '9007199254740993',
    appliedBudget: {
      maxEntries: 4096,
      maxFiles: 4096,
      maxDirectories: 256,
      maxLogicalBytes: 68_719_476_736,
      maxElapsedMs: 250,
    },
    entriesExamined: 3,
    directoriesExamined: 1,
    filesExamined: 2,
    skippedLinkEntries: 0,
    skippedSpecialEntries: 0,
    logicalBytesCounted: 12,
    areas: AREAS.map(area => ({ area, fileCount: 0, directoryCount: 0, logicalBytesCounted: 0 })),
  };
}

describe('Beta local diagnostics Native client boundary', () => {
  it('reports missing capability outside Tauri and does not start a fallback client', () => {
    const invoke = vi.fn(async () => sampleEnvelope());
    expect(createBetaDiagnosticsClient({ isTauri: () => false, invoke })).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('calls only the fixed Native commands and preserves decimal nanoseconds exactly', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'beta_diagnostics_sample') return sampleEnvelope();
      if (command === 'beta_diagnostics_storage') return {
        schemaVersion: 1, deviceId: 'device-a', runtimeId: 'runtime-a', scanId: 'scan-a', storage: storageReport(),
      };
      return { scanId: 'scan-a', cancellationRequested: true };
    });
    const client = createBetaDiagnosticsClient({ isTauri: () => true, invoke: invoke as NativeDiagnosticsInvoke });
    expect(client).not.toBeNull();

    const sample = await client!.sample();
    expect(invoke).toHaveBeenNthCalledWith(1, 'beta_diagnostics_sample');
    expect(sample.process.monotonicElapsedNs).toBe('9007199254740993');
    expect(sample.process.cpu.cumulativeTime.value).toBe('9007199254740993');
    expect(sample.process.cpu.usageCores).toMatchObject({ value: null, unit: 'cpu_cores', availability: 'unknown', reason: 'initial_sample' });
    expect(sample.process.memory.workingSetBytes).toMatchObject({ value: 0, availability: 'available' });
    expect(sample.process.memory.privateBytes).toMatchObject({ value: null, reason: 'unsupported' });

    const scan = await client!.scanStorage('scan-a');
    expect(invoke).toHaveBeenNthCalledWith(2, 'beta_diagnostics_storage', { scanId: 'scan-a' });
    expect(scan.storage.elapsedNs).toBe('9007199254740993');
    expect(scan.storage.logicalBytesCounted).toBe(12);
    expect(await client!.cancelStorage('scan-a')).toEqual({ scanId: 'scan-a', cancellationRequested: true });
    expect(invoke).toHaveBeenNthCalledWith(3, 'beta_diagnostics_storage_cancel', { scanId: 'scan-a' });
  });

  it('rejects unsafe nanosecond numbers, non-decimal strings, invalid units, and unknown error-bearing fields', async () => {
    const badProcesses = [
      { ...processSample(), monotonicElapsedNs: Number.MAX_SAFE_INTEGER + 1 },
      { ...processSample(), monotonicElapsedNs: '09007199254740993' },
      { ...processSample(), cpu: { ...processSample().cpu, cumulativeTime: metric('9007199254740993', 'bytes', 'available', null) } },
      { ...processSample(), memory: { ...processSample().memory, workingSetBytes: metric(Number.MAX_SAFE_INTEGER + 1, 'bytes', 'available', null) } },
      { ...processSample(), privatePath: 'synthetic/private/path' },
    ];
    for (const process of badProcesses) {
      const client = createBetaDiagnosticsClient({ isTauri: () => true, invoke: async () => sampleEnvelope(process) });
      await expect(client!.sample()).rejects.toMatchObject({ code: 'invalid_response' });
    }
    const unsafeIdentity = createBetaDiagnosticsClient({ isTauri: () => true, invoke: async () => ({
      ...sampleEnvelope(), deviceId: 'C:/private/profile',
    }) });
    await expect(unsafeIdentity!.sample()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('requires the storage response to match the retained request identity and safe counter range', async () => {
    const wrongId = createBetaDiagnosticsClient({ isTauri: () => true, invoke: async () => ({
      schemaVersion: 1, deviceId: 'device-a', runtimeId: 'runtime-a', scanId: 'different-scan', storage: storageReport(),
    }) });
    await expect(wrongId!.scanStorage('scan-a')).rejects.toMatchObject({ code: 'invalid_response' });

    const unsafeCount = storageReport();
    unsafeCount.logicalBytesCounted = Number.MAX_SAFE_INTEGER + 1;
    const badCount = createBetaDiagnosticsClient({ isTauri: () => true, invoke: async () => ({
      schemaVersion: 1, deviceId: 'device-a', runtimeId: 'runtime-a', scanId: 'scan-a', storage: unsafeCount,
    }) });
    await expect(badCount!.scanStorage('scan-a')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('does not expose arbitrary Native error text through client failures', async () => {
    const client = createBetaDiagnosticsClient({ isTauri: () => true, invoke: async () => {
      throw new Error('token=synthetic-secret path=C:/private/data');
    } });
    const error = await client!.sample().then(() => null, failure => failure as Error & { code?: string });
    expect(error).toMatchObject({ code: 'request_failed' });
    expect(error?.message).not.toMatch(/synthetic-secret|private\/data/);
  });
});
