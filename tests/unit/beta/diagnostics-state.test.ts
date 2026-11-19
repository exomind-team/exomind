import { describe, expect, it, vi } from 'vitest';
import {
  appendDiagnosticSample,
  buildDiagnosticsExport,
  createEmptyDiagnosticsHistory,
  MAX_DIAGNOSTICS_EXPORT_BYTES,
  MAX_DIAGNOSTIC_SAMPLES,
  metricTrendSegments,
  triggerDiagnosticsDownload,
} from '@/beta/diagnostics-state';
import type { BetaDiagnosticsSample, DiagnosticReason, MetricUnit, ProcessMetric } from '@/beta/diagnostics-client';

const LIFECYCLE = 'a6f9f700-015d-4f11-8000-100000000001';

function metric<T>(
  value: T | null,
  unit: MetricUnit,
  availability: 'available' | 'unknown',
  reason: DiagnosticReason | null,
): ProcessMetric<T> {
  if (availability === 'available' && value !== null && reason === null) {
    return { value, unit, availability: 'available', reason: null };
  }
  if (availability === 'unknown' && value === null && reason !== null) {
    return { value: null, unit, availability: 'unknown', reason };
  }
  throw new Error('invalid diagnostic metric fixture');
}

function sample(overrides: {
  deviceId?: string;
  runtimeId?: string;
  lifecycle?: string;
  monotonicElapsedNs?: string;
  sampledAtUnixMs?: number;
  cpu?: number | null;
  memory?: number | null;
} = {}): BetaDiagnosticsSample {
  const cpu = overrides.cpu === undefined || overrides.cpu === null
    ? metric<number>(null, 'cpu_cores', 'unknown', 'initial_sample')
    : metric(overrides.cpu, 'cpu_cores', 'available', null);
  const memory = overrides.memory === undefined
    ? metric(0, 'bytes', 'available', null)
    : overrides.memory === null
      ? metric<number>(null, 'bytes', 'unknown', 'unsupported')
      : metric(overrides.memory, 'bytes', 'available', null);
  return {
    schemaVersion: 1,
    deviceId: overrides.deviceId ?? 'device-a',
    runtimeId: overrides.runtimeId ?? 'runtime-a',
    process: {
      schemaVersion: 1,
      scope: 'native_host_process',
      identity: { pid: 731, collectorLifecycle: overrides.lifecycle ?? LIFECYCLE },
      sampledAtUnixMs: overrides.sampledAtUnixMs ?? 1_795_000_000_000,
      monotonicElapsedNs: overrides.monotonicElapsedNs ?? '1000000000',
      cpu: {
        cumulativeTime: metric('1000000000', 'nanoseconds', 'available', null),
        usageCores: cpu,
        measurementWindow: metric('5000000000', 'nanoseconds', 'available', null),
      },
      memory: {
        workingSetBytes: memory,
        privateBytes: metric<number>(null, 'bytes', 'unknown', 'unsupported'),
      },
    },
  };
}

describe('Beta diagnostics bounded history and local export', () => {
  it('keeps a real zero distinct from unknown and retains the first sample without inventing a rate', () => {
    const initial = sample({ cpu: null, memory: 0 });
    const result = appendDiagnosticSample(createEmptyDiagnosticsHistory(), initial);
    expect(result.kind).toBe('appended');
    expect(result.history.samples).toHaveLength(1);
    expect(result.history.samples[0].process.cpu.usageCores).toMatchObject({ value: null, availability: 'unknown' });
    expect(result.history.samples[0].process.memory.workingSetBytes).toMatchObject({ value: 0, availability: 'available' });
    expect(metricTrendSegments(result.history.samples, 'cpu_usage_cores')).toEqual([]);
    expect(metricTrendSegments(result.history.samples, 'working_set_bytes')).toHaveLength(1);
  });

  it('starts a new ring when device, runtime, pid, or collector lifecycle changes', () => {
    let history = appendDiagnosticSample(createEmptyDiagnosticsHistory(), sample()).history;
    history = appendDiagnosticSample(history, sample({ monotonicElapsedNs: '2000000000' })).history;
    for (const next of [
      sample({ deviceId: 'device-b', monotonicElapsedNs: '3000000000' }),
      sample({ runtimeId: 'runtime-b', monotonicElapsedNs: '3000000000' }),
      sample({ lifecycle: 'b6f9f700-015d-4f11-8000-100000000002', monotonicElapsedNs: '3000000000' }),
      { ...sample({ monotonicElapsedNs: '3000000000' }), process: { ...sample().process, identity: { ...sample().process.identity, pid: 732 } } },
    ]) {
      const reset = appendDiagnosticSample(history, next);
      expect(reset.kind).toBe('scope_reset');
      expect(reset.history.samples).toEqual([next]);
      expect(reset.history.scope).toMatchObject({ deviceId: next.deviceId, runtimeId: next.runtimeId, pid: next.process.identity.pid });
    }
  });

  it('rejects duplicate and out-of-order monotonic samples without reordering the ring', () => {
    let history = createEmptyDiagnosticsHistory();
    history = appendDiagnosticSample(history, sample({ monotonicElapsedNs: '5000000000' })).history;
    const duplicate = appendDiagnosticSample(history, sample({ monotonicElapsedNs: '5000000000', cpu: 9 }));
    const late = appendDiagnosticSample(history, sample({ monotonicElapsedNs: '4000000000', cpu: 7 }));
    expect(duplicate.kind).toBe('out_of_order');
    expect(late.kind).toBe('out_of_order');
    expect(late.history.samples).toHaveLength(1);
    expect(late.history.samples[0].process.cpu.usageCores.value).toBeNull();
  });

  it('evicts the oldest item at the fixed 180-sample capacity', () => {
    let history = createEmptyDiagnosticsHistory();
    for (let index = 0; index <= MAX_DIAGNOSTIC_SAMPLES; index += 1) {
      history = appendDiagnosticSample(history, sample({
        monotonicElapsedNs: String(BigInt(index + 1) * 5_000_000_000n),
        sampledAtUnixMs: 1_795_000_000_000 + index * 5_000,
        cpu: index,
      })).history;
    }
    expect(history.samples).toHaveLength(180);
    expect(history.samples[0].process.monotonicElapsedNs).toBe('10000000000');
    expect(history.samples[history.samples.length - 1]?.process.monotonicElapsedNs).toBe('905000000000');
  });

  it('draws separate trend segments around missing samples and long observation gaps', () => {
    const samples = [
      sample({ monotonicElapsedNs: '1000000000', cpu: 0 }),
      sample({ monotonicElapsedNs: '6000000000', cpu: 0.5 }),
      sample({ monotonicElapsedNs: '11000000000', cpu: null }),
      sample({ monotonicElapsedNs: '16000000000', cpu: 1 }),
      sample({ monotonicElapsedNs: '46000000000', cpu: 2 }),
    ];
    const segments = metricTrendSegments(samples, 'cpu_usage_cores');
    expect(segments.map(segment => segment.map(point => point.value))).toEqual([[0, 0.5], [1], [2]]);
    expect(segments[0][1].elapsedMs).toBe(5_000);
  });

  it('exports only allowlisted local fields and trims old samples to the fixed byte budget', () => {
    let history = createEmptyDiagnosticsHistory();
    for (let index = 0; index < MAX_DIAGNOSTIC_SAMPLES; index += 1) {
      const entry = sample({
        monotonicElapsedNs: String(BigInt(index + 1) * 5_000_000_000n),
        sampledAtUnixMs: 1_795_000_000_000 + index * 5_000,
        deviceId: 'd'.repeat(128),
        runtimeId: 'r'.repeat(128),
        cpu: index / 10,
      });
      history = appendDiagnosticSample(history, entry).history;
    }
    const base = history.samples[history.samples.length - 1];
    const malicious = {
      ...base,
      invitation: 'synthetic-invitation-secret',
      path: 'C:/private/profile',
      businessText: 'synthetic private note',
      process: { ...base.process, privatePath: 'C:/private/file', error: { message: 'synthetic token' } },
    } as unknown as BetaDiagnosticsSample;
    const built = buildDiagnosticsExport({
      snapshot: malicious,
      history,
      exportedAtUnixMs: 1_795_000_123_000,
      storage: null,
    });
    expect(built.bytes).toBeLessThanOrEqual(MAX_DIAGNOSTICS_EXPORT_BYTES);
    expect(built.payload.history.availableSampleCount).toBe(MAX_DIAGNOSTIC_SAMPLES);
    expect(built.payload.history.samples[0].monotonicElapsedNs).not.toBe(history.samples[0].process.monotonicElapsedNs);
    expect(built.payload.history.samples[built.payload.history.samples.length - 1]?.monotonicElapsedNs).toBe(history.samples[history.samples.length - 1]?.process.monotonicElapsedNs);
    for (const forbidden of ['synthetic-invitation-secret', 'C:/private/profile', 'synthetic private note', 'businessText', 'privatePath', 'synthetic token']) {
      expect(built.json).not.toContain(forbidden);
    }
    expect(built.payload.snapshot.cpu.cumulativeTime.value).toBe('1000000000');
    expect(built.payload.history.window.elapsedNs).toBeTruthy();
    expect(built.payload.history.exportedSampleCount).toBeLessThanOrEqual(MAX_DIAGNOSTIC_SAMPLES);
  });

  it('reports missing browser download capabilities and revokes an object URL after a local download', () => {
    expect(triggerDiagnosticsDownload('{}', {})).toEqual({ ok: false, reason: 'unsupported' });
    const click = vi.fn();
    const remove = vi.fn();
    const revoke = vi.fn();
    let scheduled: (() => void) | undefined;
    const result = triggerDiagnosticsDownload('{}', {
      createObjectURL: () => 'blob:diagnostics',
      revokeObjectURL: revoke,
      createAnchor: () => ({ href: '', download: '', click, remove }),
      scheduleRevoke: callback => { scheduled = callback; },
    });
    expect(result).toEqual({ ok: true });
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    scheduled?.();
    expect(revoke).toHaveBeenCalledWith('blob:diagnostics');
  });
});
