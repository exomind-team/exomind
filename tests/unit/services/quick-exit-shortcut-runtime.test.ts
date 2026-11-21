import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getQuickExitShortcut, setQuickExitShortcut } from '@/config/quick-exit-shortcut';
import { __resetRuntimeConfigCacheForTests } from '@/config/runtime-config-cache';

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

vi.mock('@/config/voice-shortcut-hotkey', () => ({
  getVoiceShortcutHotkey: () => 'Alt+Q',
}));

vi.mock('@/config/main-window-shortcut', () => ({
  getResolvedMainWindowShortcutHotkey: () => 'Ctrl+E',
}));

import { syncQuickExitShortcutWithRuntime } from '@/services/quick-exit-shortcut-runtime';

describe('quick exit shortcut runtime（快速退出快捷键运行时）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockResolvedValue(true);
  });

  it('rejects a conflict before invoking or persisting', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');

    await expect(syncQuickExitShortcutWithRuntime({ hotkey: 'Ctrl+E' }))
      .rejects.toThrow('与主窗口快捷键 Ctrl+E 冲突。');

    expect(invokeMock).not.toHaveBeenCalled();
    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+X');
  });

  it('rejects an invalid accelerator before invoking or persisting', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');

    await expect(syncQuickExitShortcutWithRuntime({ hotkey: 'Ctrl+Enter' }))
      .rejects.toThrow('无效的快捷键组合。');

    expect(invokeMock).not.toHaveBeenCalled();
    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+X');
  });

  it('persists only the value the runtime accepted', async () => {
    invokeMock.mockResolvedValue('Ctrl+Alt+Z');

    await expect(syncQuickExitShortcutWithRuntime({ hotkey: 'Ctrl+Alt+Z' }))
      .resolves.toEqual({ kind: 'valid', hotkey: 'Ctrl+Alt+Z' });

    expect(invokeMock).toHaveBeenCalledWith('quick_exit_shortcut_set', {
      shortcut: 'Ctrl+Alt+Z',
    });
    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+Z');
  });

  it('rolls the local mirror back when registration fails', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'quick_exit_shortcut_set') {
        throw new Error('shortcut is occupied');
      }
      return 'Ctrl+Alt+X';
    });

    await expect(syncQuickExitShortcutWithRuntime({ hotkey: 'Ctrl+Alt+Z' }))
      .rejects.toThrow('shortcut is occupied');

    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+X');
  });

  it('clears the binding through the runtime', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');
    invokeMock.mockResolvedValue(null);

    await expect(syncQuickExitShortcutWithRuntime({ hotkey: null }))
      .resolves.toEqual({ kind: 'unassigned' });

    expect(invokeMock).toHaveBeenCalledWith('quick_exit_shortcut_set', {
      shortcut: null,
    });
    expect(getQuickExitShortcut()).toBeNull();
  });
});
