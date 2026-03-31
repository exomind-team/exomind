import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

async function flushMicrotasks(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

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

  it('includes overlay preferences in frontend bootstrap import（启动迁移会带上悬浮窗偏好）', async () => {
    window.localStorage.setItem('exomind:voiceOverlayOpacity', '78');
    window.localStorage.setItem('exomind:voiceOverlayShowDiagnostics', 'true');
    window.localStorage.setItem('exomind:voiceOverlayTranscriptLines', '4');
    window.localStorage.setItem('exomind:voiceOverlayBottomOffset', '96');
    window.localStorage.setItem('exomind:nowWorkbenchOverlayEnabled', 'false');
    window.localStorage.setItem('exomind:nowWorkbenchOverlayPosition', '{"x":280,"y":360}');
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 6, skipped: 0, total: 6 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:voiceOverlayOpacity', value: '78' },
        { key: 'exomind:voiceOverlayShowDiagnostics', value: 'true' },
        { key: 'exomind:voiceOverlayTranscriptLines', value: '4' },
        { key: 'exomind:voiceOverlayBottomOffset', value: '96' },
        { key: 'exomind:nowWorkbenchOverlayEnabled', value: 'false' },
        { key: 'exomind:nowWorkbenchOverlayPosition', value: '{"x":280,"y":360}' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    const importBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      entries: Array<{ key: string; value: string }>;
    };
    const importedEntries = new Map(importBody.entries.map((entry) => [entry.key, entry.value]));

    expect(importedEntries.get('exomind:voiceOverlayOpacity')).toBe('78');
    expect(importedEntries.get('exomind:voiceOverlayShowDiagnostics')).toBe('true');
    expect(importedEntries.get('exomind:voiceOverlayTranscriptLines')).toBe('4');
    expect(importedEntries.get('exomind:voiceOverlayBottomOffset')).toBe('96');
    expect(importedEntries.get('exomind:nowWorkbenchOverlayEnabled')).toBe('false');
    expect(importedEntries.get('exomind:nowWorkbenchOverlayPosition')).toBe('{"x":280,"y":360}');
  });

  it('includes second-batch preference keys in frontend bootstrap import（启动迁移会带上第二批偏好）', async () => {
    window.localStorage.setItem('exomind:voice-auto-record', '0');
    window.localStorage.setItem('exomind:taskCreateSuccessAction', 'open-detail');
    window.localStorage.setItem('exomind:taskPageFuzzySearchEnabled', 'false');
    window.localStorage.setItem('exomind:agentPageEnabled', 'false');
    window.localStorage.setItem('exomind:goalsPageEnabled', 'true');
    window.localStorage.setItem('exomind:mePageEnabled', 'true');
    window.localStorage.setItem('exomind:feedbackPreferences', JSON.stringify({
      timingInfoEnabled: true,
      statisticsEnabled: false,
      quickFeedbackEnabled: true,
    }));
    window.localStorage.setItem('exomind:timerPreferences', JSON.stringify({
      countdownEndMode: 'hard',
      countdownEndSoundEnabled: false,
      countdownEndSoundPresetId: 'digital-watch',
    }));
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 8, skipped: 0, total: 8 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:voice-auto-record', value: '0' },
        { key: 'exomind:taskCreateSuccessAction', value: 'open-detail' },
        { key: 'exomind:taskPageFuzzySearchEnabled', value: 'false' },
        { key: 'exomind:agentPageEnabled', value: 'false' },
        { key: 'exomind:goalsPageEnabled', value: 'true' },
        { key: 'exomind:mePageEnabled', value: 'true' },
        {
          key: 'exomind:feedbackPreferences',
          value: '{"timingInfoEnabled":true,"statisticsEnabled":false,"quickFeedbackEnabled":true}',
        },
        {
          key: 'exomind:timerPreferences',
          value: '{"countdownEndMode":"hard","countdownEndSoundEnabled":false,"countdownEndSoundPresetId":"digital-watch"}',
        },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    const importBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      entries: Array<{ key: string; value: string }>;
    };
    const importedEntries = new Map(importBody.entries.map((entry) => [entry.key, entry.value]));

    expect(importedEntries.get('exomind:voice-auto-record')).toBe('0');
    expect(importedEntries.get('exomind:taskCreateSuccessAction')).toBe('open-detail');
    expect(importedEntries.get('exomind:taskPageFuzzySearchEnabled')).toBe('false');
    expect(importedEntries.get('exomind:agentPageEnabled')).toBe('false');
    expect(importedEntries.get('exomind:goalsPageEnabled')).toBe('true');
    expect(importedEntries.get('exomind:mePageEnabled')).toBe('true');
    expect(importedEntries.get('exomind:feedbackPreferences')).toBe(
      '{"timingInfoEnabled":true,"statisticsEnabled":false,"quickFeedbackEnabled":true}',
    );
    expect(importedEntries.get('exomind:timerPreferences')).toBe(
      '{"countdownEndMode":"hard","countdownEndSoundEnabled":false,"countdownEndSoundPresetId":"digital-watch"}',
    );
  });

  it('includes third-batch preference keys in frontend bootstrap import（启动迁移会带上第三批偏好）', async () => {
    window.localStorage.setItem('exomind:commandPaletteEnabled', 'true');
    window.localStorage.setItem('exomind:developerMode', 'true');
    window.localStorage.setItem('exomind:desktopAdaptiveEnabled', 'false');
    window.localStorage.setItem('exomind:devtoolsEnabled', 'true');
    window.localStorage.setItem('exomind:useMockData', 'true');
    window.localStorage.setItem('exomind:focusBgmPreferences', JSON.stringify({
      enabled: true,
      sourceType: 'preset',
      presetId: 'brown-noise',
      customTracks: [],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 48,
    }));
    window.localStorage.setItem('exomind:runtimeTargetMode', 'external');
    window.localStorage.setItem('exomind:embeddedRuntimeNetworkMode', 'lan');
    window.localStorage.setItem('exomind:runtimeExternalAddress', '10.0.0.8:2888');
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 9, skipped: 0, total: 9 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:commandPaletteEnabled', value: 'true' },
        { key: 'exomind:developerMode', value: 'true' },
        { key: 'exomind:desktopAdaptiveEnabled', value: 'false' },
        { key: 'exomind:devtoolsEnabled', value: 'true' },
        { key: 'exomind:useMockData', value: 'true' },
        {
          key: 'exomind:focusBgmPreferences',
          value: '{"enabled":true,"sourceType":"preset","presetId":"brown-noise","customTracks":[],"playbackMode":"loop","stopBehavior":"manual-end","volume":48}',
        },
        { key: 'exomind:runtimeTargetMode', value: 'external' },
        { key: 'exomind:embeddedRuntimeNetworkMode', value: 'lan' },
        { key: 'exomind:runtimeExternalAddress', value: '10.0.0.8:2888' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    const importBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      entries: Array<{ key: string; value: string }>;
    };
    const importedEntries = new Map(importBody.entries.map((entry) => [entry.key, entry.value]));

    expect(importedEntries.get('exomind:commandPaletteEnabled')).toBe('true');
    expect(importedEntries.get('exomind:developerMode')).toBe('true');
    expect(importedEntries.get('exomind:desktopAdaptiveEnabled')).toBe('false');
    expect(importedEntries.get('exomind:devtoolsEnabled')).toBe('true');
    expect(importedEntries.get('exomind:useMockData')).toBe('true');
    expect(importedEntries.get('exomind:focusBgmPreferences')).toBe(
      '{"enabled":true,"sourceType":"preset","presetId":"brown-noise","customTracks":[],"playbackMode":"loop","stopBehavior":"manual-end","volume":48}',
    );
    expect(importedEntries.get('exomind:runtimeTargetMode')).toBe('external');
    expect(importedEntries.get('exomind:embeddedRuntimeNetworkMode')).toBe('lan');
    expect(importedEntries.get('exomind:runtimeExternalAddress')).toBe('10.0.0.8:2888');
  });

  it('includes fourth-batch preference keys in frontend bootstrap import（启动迁移会带上第四批偏好）', async () => {
    window.localStorage.setItem('exomind:eventlogBackendMode', 'legacy');
    window.localStorage.setItem('exomind:taskBackendMode', 'legacy');
    window.localStorage.setItem('exomind:timeblockBackendMode', 'legacy');
    window.localStorage.setItem('exomind:dag-pan-speed', '720');
    window.localStorage.setItem('exomind:dag-zoom-speed', '44');
    window.localStorage.setItem('exomind:tasks-default-tab', 'dag');
    window.localStorage.setItem('exomind:syncServerUrl', 'http://10.0.0.5:6984');
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 7, skipped: 0, total: 7 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:eventlogBackendMode', value: 'legacy' },
        { key: 'exomind:taskBackendMode', value: 'legacy' },
        { key: 'exomind:timeblockBackendMode', value: 'legacy' },
        { key: 'exomind:dag-pan-speed', value: '720' },
        { key: 'exomind:dag-zoom-speed', value: '44' },
        { key: 'exomind:tasks-default-tab', value: 'dag' },
        { key: 'exomind:syncServerUrl', value: 'http://10.0.0.5:6984' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    const importBody = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      entries: Array<{ key: string; value: string }>;
    };
    const importedEntries = new Map(importBody.entries.map((entry) => [entry.key, entry.value]));

    expect(importedEntries.get('exomind:eventlogBackendMode')).toBe('legacy');
    expect(importedEntries.get('exomind:taskBackendMode')).toBe('legacy');
    expect(importedEntries.get('exomind:timeblockBackendMode')).toBe('legacy');
    expect(importedEntries.get('exomind:dag-pan-speed')).toBe('720');
    expect(importedEntries.get('exomind:dag-zoom-speed')).toBe('44');
    expect(importedEntries.get('exomind:tasks-default-tab')).toBe('dag');
    expect(importedEntries.get('exomind:syncServerUrl')).toBe('http://10.0.0.5:6984');
  });

  it('falls back to localStorage when runtime transport is unavailable（Runtime 不可用时回退本地存储）', async () => {
    window.localStorage.setItem('exomind:inputSendMode', 'enter-send');
    isTauriMock.mockResolvedValue(false);

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);
    expect(cacheModule.getRuntimeConfigValueSync('exomind:inputSendMode')).toBe('enter-send');
  });

  it('retries bootstrap after startup lag and enables runtime later（启动稍慢时会后台重试）', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('exomind:themePreference', 'dark');
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
    const bootstrapPromise = cacheModule.bootstrapRuntimeConfig();
    await vi.advanceTimersByTimeAsync(8 * 150);
    await bootstrapPromise;

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    runtimeReady = true;
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(true);
    expect(cacheModule.getRuntimeConfigValueSync('exomind:themePreference')).toBe('dark');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('notifies subscribers when retry bootstrap replaces fallback values（重试成功后会通知已挂载订阅者）', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('exomind:themePreference', 'light');
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
        { key: 'exomind:themePreference', value: 'dark' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const themeModule = await import('@/config/theme');
    const listener = vi.fn();
    const unsubscribe = themeModule.subscribeThemePreferenceChanges(listener);

    const cacheModule = await import('@/config/runtime-config-cache');
    const bootstrapPromise = cacheModule.bootstrapRuntimeConfig();
    await vi.advanceTimersByTimeAsync(8 * 150);
    await bootstrapPromise;

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);
    expect(themeModule.getThemePreference()).toBe('light');
    expect(listener).not.toHaveBeenCalled();

    runtimeReady = true;
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(true);
    expect(themeModule.getThemePreference()).toBe('dark');
    expect(listener).toHaveBeenCalledWith('dark');

    unsubscribe();
    vi.useRealTimers();
  });

  it('keeps runtime-backed values across a later boot without localStorage mirror（后续启动即使没有本地镜像也能继续读 Runtime）', async () => {
    isTauriMock.mockResolvedValue(true);

    const firstBootFetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, skipped: 0, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:voiceShortcutHotkey', value: 'Ctrl+Space' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = firstBootFetchMock as unknown as typeof fetch;
    window.localStorage.setItem('exomind:voiceShortcutHotkey', 'Ctrl+Space');

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    expect(cacheModule.getRuntimeConfigValueSync('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');
    expect(firstBootFetchMock).toHaveBeenCalledTimes(2);

    cacheModule.__resetRuntimeConfigCacheForTests();
    window.localStorage.clear();

    const secondBootFetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:voiceShortcutHotkey', value: 'Ctrl+Space' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = secondBootFetchMock as unknown as typeof fetch;

    await cacheModule.bootstrapRuntimeConfig();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(true);
    expect(cacheModule.getRuntimeConfigValueSync('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');
    expect(secondBootFetchMock).toHaveBeenCalledTimes(1);
    expect(secondBootFetchMock.mock.calls[0]?.[0]).toContain('/config?scope=user');
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

  it('rolls back optimistic writes when runtime put fails（远端写入失败时回滚本地镜像）', async () => {
    window.localStorage.setItem('exomind:voiceShortcutHotkey', 'Alt+Q');
    isTauriMock.mockResolvedValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, skipped: 0, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:voiceShortcutHotkey', value: 'Alt+Q' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();
    cacheModule.setRuntimeConfigValue('exomind:voiceShortcutHotkey', 'Ctrl+Space', {
      source: 'test',
    });
    await flushMicrotasks();

    expect(cacheModule.getRuntimeConfigValueSync('exomind:voiceShortcutHotkey')).toBe('Alt+Q');
    expect(window.localStorage.getItem('exomind:voiceShortcutHotkey')).toBe('Alt+Q');
  });

  it('ignores stale failed writes when a newer value is already pending（旧失败请求不会覆盖更新中的新值）', async () => {
    window.localStorage.setItem('exomind:voiceShortcutHotkey', 'Alt+Q');
    isTauriMock.mockResolvedValue(true);

    let resolveFirstWrite: ((response: Response) => void) | null = null;
    let resolveSecondWrite: ((response: Response) => void) | null = null;
    const firstWrite = new Promise<Response>((resolve) => {
      resolveFirstWrite = resolve;
    });
    const secondWrite = new Promise<Response>((resolve) => {
      resolveSecondWrite = resolve;
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, skipped: 0, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:voiceShortcutHotkey', value: 'Alt+Q' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockImplementationOnce(() => firstWrite)
      .mockImplementationOnce(() => secondWrite);
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    cacheModule.setRuntimeConfigValue('exomind:voiceShortcutHotkey', 'Alt+W', { source: 'test' });
    cacheModule.setRuntimeConfigValue('exomind:voiceShortcutHotkey', 'Ctrl+Space', { source: 'test' });
    expect(cacheModule.getRuntimeConfigValueSync('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');

    resolveFirstWrite?.(new Response('boom', { status: 500 }));
    await flushMicrotasks();

    expect(cacheModule.getRuntimeConfigValueSync('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');
    expect(window.localStorage.getItem('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');

    resolveSecondWrite?.(new Response(JSON.stringify({
      key: 'exomind:voiceShortcutHotkey',
      value: 'Ctrl+Space',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await flushMicrotasks();
  });

  it('rolls back the latest failed write to the last confirmed value（连续失败时回滚到最后一次确认值）', async () => {
    window.localStorage.setItem('exomind:voiceShortcutHotkey', 'Alt+Q');
    isTauriMock.mockResolvedValue(true);

    let resolveFirstWrite: ((response: Response) => void) | null = null;
    let resolveSecondWrite: ((response: Response) => void) | null = null;
    const firstWrite = new Promise<Response>((resolve) => {
      resolveFirstWrite = resolve;
    });
    const secondWrite = new Promise<Response>((resolve) => {
      resolveSecondWrite = resolve;
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, skipped: 0, total: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'exomind:voiceShortcutHotkey', value: 'Alt+Q' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockImplementationOnce(() => firstWrite)
      .mockImplementationOnce(() => secondWrite);
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    cacheModule.setRuntimeConfigValue('exomind:voiceShortcutHotkey', 'Alt+W', { source: 'test' });
    cacheModule.setRuntimeConfigValue('exomind:voiceShortcutHotkey', 'Ctrl+Space', { source: 'test' });

    resolveFirstWrite?.(new Response('boom', { status: 500 }));
    await flushMicrotasks();

    resolveSecondWrite?.(new Response('boom', { status: 500 }));
    await flushMicrotasks();

    expect(cacheModule.getRuntimeConfigValueSync('exomind:voiceShortcutHotkey')).toBe('Alt+Q');
    expect(window.localStorage.getItem('exomind:voiceShortcutHotkey')).toBe('Alt+Q');
  });

  it('rolls back optimistic deletes when runtime delete fails（远端删除失败时恢复本地镜像）', async () => {
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
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();
    cacheModule.removeRuntimeConfigValue('moss_api_key');
    await flushMicrotasks();

    expect(cacheModule.getRuntimeConfigValueSync('moss_api_key')).toBe('sk-old');
    expect(window.localStorage.getItem('moss_api_key')).toBe('sk-old');
  });

  it('replays fallback writes after late bootstrap and preserves the user value（晚到启动后会重放 fallback 写入并保留用户值）', async () => {
    vi.useFakeTimers();
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
        { key: 'exomind:voiceShortcutHotkey', value: 'Alt+Q' },
      ]), {
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
    const bootstrapPromise = cacheModule.bootstrapRuntimeConfig();
    await vi.advanceTimersByTimeAsync(8 * 150);
    await bootstrapPromise;

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);

    cacheModule.setRuntimeConfigValue('exomind:voiceShortcutHotkey', 'Ctrl+Space', {
      source: 'test',
    });
    expect(window.localStorage.getItem('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');

    runtimeReady = true;
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(true);
    expect(cacheModule.getRuntimeConfigValueSync('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');
    expect(window.localStorage.getItem('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/config/exomind%3AvoiceShortcutHotkey');
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).method).toBe('PUT');

    vi.useRealTimers();
  });

  it('replays fallback removals after late bootstrap and keeps the key deleted（晚到启动后会重放 fallback 删除并保持删除态）', async () => {
    vi.useFakeTimers();
    isTauriMock.mockResolvedValue(true);
    window.localStorage.setItem('moss_api_key', 'sk-local-secret');

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
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'moss_api_key', value: 'sk-remote-secret' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    const bootstrapPromise = cacheModule.bootstrapRuntimeConfig();
    await vi.advanceTimersByTimeAsync(8 * 150);
    await bootstrapPromise;

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);

    cacheModule.removeRuntimeConfigValue('moss_api_key');
    expect(window.localStorage.getItem('moss_api_key')).toBeNull();

    runtimeReady = true;
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(true);
    expect(cacheModule.getRuntimeConfigValueSync('moss_api_key')).toBeNull();
    expect(window.localStorage.getItem('moss_api_key')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/config/moss_api_key?scope=user');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe('DELETE');

    vi.useRealTimers();
  });

  it('disables runtime config transport when status points to an external runtime（命中外部 Runtime 时禁用本机配置传输）', async () => {
    vi.useFakeTimers();
    isTauriMock.mockResolvedValue(true);
    window.localStorage.setItem('exomind:themePreference', 'light');
    invokeMock.mockResolvedValue({
      running: true,
      host: '127.0.0.1',
      port: 9124,
      authSecret: 'secret-123',
      externalRuntime: true,
    });

    const fetchMock = vi.fn();
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();
    await vi.advanceTimersByTimeAsync(3000);
    await flushMicrotasks();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);
    expect(cacheModule.getRuntimeConfigValueSync('exomind:themePreference')).toBe('light');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('keeps bootstrapped runtime entries after suspend when no local mirror exists（切到外部 Runtime 后仍保留仅 SQLite 中的已加载配置）', async () => {
    isTauriMock.mockResolvedValue(true);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { key: 'moss_api_key', value: 'sqlite-only-secret' },
      ]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const cacheModule = await import('@/config/runtime-config-cache');
    await cacheModule.bootstrapRuntimeConfig();

    expect(window.localStorage.getItem('moss_api_key')).toBeNull();
    expect(cacheModule.getRuntimeConfigValueSync('moss_api_key')).toBe('sqlite-only-secret');

    cacheModule.suspendRuntimeConfigBootstrap();

    expect(cacheModule.isRuntimeConfigEnabled()).toBe(false);
    expect(cacheModule.getRuntimeConfigValueSync('moss_api_key')).toBe('sqlite-only-secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
