import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getQuickExitShortcut,
  getQuickExitShortcutScope,
  setQuickExitShortcut,
} from '@/config/quick-exit-shortcut';
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
    invokeMock.mockResolvedValue({ shortcut: 'Ctrl+Alt+Z', scope: 'system-global' });

    await expect(syncQuickExitShortcutWithRuntime({ hotkey: 'Ctrl+Alt+Z', scope: 'system-global' }))
      .resolves.toEqual({ kind: 'valid', hotkey: 'Ctrl+Alt+Z' });

    expect(invokeMock).toHaveBeenCalledWith('quick_exit_shortcut_set', {
      shortcut: 'Ctrl+Alt+Z',
      scope: 'system-global',
    });
    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+Z');
    expect(getQuickExitShortcutScope()).toBe('system-global');
  });

  it('rolls the local mirror back when registration fails', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'quick_exit_shortcut_set') {
        throw new Error('shortcut is occupied');
      }
      return { shortcut: 'Ctrl+Alt+X', scope: 'system-global' };
    });

    await expect(syncQuickExitShortcutWithRuntime({ hotkey: 'Ctrl+Alt+Z', scope: 'system-global' }))
      .rejects.toThrow('shortcut is occupied');

    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+X');
    expect(getQuickExitShortcutScope()).toBe('system-global');
  });

  it('clears the binding through the runtime', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');
    invokeMock.mockResolvedValue({ shortcut: null, scope: 'system-global' });

    await expect(syncQuickExitShortcutWithRuntime({ hotkey: null, scope: 'system-global' }))
      .resolves.toEqual({ kind: 'unassigned' });

    expect(invokeMock).toHaveBeenCalledWith('quick_exit_shortcut_set', {
      shortcut: null,
      scope: 'system-global',
    });
    expect(getQuickExitShortcut()).toBeNull();
  });

  it('defaults an existing pre-scope binding to system-global', () => {
    setQuickExitShortcut('Ctrl+Alt+X');

    expect(getQuickExitShortcutScope()).toBe('system-global');
  });

  it('defaults a new unassigned binding to app-only', () => {
    expect(getQuickExitShortcut()).toBeNull();
    expect(getQuickExitShortcutScope()).toBe('app-only');
  });

  it('persists an app-only binding without registering it with the operating system', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'quick_exit_shortcut_get') {
        return { shortcut: null, scope: 'app-only' };
      }
      return { shortcut: 'Ctrl+Alt+Z', scope: 'app-only' };
    });

    await expect(syncQuickExitShortcutWithRuntime({ hotkey: 'Ctrl+Alt+Z', scope: 'app-only' }))
      .resolves.toEqual({ kind: 'valid', hotkey: 'Ctrl+Alt+Z' });

    expect(invokeMock).toHaveBeenCalledWith('quick_exit_shortcut_set', {
      shortcut: 'Ctrl+Alt+Z',
      scope: 'app-only',
    });
    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+Z');
    expect(getQuickExitShortcutScope()).toBe('app-only');
  });

  it('refuses app-only scope on an older runtime before changing the stored global binding', async () => {
    setQuickExitShortcut('Ctrl+Alt+X');
    invokeMock.mockResolvedValue('Ctrl+Alt+X');

    await expect(syncQuickExitShortcutWithRuntime({
      hotkey: 'Ctrl+Shift+Q',
      scope: 'app-only',
    })).rejects.toThrow('当前运行时不支持“仅外心内”快捷键作用域');

    expect(invokeMock).toHaveBeenCalledWith('quick_exit_shortcut_get');
    expect(invokeMock).not.toHaveBeenCalledWith('quick_exit_shortcut_set', expect.anything());
    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+X');
    expect(getQuickExitShortcutScope()).toBe('system-global');
  });
});
