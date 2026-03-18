import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = new Map<string, (event: { payload: unknown }) => void | Promise<void>>();
const navigateMock = vi.fn(async () => undefined);
const requestFocusTargetMock = vi.fn();
const syncRuntimeMock = vi.fn(async () => ({ kind: 'valid', hotkey: 'Alt+E' }));
const subscribeVoiceShortcutMock = vi.fn();
const subscribeQuickFocusMock = vi.fn();

const runtimeFlags = {
  quickFocusEnabled: true,
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

vi.mock('@/services/main-window-focus-targets', () => ({
  requestMainWindowFocusTarget: (...args: unknown[]) => requestFocusTargetMock(...args),
}));

vi.mock('@/services/main-window-shortcut-runtime', () => ({
  syncMainWindowShortcutSelectionWithRuntime: (...args: unknown[]) => syncRuntimeMock(...args),
}));

describe('MainWindowShortcutService', () => {
  beforeEach(() => {
    listeners.clear();
    navigateMock.mockClear();
    requestFocusTargetMock.mockClear();
    syncRuntimeMock.mockClear();
    subscribeVoiceShortcutMock.mockClear();
    subscribeQuickFocusMock.mockClear();
    runtimeFlags.quickFocusEnabled = true;
  });

  it('syncs runtime on init and routes eventlog shortcuts to record input', async () => {
    const { MainWindowShortcutService } = await import('@/services/main-window-shortcut.service');
    const { appRouter } = await import('@/routes');
    appRouter.state.location.pathname = '/eventlog';
    appRouter.state.location.searchStr = '';

    const service = new MainWindowShortcutService();
    await service.init();

    expect(syncRuntimeMock).toHaveBeenCalledWith({ notify: false });

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

    await listeners.get('main-window-shortcut')?.({ payload: 'activate' });

    expect(navigateMock).not.toHaveBeenCalled();
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

    await listeners.get('main-window-shortcut')?.({ payload: 'activate' });
    expect(navigateMock).not.toHaveBeenCalled();
    expect(requestFocusTargetMock).not.toHaveBeenCalled();

    runtimeFlags.quickFocusEnabled = false;
    appRouter.state.location.pathname = '/eventlog';
    const quickFocusListener = subscribeQuickFocusMock.mock.calls[0]?.[0] as ((value: boolean) => void) | undefined;
    quickFocusListener?.(false);

    await listeners.get('main-window-shortcut')?.({ payload: 'activate' });
    expect(navigateMock).not.toHaveBeenCalled();
    expect(requestFocusTargetMock).not.toHaveBeenCalled();

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
});
