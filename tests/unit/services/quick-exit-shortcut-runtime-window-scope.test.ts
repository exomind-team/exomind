import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setQuickExitShortcut, setQuickExitShortcutScope } from '@/config/quick-exit-shortcut';
import { __resetRuntimeConfigCacheForTests } from '@/config/runtime-config-cache';

const { invokeMock, isTauriMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('@/config/voice-shortcut-hotkey', () => ({
  getVoiceShortcutHotkey: () => 'Alt+Q',
}));

vi.mock('@/config/main-window-shortcut', () => ({
  getResolvedMainWindowShortcutHotkey: () => 'Ctrl+E',
}));

import { initQuickExitShortcutRuntime } from '@/services/quick-exit-shortcut-runtime';

describe('quick exit WebView scope', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    listenMock.mockReset();
    isTauriMock.mockResolvedValue(true);
    listenMock.mockResolvedValue(() => {});
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'quick_exit_shortcut_get') {
        return { shortcut: 'Ctrl+Shift+Q', scope: 'app-only' };
      }
      if (command === 'quick_exit_shortcut_set') {
        return { shortcut: 'Ctrl+Shift+Q', scope: 'app-only' };
      }
      return undefined;
    });
  });

  it('requests exit only from its own WebView, ignores rebinding, and does not handle system-global bindings locally', async () => {
    setQuickExitShortcut('Ctrl+Shift+Q');
    setQuickExitShortcutScope('app-only');
    await initQuickExitShortcutRuntime({
      exitCommand: 'beta_request_exit',
      bindingSource: 'persisted-settings',
    });

    const dispatchShortcut = (target: Window | HTMLElement) => {
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Q',
        code: 'KeyQ',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
    };
    const exitRequests = () => invokeMock.mock.calls.filter(([command]) => command === 'beta_request_exit');

    // The focused WebView is the one receiving its native keydown event.
    dispatchShortcut(window);
    expect(exitRequests()).toHaveLength(1);

    const otherWebView = document.createElement('iframe');
    document.body.append(otherWebView);
    dispatchShortcut(otherWebView.contentWindow!);
    expect(exitRequests()).toHaveLength(1);

    const captureRegion = document.createElement('div');
    captureRegion.dataset.quickExitCaptureActive = 'true';
    const captureButton = document.createElement('button');
    captureRegion.append(captureButton);
    document.body.append(captureRegion);
    dispatchShortcut(captureButton);
    expect(exitRequests()).toHaveLength(1);

    const nativeChanged = listenMock.mock.calls[0]?.[1] as
      | ((event: { payload: unknown }) => void)
      | undefined;
    expect(nativeChanged).toBeTypeOf('function');
    nativeChanged?.({
      payload: { shortcut: 'Ctrl+Shift+Q', scope: 'system-global' },
    });
    dispatchShortcut(window);
    expect(exitRequests()).toHaveLength(1);

    otherWebView.remove();
    captureRegion.remove();
  });
});
