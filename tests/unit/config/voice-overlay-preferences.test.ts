import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
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

async function flushMicrotasks(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe('voice overlay preferences（语音悬浮窗偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    storage = {};
    installStorageStub(storage);
    isTauriMock.mockResolvedValue(false);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('defaults to configured opacity（默认透明度正确）', async () => {
    const module = await import('@/config/voice-overlay-preferences');

    expect(module.getVoiceOverlayOpacity()).toBe(module.DEFAULT_VOICE_OVERLAY_OPACITY);
  });

  it('persists and emits opacity changes（持久化并广播透明度变化）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeVoiceOverlayOpacityChanges(listener);

    expect(module.setVoiceOverlayOpacity(74)).toBe(74);
    expect(storage[module.VOICE_OVERLAY_OPACITY_STORAGE_KEY]).toBe('74');
    expect(listener).toHaveBeenCalledWith(74);

    unsubscribe();
  });

  it('clamps opacity into the expanded range（透明度会落在扩展后的范围内）', async () => {
    const module = await import('@/config/voice-overlay-preferences');

    expect(module.setVoiceOverlayOpacity(999)).toBe(module.MAX_VOICE_OVERLAY_OPACITY);
    expect(module.setVoiceOverlayOpacity(-1)).toBe(module.MIN_VOICE_OVERLAY_OPACITY);
  });

  it('handles storage event updates（支持跨窗口 storage 事件同步）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeVoiceOverlayOpacityChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: module.VOICE_OVERLAY_OPACITY_STORAGE_KEY,
      newValue: '88',
    }));

    expect(listener).toHaveBeenCalledWith(88);
    unsubscribe();
  });

  it('reads runtime-backed overlay preferences before localStorage（优先读取 Runtime 中的语音悬浮窗配置）', async () => {
    storage.exomindVoiceOverlayOpacity = '22';
    storage.exomindVoiceOverlayShowDiagnostics = 'false';
    storage.exomindVoiceOverlayTranscriptLines = '2';
    storage.exomindVoiceOverlayBottomOffset = '40';
    storage['exomind:voiceOverlayOpacity'] = '22';
    storage['exomind:voiceOverlayShowDiagnostics'] = 'false';
    storage['exomind:voiceOverlayTranscriptLines'] = '2';
    storage['exomind:voiceOverlayBottomOffset'] = '40';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'exomind:voiceOverlayOpacity': '84',
      'exomind:voiceOverlayShowDiagnostics': 'true',
      'exomind:voiceOverlayTranscriptLines': '5',
      'exomind:voiceOverlayBottomOffset': '112',
    });

    const module = await import('@/config/voice-overlay-preferences');

    expect(module.getVoiceOverlayOpacity()).toBe(84);
    expect(module.getVoiceOverlayShowDiagnostics()).toBe(true);
    expect(module.getVoiceOverlayTranscriptLines()).toBe(5);
    expect(module.getVoiceOverlayBottomOffset()).toBe(112);
  });

  it('persists opacity through runtime config transport and keeps local mirror（透明度写入 Runtime 并保留本地镜像）', async () => {
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        key: 'exomind:voiceOverlayOpacity',
        value: '74',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    invokeMock.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 9124,
      authSecret: 'secret-123',
    });

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();
    const module = await import('@/config/voice-overlay-preferences');

    expect(module.setVoiceOverlayOpacity(74)).toBe(74);
    await flushMicrotasks();

    expect(storage[module.VOICE_OVERLAY_OPACITY_STORAGE_KEY]).toBe('74');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/config/exomind%3AvoiceOverlayOpacity');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('PUT');
  });

  it('notifies opacity subscribers when retry bootstrap replaces fallback values（重试启动成功后会通知语音悬浮窗订阅者）', async () => {
    vi.useFakeTimers();
    storage['exomind:voiceOverlayOpacity'] = '62';
    isTauriMock.mockResolvedValue(true);

    let runtimeReady = false;
    invokeMock.mockImplementation(async () => {
      if (!runtimeReady) {
        return {
          running: false,
          host: '127.0.0.1',
          port: 9124,
          authSecret: 'secret-123',
        };
      }

      return {
        running: true,
        host: '127.0.0.1',
        port: 9124,
        authSecret: 'secret-123',
      };
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 0, skipped: 1, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:voiceOverlayOpacity', value: '86' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const module = await import('@/config/voice-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeVoiceOverlayOpacityChanges(listener);
    const cacheModule = await import('@/config/runtime-config-cache');

    const bootstrapPromise = cacheModule.bootstrapRuntimeConfig();
    await vi.advanceTimersByTimeAsync(8 * 150);
    await bootstrapPromise;

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);
    expect(module.getVoiceOverlayOpacity()).toBe(62);
    expect(listener).not.toHaveBeenCalled();

    runtimeReady = true;
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(true);
    expect(module.getVoiceOverlayOpacity()).toBe(86);
    expect(listener).toHaveBeenCalledWith(86);

    unsubscribe();
    vi.useRealTimers();
  });

  it('defaults diagnostics visibility to hidden（默认隐藏诊断信息）', async () => {
    const module = await import('@/config/voice-overlay-preferences');

    expect(module.getVoiceOverlayShowDiagnostics()).toBe(false);
  });

  it('persists transcript line count（持久化实时文本行数）', async () => {
    const module = await import('@/config/voice-overlay-preferences');

    expect(module.setVoiceOverlayTranscriptLines(5)).toBe(5);
    expect(storage[module.VOICE_OVERLAY_TRANSCRIPT_LINES_STORAGE_KEY]).toBe('5');
    expect(module.getVoiceOverlayTranscriptLines()).toBe(5);
  });

  it('persists overlay bottom offset（持久化悬浮窗底部间距）', async () => {
    const module = await import('@/config/voice-overlay-preferences');

    expect(module.setVoiceOverlayBottomOffset(64)).toBe(64);
    expect(storage[module.VOICE_OVERLAY_BOTTOM_OFFSET_STORAGE_KEY]).toBe('64');
    expect(module.getVoiceOverlayBottomOffset()).toBe(64);
  });

  it('syncs diagnostics visibility through storage events（诊断信息开关支持 storage 同步）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeVoiceOverlayShowDiagnosticsChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: module.VOICE_OVERLAY_SHOW_DIAGNOSTICS_STORAGE_KEY,
      newValue: 'true',
    }));

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });

  it('syncs transcript lines through storage events（文本行数支持 storage 同步）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeVoiceOverlayTranscriptLinesChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: module.VOICE_OVERLAY_TRANSCRIPT_LINES_STORAGE_KEY,
      newValue: '4',
    }));

    expect(listener).toHaveBeenCalledWith(4);
    unsubscribe();
  });

  it('syncs bottom offset through storage events（底部间距支持 storage 同步）', async () => {
    const module = await import('@/config/voice-overlay-preferences');
    const listener = vi.fn();
    const unsubscribe = module.subscribeVoiceOverlayBottomOffsetChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: module.VOICE_OVERLAY_BOTTOM_OFFSET_STORAGE_KEY,
      newValue: '72',
    }));

    expect(listener).toHaveBeenCalledWith(72);
    unsubscribe();
  });
});
