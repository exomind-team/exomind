import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('perf logging enabled（性能跟踪日志开关）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    storage = {};
    installStorageStub(storage);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('defaults to disabled when no value exists（无配置时默认关闭）', async () => {
    const module = await import('@/config/perf-logging-enabled');

    expect(module.getPerfLoggingEnabled()).toBe(false);
  });

  it('prefers runtime-backed value over local storage（优先读取 Runtime 值）', async () => {
    storage['exomind:perfLoggingEnabled'] = 'true';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'exomind:perfLoggingEnabled': 'false',
    });

    const module = await import('@/config/perf-logging-enabled');

    expect(module.getPerfLoggingEnabled()).toBe(false);
  });

  it('writes through runtime-preferred storage（通过 Runtime 优先存储写入）', async () => {
    const module = await import('@/config/perf-logging-enabled');

    expect(module.setPerfLoggingEnabled(true)).toBeUndefined();
    expect(storage[module.PERF_LOGGING_ENABLED_STORAGE_KEY]).toBe('true');
    expect(module.getPerfLoggingEnabled()).toBe(true);
  });
});
