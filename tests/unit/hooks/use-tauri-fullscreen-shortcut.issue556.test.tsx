import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauriWindow: vi.fn(),
  isFullscreen: vi.fn(),
  setFullscreen: vi.fn(),
}));

vi.mock('@/config/runtime-target', () => ({
  isTauriWindow: mocks.isTauriWindow,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: mocks.isFullscreen,
    setFullscreen: mocks.setFullscreen,
  }),
}));

describe('useTauriFullscreenShortcut issue-556', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriWindow.mockReturnValue(true);
    mocks.isFullscreen.mockResolvedValue(false);
    mocks.setFullscreen.mockResolvedValue(undefined);
  });

  it('enters fullscreen on F11 in tauri window（Tauri 窗口按 F11 进入全屏）', async () => {
    const { useTauriFullscreenShortcut } = await import('@/ui/app/hooks/useTauriFullscreenShortcut');

    renderHook(() => useTauriFullscreenShortcut());

    const event = new KeyboardEvent('keydown', {
      key: 'F11',
      cancelable: true,
    });

    window.dispatchEvent(event);

    await waitFor(() => {
      expect(mocks.isFullscreen).toHaveBeenCalledTimes(1);
      expect(mocks.setFullscreen).toHaveBeenCalledWith(true);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('exits fullscreen on repeated F11 in tauri window（Tauri 窗口再次按 F11 退出全屏）', async () => {
    const { useTauriFullscreenShortcut } = await import('@/ui/app/hooks/useTauriFullscreenShortcut');
    mocks.isFullscreen.mockResolvedValue(true);

    renderHook(() => useTauriFullscreenShortcut());

    const event = new KeyboardEvent('keydown', {
      key: 'F11',
      cancelable: true,
    });

    window.dispatchEvent(event);

    await waitFor(() => {
      expect(mocks.isFullscreen).toHaveBeenCalledTimes(1);
      expect(mocks.setFullscreen).toHaveBeenCalledWith(false);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not hijack browser F11 outside tauri（非 Tauri 环境不接管浏览器 F11）', async () => {
    const { useTauriFullscreenShortcut } = await import('@/ui/app/hooks/useTauriFullscreenShortcut');
    mocks.isTauriWindow.mockReturnValue(false);

    renderHook(() => useTauriFullscreenShortcut());

    const event = new KeyboardEvent('keydown', {
      key: 'F11',
      cancelable: true,
    });

    window.dispatchEvent(event);

    await waitFor(() => {
      expect(mocks.isFullscreen).not.toHaveBeenCalled();
      expect(mocks.setFullscreen).not.toHaveBeenCalled();
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores existing modified shortcuts like Ctrl/Cmd+K and Alt+Q（不影响现有带修饰键快捷键）', async () => {
    const { useTauriFullscreenShortcut } = await import('@/ui/app/hooks/useTauriFullscreenShortcut');

    renderHook(() => useTauriFullscreenShortcut());

    const commandPaletteEvent = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      cancelable: true,
    });
    const voiceShortcutEvent = new KeyboardEvent('keydown', {
      key: 'q',
      altKey: true,
      cancelable: true,
    });

    window.dispatchEvent(commandPaletteEvent);
    window.dispatchEvent(voiceShortcutEvent);

    await waitFor(() => {
      expect(mocks.isFullscreen).not.toHaveBeenCalled();
      expect(mocks.setFullscreen).not.toHaveBeenCalled();
    });
    expect(commandPaletteEvent.defaultPrevented).toBe(false);
    expect(voiceShortcutEvent.defaultPrevented).toBe(false);
  });
});
