import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInfo = vi.fn();
const mockError = vi.fn();

vi.mock('@/lib/logger', () => ({
  log: {
    info: mockInfo,
    error: mockError,
  },
}));

function installStorageStub(storage: Record<string, string>): void {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (key in storage ? storage[key] : null),
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        for (const key of Object.keys(storage)) {
          delete storage[key];
        }
      },
      key: (index: number) => Object.keys(storage)[index] ?? null,
      get length() {
        return Object.keys(storage).length;
      },
    },
  });
}

describe('PerfTrace（性能追踪日志）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    mockInfo.mockReset();
    mockError.mockReset();
    storage = {};
    installStorageStub(storage);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('suppresses finish info logs when perf logging is disabled（关闭时不输出 finish info 日志）', async () => {
    const { PerfTrace } = await import('@/lib/utils/perf-trace');

    const trace = new PerfTrace('PerfTrace disabled');
    trace.finish({ phase: 'disabled' });

    expect(mockInfo).not.toHaveBeenCalled();
  });

  it('emits finish info logs when perf logging is enabled（开启时输出 finish info 日志）', async () => {
    const perfLoggingModule = await import('@/config/perf-logging-enabled');
    perfLoggingModule.setPerfLoggingEnabled(true);

    const { PerfTrace } = await import('@/lib/utils/perf-trace');
    const trace = new PerfTrace('PerfTrace enabled');
    trace.finish({ phase: 'enabled' });

    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo.mock.calls[0][0]).toContain('[PERF]');
    expect(mockInfo.mock.calls[0][0]).toContain('PerfTrace enabled');
  });

  it('keeps fail error logs even when perf logging is disabled（关闭时仍保留 fail error 日志）', async () => {
    const { PerfTrace } = await import('@/lib/utils/perf-trace');

    const trace = new PerfTrace('PerfTrace fail');
    trace.fail(new Error('boom'), { phase: 'failure' });

    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockError.mock.calls[0][0]).toContain('[PERF]');
    expect(mockError.mock.calls[0][0]).toContain('failed');
    expect(mockInfo).not.toHaveBeenCalled();
  });
});
