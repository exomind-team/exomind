import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaDiagnosticsEntry, BetaDiagnosticsPanel } from '@/beta/BetaDiagnosticsPanel';
import type {
  BetaDiagnosticsClient,
  BetaDiagnosticsSample,
  BetaDiagnosticsStorageEnvelope,
  DiagnosticReason,
  MetricUnit,
  ProcessMetric,
  StorageScanReport,
} from '@/beta/diagnostics-client';
import { deferred } from './fixtures';

const LIFECYCLE = 'a6f9f700-015d-4f11-8000-100000000001';
const AREAS: StorageScanReport['areas'] = [
  'host_root', 'core_store', 'native_private_ui', 'local_source_store', 'peer_identity', 'unclassified',
].map(area => ({ area: area as StorageScanReport['areas'][number]['area'], fileCount: 0, directoryCount: 0, logicalBytesCounted: 0 }));

function sample(overrides: { deviceId?: string; runtimeId?: string; cpu?: number | null; memory?: number | null } = {}): BetaDiagnosticsSample {
  const metric = <T,>(
    value: T | null,
    unit: MetricUnit,
    availability: 'available' | 'unknown',
    reason: DiagnosticReason | null,
  ): ProcessMetric<T> => {
    if (availability === 'available' && value !== null && reason === null) {
      return { value, unit, availability: 'available', reason: null };
    }
    if (availability === 'unknown' && value === null && reason !== null) {
      return { value: null, unit, availability: 'unknown', reason };
    }
    throw new Error('invalid diagnostic metric fixture');
  };
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
      identity: { pid: 731, collectorLifecycle: LIFECYCLE },
      sampledAtUnixMs: 1_795_000_000_000,
      monotonicElapsedNs: '1000000000',
      cpu: {
        cumulativeTime: metric('1000000000', 'nanoseconds', 'available', null),
        usageCores: cpu,
        measurementWindow: metric(cpu.value === null ? null : '5000000000', 'nanoseconds', cpu.value === null ? 'unknown' : 'available', cpu.value === null ? 'initial_sample' : null),
      },
      memory: { workingSetBytes: memory, privateBytes: metric<number>(null, 'bytes', 'unknown', 'unsupported') },
    },
  };
}

function storageReport(bytes: number, scanId = 'scan-ui'): BetaDiagnosticsStorageEnvelope {
  return {
    schemaVersion: 1,
    deviceId: 'device-a',
    runtimeId: 'runtime-a',
    scanId,
    storage: {
      schemaVersion: 1,
      scope: 'native_provided_host_root',
      recursiveWithoutLinks: true,
      status: 'partial',
      partialReasons: ['cancelled'],
      startedAtUnixMs: 1_795_000_000_000,
      finishedAtUnixMs: 1_795_000_000_001,
      elapsedNs: '1000000',
      appliedBudget: { maxEntries: 4096, maxFiles: 4096, maxDirectories: 256, maxLogicalBytes: 68_719_476_736, maxElapsedMs: 250 },
      entriesExamined: 1,
      directoriesExamined: 1,
      filesExamined: 1,
      skippedLinkEntries: 0,
      skippedSpecialEntries: 0,
      logicalBytesCounted: bytes,
      areas: AREAS.map(area => ({ ...area, fileCount: area.area === 'core_store' ? 1 : 0, logicalBytesCounted: area.area === 'core_store' ? bytes : 0 })),
    },
  };
}

function diagnosticsClient(overrides: Partial<BetaDiagnosticsClient> = {}): BetaDiagnosticsClient {
  return {
    sample: vi.fn(async () => sample()),
    scanStorage: vi.fn(async () => storageReport(0)),
    cancelStorage: vi.fn(async (scanId: string) => ({ scanId, cancellationRequested: true })),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Beta runtime diagnostics panel', () => {
  it('collects only after opening the entry and closes observation when leaving Settings', async () => {
    const client = diagnosticsClient();
    const view = render(<BetaDiagnosticsEntry client={client} visible />);
    await act(async () => { await Promise.resolve(); });
    expect(client.sample).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看运行诊断' }));
    await waitFor(() => expect(client.sample).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '开始观察' }));
    view.rerender(<BetaDiagnosticsEntry client={client} visible={false} />);
    view.rerender(<BetaDiagnosticsEntry client={client} visible />);
    expect(screen.queryByRole('dialog', { name: '运行诊断' })).not.toBeInTheDocument();
    expect(client.sample).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '查看运行诊断' }));
    await waitFor(() => expect(client.sample).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: '开始观察' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭运行诊断' }));
    expect(screen.queryByRole('dialog', { name: '运行诊断' })).not.toBeInTheDocument();
  });

  it('reads one explicit-on-open snapshot and distinguishes unknown CPU from a measured zero', async () => {
    const client = diagnosticsClient();
    render(<BetaDiagnosticsPanel client={client} visible />);

    expect(await screen.findByRole('heading', { name: '运行诊断' })).toBeInTheDocument();
    await waitFor(() => expect(client.sample).toHaveBeenCalledTimes(1));
    const cpu = screen.getByRole('group', { name: 'CPU' });
    const memory = screen.getByRole('group', { name: '进程常驻内存' });
    expect(within(cpu).getByText('未知')).toBeInTheDocument();
    expect(within(memory).getByText('0 B')).toBeInTheDocument();
    expect(memory).toHaveClass('min-w-0');
    expect(screen.getByText(/不包含 WebView、GPU、其他进程或设备功耗/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '扫描存储' })).toBeEnabled();
    expect(client.scanStorage).not.toHaveBeenCalled();
  });

  it('requires an explicit start, uses one five-second scheduler, pauses, and does not auto-resume after hide', async () => {
    vi.useFakeTimers();
    const client = diagnosticsClient();
    const view = render(<BetaDiagnosticsPanel client={client} visible />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(client.sample).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(client.sample).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '开始观察' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(client.sample).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(client.sample).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('button', { name: '暂停观测' }));
    expect(screen.getByRole('button', { name: '暂停观测' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(client.sample).toHaveBeenCalledTimes(3);

    view.rerender(<BetaDiagnosticsPanel client={client} visible={false} />);
    view.rerender(<BetaDiagnosticsPanel client={client} visible />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(client.sample).toHaveBeenCalledTimes(4);
    expect(screen.getByRole('button', { name: '开始观察' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(client.sample).toHaveBeenCalledTimes(4);
  });

  it('never overlaps a slow sample and waits five seconds after it completes', async () => {
    vi.useFakeTimers();
    const delayed = deferred<BetaDiagnosticsSample>();
    const sampleCall = vi.fn()
      .mockResolvedValueOnce(sample())
      .mockReturnValueOnce(delayed.promise)
      .mockResolvedValue(sample({ cpu: 0.25 }));
    const client = diagnosticsClient({ sample: sampleCall });
    render(<BetaDiagnosticsPanel client={client} visible />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: '开始观察' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(client.sample).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(client.sample).toHaveBeenCalledTimes(2);

    await act(async () => { delayed.resolve(sample({ cpu: 0.5 })); await delayed.promise; });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(client.sample).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(client.sample).toHaveBeenCalledTimes(3);
  });

  it('ignores a late snapshot after the panel leaves its attention scope', async () => {
    const delayed = deferred<BetaDiagnosticsSample>();
    const client = diagnosticsClient({ sample: vi.fn().mockReturnValueOnce(delayed.promise).mockResolvedValue(sample({ deviceId: 'current-device' })) });
    const view = render(<BetaDiagnosticsPanel client={client} visible />);
    await waitFor(() => expect(client.sample).toHaveBeenCalledTimes(1));
    view.rerender(<BetaDiagnosticsPanel client={client} visible={false} />);
    await act(async () => { delayed.resolve(sample({ deviceId: 'stale-device' })); await delayed.promise; });
    view.rerender(<BetaDiagnosticsPanel client={client} visible />);
    await waitFor(() => expect(client.sample).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '展开本机详情' }));
    await waitFor(() => expect(screen.getByText('current-device')).toBeInTheDocument());
    expect(screen.queryByText('stale-device')).not.toBeInTheDocument();
  });

  it('keeps a storage request id through cancellation and ignores its late report after reopening', async () => {
    const first = deferred<BetaDiagnosticsStorageEnvelope>();
    const second = deferred<BetaDiagnosticsStorageEnvelope>();
    const client = diagnosticsClient({
      scanStorage: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    });
    const view = render(<BetaDiagnosticsPanel client={client} visible />);
    await waitFor(() => expect(client.sample).toHaveBeenCalledTimes(1));
    expect(client.scanStorage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '扫描存储' }));
    await waitFor(() => expect(client.scanStorage).toHaveBeenCalledTimes(1));
    const scanId = vi.mocked(client.scanStorage).mock.calls[0][0];
    expect(scanId).toEqual(expect.any(String));
    fireEvent.click(screen.getByRole('button', { name: '请求取消扫描' }));
    await waitFor(() => expect(client.cancelStorage).toHaveBeenCalledWith(scanId));

    view.rerender(<BetaDiagnosticsPanel client={client} visible={false} />);
    view.rerender(<BetaDiagnosticsPanel client={client} visible />);
    await waitFor(() => expect(client.sample).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '扫描存储' }));
    await waitFor(() => expect(client.scanStorage).toHaveBeenCalledTimes(2));
    await act(async () => { first.resolve(storageReport(12, scanId)); await first.promise; });
    expect(screen.queryByText('12 B')).not.toBeInTheDocument();
    const secondScanId = vi.mocked(client.scanStorage).mock.calls[1][0];
    await act(async () => { second.resolve(storageReport(64, secondScanId)); await second.promise; });
    expect(await screen.findByText('64 B')).toBeInTheDocument();
    expect(screen.queryByText('12 B')).not.toBeInTheDocument();
  });

  it('offers an explicit unsupported state and keeps long identities selectable in details', async () => {
    const longDeviceId = 'd'.repeat(128);
    const client = diagnosticsClient({ sample: vi.fn(async () => sample({ deviceId: longDeviceId })) });
    const view = render(<BetaDiagnosticsPanel client={null} visible />);
    expect(screen.getByRole('status')).toHaveTextContent('本机 Native 诊断能力未接入');
    view.rerender(<BetaDiagnosticsPanel client={client} visible />);
    await waitFor(() => expect(screen.getByRole('button', { name: '展开本机详情' })).toBeEnabled());
    expect(screen.getByRole('img', { name: /CPU 进程使用率趋势/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开本机详情' }));
    await waitFor(() => expect(screen.getByText(longDeviceId)).toBeInTheDocument());
    expect(screen.getByText(longDeviceId).closest('code')).toHaveClass('break-all');
    expect(screen.getByRole('button', { name: '复制本机身份' })).toBeInTheDocument();
  });

  it('ignores a late hidden-page sample and does not restart observation when visibility returns', async () => {
    vi.useFakeTimers();
    const delayed = deferred<BetaDiagnosticsSample>();
    const client = diagnosticsClient({ sample: vi.fn().mockResolvedValueOnce(sample()).mockReturnValueOnce(delayed.promise) });
    render(<BetaDiagnosticsPanel client={client} visible />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: '开始观察' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(client.sample).toHaveBeenCalledTimes(2);

    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      fireEvent(document, new Event('visibilitychange'));
      await act(async () => { delayed.reject(new Error('synthetic private native failure')); await delayed.promise.catch(() => {}); });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      fireEvent(document, new Event('visibilitychange'));
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(client.sample).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('button', { name: '开始观察' })).toBeInTheDocument();
    } finally {
      if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
    }
  });
});
