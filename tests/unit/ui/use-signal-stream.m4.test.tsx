import { render, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBEDDED_RUNTIME_STATUS_STORAGE_KEY, setRuntimeTargetMode } from '@/config/runtime-target';

const {
  runtimeStatuses,
  getStatusMock,
  startMock,
  stopMock,
  onSignalMock,
  signalServiceOptions,
  MockSignalStreamService,
} = vi.hoisted(() => {
  const queuedStatuses: RuntimeStatus[] = [];
  const queuedSignalServiceOptions: Array<Record<string, unknown>> = [];
  const queuedGetStatusMock = vi.fn<() => Promise<RuntimeStatus>>(async () => {
    if (queuedStatuses.length === 0) {
      throw new Error('runtime status queue exhausted（运行时状态队列已耗尽）');
    }
    const next = queuedStatuses.shift();
    if (!next) {
      throw new Error('runtime status queue returned empty value（运行时状态队列返回空值）');
    }
    return next;
  });

  const queuedStartMock = vi.fn();
  const queuedStopMock = vi.fn();
  const queuedOnSignalMock = vi.fn(() => () => {});

  class HoistedMockSignalStreamService {
    constructor(options: Record<string, unknown>) {
      queuedSignalServiceOptions.push(options);
    }

    onSignal = queuedOnSignalMock;
    start = queuedStartMock;
    stop = queuedStopMock;
  }

  return {
    runtimeStatuses: queuedStatuses,
    getStatusMock: queuedGetStatusMock,
    startMock: queuedStartMock,
    stopMock: queuedStopMock,
    onSignalMock: queuedOnSignalMock,
    signalServiceOptions: queuedSignalServiceOptions,
    MockSignalStreamService: HoistedMockSignalStreamService,
  };
});

import { useSignalStream } from '@/ui/hooks/useSignalStream';

type RuntimeStatus = {
  running: boolean;
  host: string;
  port: number;
  hostId?: string;
  error?: string;
};

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(async () => true),
  invoke: vi.fn(),
}));

vi.mock('@/lib/services/signal-stream.service', () => ({
  SignalStreamService: MockSignalStreamService,
}));

vi.mock('@/lib/services/signal-handlers', () => ({
  startSignalHandlers: vi.fn(() => async () => {}),
}));

vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: vi.fn(),
  projectEventLogReplicationAppend: vi.fn(async () => 'inserted'),
}));

vi.mock('@/lib/services/ecs-active-block-replication.service', () => ({
  projectActiveBlockReplicationSnapshot: vi.fn(async () => undefined),
}));

vi.mock('@/lib/services/runtime-control.service', () => ({
  getRuntimeControlService: () => ({
    getStatus: getStatusMock,
  }),
}));

function HookHarness(): null {
  useSignalStream();
  return null;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSignalStream m4（SSE Runtime 目标切换）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    runtimeStatuses.length = 0;
    signalServiceOptions.length = 0;
    getStatusMock.mockClear();
    startMock.mockClear();
    stopMock.mockClear();
    onSignalMock.mockClear();
    setRuntimeTargetMode('embedded');
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('waits for embedded runtime to report running before opening SSE（等待内嵌 Runtime 真正运行后再打开 SSE）', async () => {
    window.localStorage.setItem(
      EMBEDDED_RUNTIME_STATUS_STORAGE_KEY,
      JSON.stringify({
        host: '127.0.0.1',
        port: 4077,
      }),
    );
    runtimeStatuses.push(
      {
        running: false,
        host: '127.0.0.1',
        port: 4077,
      },
      {
        running: true,
        host: '127.0.0.1',
        port: 48202,
        hostId: 'desktop-host',
      },
    );

    render(<HookHarness />);
    await flushMicrotasks();

    expect(getStatusMock).toHaveBeenCalledTimes(1);
    expect(signalServiceOptions).toHaveLength(0);
    expect(startMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushMicrotasks();

    expect(getStatusMock).toHaveBeenCalledTimes(2);
    expect(signalServiceOptions).toHaveLength(1);

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(signalServiceOptions[0]).toMatchObject({
      agentId: 'ui',
      host: expect.objectContaining({
        host: '127.0.0.1',
        port: 48202,
        isLocal: true,
      }),
    });
    expect(window.localStorage.getItem(EMBEDDED_RUNTIME_STATUS_STORAGE_KEY)).toContain('"port":48202');
  });
});
