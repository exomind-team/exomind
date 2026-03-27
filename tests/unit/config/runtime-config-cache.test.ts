import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

describe('runtime config cache（Runtime 配置缓存）', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
    originalFetch = globalThis.fetch;
    isTauriMock.mockResolvedValue(false);
    invokeMock.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 9124,
      authSecret: 'secret-123',
    });
  });

  afterEach(async () => {
    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
    if (originalFetch) {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it('bootstraps from embedded runtime and imports same-origin local entries（启动时导入同源旧设置）', async () => {
    window.localStorage.setItem('exomind:themePreference', 'dark');
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, skipped: 0, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:themePreference', value: 'dark' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(true);
    expect(cacheModule.getRuntimeConfigValueSync('exomind:themePreference')).toBe('dark');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/config/import/frontend');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/config?scope=user');
  });

  it('falls back to localStorage when runtime transport is unavailable（Runtime 不可用时回退本地存储）', async () => {
    window.localStorage.setItem('exomind:inputSendMode', 'enter-send');
    isTauriMock.mockResolvedValue(false);

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);
    expect(cacheModule.getRuntimeConfigValueSync('exomind:inputSendMode')).toBe('enter-send');
  });

  it('set writes runtime and keeps local mirror（写入 Runtime 并保留本地镜像）', async () => {
    isTauriMock.mockResolvedValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        key: 'exomind:voiceShortcutHotkey',
        value: 'Ctrl+Space',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();
    cacheModule.setRuntimeConfigValue('exomind:voiceShortcutHotkey', 'Ctrl+Space', {
      source: 'test',
    });
    await Promise.resolve();

    expect(window.localStorage.getItem('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/config/exomind%3AvoiceShortcutHotkey');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('PUT');
  });

  it('remove deletes runtime and local mirror（删除 Runtime 与本地镜像）', async () => {
    window.localStorage.setItem('moss_api_key', 'sk-old');
    isTauriMock.mockResolvedValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, skipped: 0, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'moss_api_key', value: 'sk-old' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();
    cacheModule.removeRuntimeConfigValue('moss_api_key');
    await Promise.resolve();

    expect(window.localStorage.getItem('moss_api_key')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/config/moss_api_key?scope=user');
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe('DELETE');
  });
});
