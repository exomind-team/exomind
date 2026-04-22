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

describe('eventlog markdown mirror enabled（事件日志 Markdown 镜像开关）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    storage = {};
    installStorageStub(storage);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('defaults to enabled and prefers runtime-backed value（默认开启且优先读取 Runtime 值）', async () => {
    storage['exomind:eventlogMarkdownMirrorEnabled'] = 'true';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'exomind:eventlogMarkdownMirrorEnabled': 'false',
    });

    const module = await import('@/config/eventlog-markdown-mirror-enabled');

    expect(module.getEventlogMarkdownMirrorEnabled()).toBe(false);
  });

  it('writes through runtime-preferred storage（通过 Runtime 优先存储写入）', async () => {
    const module = await import('@/config/eventlog-markdown-mirror-enabled');

    expect(module.setEventlogMarkdownMirrorEnabled(false)).toBeUndefined();
    expect(storage[module.EVENTLOG_MARKDOWN_MIRROR_ENABLED_STORAGE_KEY]).toBe('false');
    expect(module.getEventlogMarkdownMirrorEnabled()).toBe(false);
  });
});
