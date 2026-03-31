import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = new Map<string, (event: { payload: unknown }) => void | Promise<void>>();
const navigateMock = vi.fn(async () => undefined);
const requestFocusTargetMock = vi.fn();
const syncRuntimeMock = vi.fn(async () => ({ kind: 'valid', hotkey: 'Ctrl+E' }));
const takePendingActivationMock = vi.fn(async () => false);
const subscribeVoiceShortcutMock = vi.fn();
const subscribeQuickFocusMock = vi.fn();

const runtimeFlags = {
  quickFocusEnabled: true,
};

const shortcutSelectionState = {
  value: ['Ctrl', 'E'] as string[],
};

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(async () => true),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, listener: (event: { payload: unknown }) => void | Promise<void>) => {
    listeners.set(eventName, listener);
    return () => {
      listeners.delete(eventName);
    };
  }),
}));

vi.mock('@/routes', () => ({
  appRouter: {
    state: {
      location: {
        pathname: '/eventlog',
        searchStr: '',
      },
    },
    navigate: (...args: unknown[]) => navigateMock(...args),
  },
}));

vi.mock('@/config/main-window-shortcut-focus', () => ({
  getMainWindowShortcutQuickFocusEnabled: vi.fn(() => runtimeFlags.quickFocusEnabled),
  subscribeMainWindowShortcutQuickFocusChanges: vi.fn((listener: (value: boolean) => void) => {
    subscribeQuickFocusMock(listener);
    return () => {};
  }),
}));

vi.mock('@/config/voice-shortcut-hotkey', () => ({
  subscribeVoiceShortcutHotkeyChanges: vi.fn((listener: () => void) => {
    subscribeVoiceShortcutMock(listener);
    return () => {};
  }),
}));

vi.mock('@/config/main-window-shortcut', () => ({
  MAIN_WINDOW_SHORTCUT_SELECTION_STORAGE_KEY: 'exomind:mainWindowShortcutSelection',
  getMainWindowShortcutSelection: vi.fn(() => shortcutSelectionState.value),
}));

vi.mock('@/services/main-window-focus-targets', () => ({
  requestMainWindowFocusTarget: (...args: unknown[]) => requestFocusTargetMock(...args),
}));

vi.mock('@/services/main-window-shortcut-runtime', () => ({
  syncMainWindowShortcutSelectionWithRuntime: (...args: unknown[]) => syncRuntimeMock(...args),
  takePendingMainWindowShortcutActivation: (...args: unknown[]) => takePendingActivationMock(...args),
}));

describe('MainWindowShortcutService', () => {
  beforeEach(() => {
    listeners.clear();
    navigateMock.mockClear();
    requestFocusTargetMock.mockClear();
    syncRuntimeMock.mockClear();
    takePendingActivationMock.mockReset();
    takePendingActivationMock.mockResolvedValue(false);
    subscribeVoiceShortcutMock.mockClear();
    subscribeQuickFocusMock.mockClear();
    runtimeFlags.quickFocusEnabled = true;
    shortcutSelectionState.value = ['Ctrl', 'E'];
  });

  it('syncs runtime on init and routes eventlog shortcuts to record input', async () => {
    const { MainWindowShortcutService } = await import('@/services/main-window-shortcut.service');
    const { appRouter } = await import('@/routes');
    appRouter.state.location.pathname = '/eventlog';
    appRouter.state.location.searchStr = '';

    const service = new MainWindowShortcutService();
    await service.init();

    expect(syncRuntimeMock).toHaveBeenCalledWith({ notify: false });
    takePendingActivationMock.mockResolvedValueOnce(true);

    await listeners.get('main-window-shortcut')?.({ payload: 'activate' });

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/eventlog',
      search: { tab: 'record' },
    });
    expect(requestFocusTargetMock).toHaveBeenCalledWith('eventlog-record-input');

    service.destroy();
  });

  it('focuses tasks quick-add on exact tasks page', async () => {
    const { MainWindowShortcutService } = await import('@/services/main-window-shortcut.service');
    const { appRouter } = await import('@/routes');
    appRouter.state.location.pathname = '/tasks';
    appRouter.state.location.searchStr = '';

    const service = new MainWindowShortcutService();
    await service.init();
    takePendingActivationMock.mockResolvedValueOnce(true);

    await listeners.get('main-window-shortcut')?.({ payload: 'activate' });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(requestFocusTargetMock).toHaveBeenCalledWith('tasks-quick-add-input');

    service.destroy();
  });

  it('returns to tasks main page before focusing quick-add from tasks sub-routes', async () => {
    const { MainWindowShortcutService } = await import('@/services/main-window-shortcut.service');
    const { appRouter } = await import('@/routes');
    appRouter.state.location.pathname = '/tasks/dag';
    appRouter.state.location.searchStr = '';

    const service = new MainWindowShortcutService();
    await service.init();
    takePendingActivationMock.mockResolvedValueOnce(true);

    await listeners.get('main-window-shortcut')?.({ payload: 'activate' });

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/tasks',
      search: { main: '1' },
    });
    expect(requestFocusTargetMock).toHaveBeenCalledWith('tasks-quick-add-input');

    service.destroy();
  });

  it('does nothing on unsupported routes or when quick-focus is disabled', async () => {
    const { MainWindowShortcutService } = await import('@/services/main-window-shortcut.service');
    const { appRouter } = await import('@/routes');
    appRouter.state.location.pathname = '/settings';
    appRouter.state.location.searchStr = '';

    const service = new MainWindowShortcutService();
    await service.init();

    takePendingActivationMock.mockResolvedValueOnce(true);
    await listeners.get('main-window-shortcut')?.({ payload: 'activate' });
    expect(navigateMock).not.toHaveBeenCalled();
    expect(requestFocusTargetMock).not.toHaveBeenCalled();

    runtimeFlags.quickFocusEnabled = false;
    appRouter.state.location.pathname = '/eventlog';
    const quickFocusListener = subscribeQuickFocusMock.mock.calls[0]?.[0] as ((value: boolean) => void) | undefined;
    quickFocusListener?.(false);

    takePendingActivationMock.mockResolvedValueOnce(true);
    await listeners.get('main-window-shortcut')?.({ payload: 'activate' });
    expect(navigateMock).not.toHaveBeenCalled();
    expect(requestFocusTargetMock).not.toHaveBeenCalled();

    service.destroy();
  });

  it('consumes pending activation on init so shortcut survives a webview reload', async () => {
    const { MainWindowShortcutService } = await import('@/services/main-window-shortcut.service');
    const { appRouter } = await import('@/routes');
    appRouter.state.location.pathname = '/tasks/task-1';
    appRouter.state.location.searchStr = '';
    takePendingActivationMock.mockResolvedValueOnce(true);

    const service = new MainWindowShortcutService();
    await service.init();

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/tasks',
      search: { main: '1' },
    });
    expect(requestFocusTargetMock).toHaveBeenCalledWith('tasks-quick-add-input');

    service.destroy();
  });

  it('re-syncs runtime when voice shortcut changes', async () => {
    const { MainWindowShortcutService } = await import('@/services/main-window-shortcut.service');

    const service = new MainWindowShortcutService();
    await service.init();

    const voiceListener = subscribeVoiceShortcutMock.mock.calls[0]?.[0] as (() => void) | undefined;
    voiceListener?.();

    expect(syncRuntimeMock).toHaveBeenCalledTimes(2);

    service.destroy();
  });

  it('re-syncs runtime when storage updates shortcut selection after init（延迟配置到达后会重新同步主窗口快捷键）', async () => {
    const { MainWindowShortcutService } = await import('@/services/main-window-shortcut.service');

    const service = new MainWindowShortcutService();
    await service.init();

    shortcutSelectionState.value = ['Alt', 'Space'];
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:mainWindowShortcutSelection',
      newValue: JSON.stringify(['Alt', 'Space']),
    }));

    expect(syncRuntimeMock).toHaveBeenCalledTimes(2);
    expect(syncRuntimeMock.mock.calls[1]?.[0]).toEqual({
      notify: false,
      selection: ['Alt', 'Space'],
    });

    service.destroy();
  });

  it('does not re-sync runtime on local custom selection events（本地设置页已主动同步时不重复触发）', async () => {
    const { MainWindowShortcutService } = await import('@/services/main-window-shortcut.service');

    const service = new MainWindowShortcutService();
    await service.init();

    shortcutSelectionState.value = ['Alt', 'Space'];
    window.dispatchEvent(new CustomEvent('exomind:main-window-shortcut-selection-changed', {
      detail: ['Alt', 'Space'],
    }));

    expect(syncRuntimeMock).toHaveBeenCalledTimes(1);

    service.destroy();
  });
});
