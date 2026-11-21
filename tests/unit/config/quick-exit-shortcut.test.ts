import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureQuickExitShortcut,
  getQuickExitShortcut,
  parseQuickExitAccelerator,
  resolveQuickExitShortcutStatus,
  setQuickExitShortcut,
  subscribeQuickExitShortcutChanges,
} from '@/config/quick-exit-shortcut';
import {
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

function keyEvent(
  key: string,
  {
    code = key,
    ctrlKey = false,
    altKey = false,
    shiftKey = false,
    metaKey = false,
    isComposing = false,
  }: Partial<{
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    isComposing: boolean;
  }> = {},
) {
  return { key, code, ctrlKey, altKey, shiftKey, metaKey, isComposing };
}

describe('quick exit shortcut config（快速退出快捷键配置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures a chord with canonical modifier order', () => {
    expect(captureQuickExitShortcut(keyEvent('A', {
      code: 'KeyA',
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
    }))).toEqual({ kind: 'captured', accelerator: 'Ctrl+Alt+Shift+A' });
  });

  it('captures function keys, digits, and space', () => {
    expect(captureQuickExitShortcut(keyEvent('F5', { code: 'F5', altKey: true })))
      .toEqual({ kind: 'captured', accelerator: 'Alt+F5' });
    expect(captureQuickExitShortcut(keyEvent('3', { code: 'Digit3', ctrlKey: true })))
      .toEqual({ kind: 'captured', accelerator: 'Ctrl+3' });
    expect(captureQuickExitShortcut(keyEvent(' ', { code: 'Space', ctrlKey: true })))
      .toEqual({ kind: 'captured', accelerator: 'Ctrl+Space' });
  });

  it('cancels on Escape and clears on Backspace or Delete', () => {
    expect(captureQuickExitShortcut(keyEvent('Escape'))).toEqual({ kind: 'cancelled' });
    expect(captureQuickExitShortcut(keyEvent('Backspace'))).toEqual({ kind: 'cleared' });
    expect(captureQuickExitShortcut(keyEvent('Delete'))).toEqual({ kind: 'cleared' });
  });

  it('ignores pure modifiers and rejects lone keys', () => {
    expect(captureQuickExitShortcut(keyEvent('Control', { ctrlKey: true })))
      .toEqual({ kind: 'modifier-only' });
    expect(captureQuickExitShortcut(keyEvent('A', { code: 'KeyA' })))
      .toEqual({ kind: 'lone-key', key: 'A' });
  });

  it('rejects the OS-reserved meta modifier and IME composition', () => {
    vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0' });
    expect(captureQuickExitShortcut(keyEvent('A', { code: 'KeyA', metaKey: true })))
      .toEqual({ kind: 'meta-reserved' });
    expect(captureQuickExitShortcut(keyEvent('Process', { code: 'KeyA', ctrlKey: true, isComposing: true })))
      .toEqual({ kind: 'ignored' });
  });

  it('captures Command on macOS', () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh; Intel Mac OS X 10_15_7' });
    expect(captureQuickExitShortcut(keyEvent('A', {
      code: 'KeyA',
      metaKey: true,
      shiftKey: true,
    }))).toEqual({ kind: 'captured', accelerator: 'Cmd+Shift+A' });
    expect(parseQuickExitAccelerator('cmd+shift+a')).toBe('Cmd+Shift+A');
  });

  it('ignores unsupported keys such as Enter, Tab, and arrows', () => {
    expect(captureQuickExitShortcut(keyEvent('Enter', { ctrlKey: true })))
      .toEqual({ kind: 'ignored' });
    expect(captureQuickExitShortcut(keyEvent('Tab', { altKey: true })))
      .toEqual({ kind: 'ignored' });
    expect(captureQuickExitShortcut(keyEvent('ArrowUp', { ctrlKey: true })))
      .toEqual({ kind: 'ignored' });
  });

  it('parses and canonicalizes a persisted accelerator', () => {
    expect(parseQuickExitAccelerator('shift+alt+ctrl+x')).toBe('Ctrl+Alt+Shift+X');
    expect(parseQuickExitAccelerator('control+space')).toBe('Ctrl+Space');
    expect(parseQuickExitAccelerator('Alt+F12')).toBe('Alt+F12');
  });

  it('rejects invalid persisted accelerators', () => {
    vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0' });
    expect(parseQuickExitAccelerator('A')).toBeNull();
    expect(parseQuickExitAccelerator('Ctrl+Meta+A')).toBeNull();
    expect(parseQuickExitAccelerator('Ctrl+Enter')).toBeNull();
    expect(parseQuickExitAccelerator('Ctrl+A+B')).toBeNull();
    expect(parseQuickExitAccelerator('Ctrl+Ctrl+A')).toBeNull();
    expect(parseQuickExitAccelerator('Ctrl+Alt+Delete')).toBeNull();
    expect(parseQuickExitAccelerator('Alt+F4')).toBeNull();
    expect(parseQuickExitAccelerator('')).toBeNull();
  });

  it('rejects macOS-reserved combinations', () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh; Intel Mac OS X 10_15_7' });
    expect(captureQuickExitShortcut(keyEvent(' ', { code: 'Space', metaKey: true })))
      .toEqual({ kind: 'reserved', message: 'Cmd+Space 是 macOS Spotlight 组合。' });
    expect(captureQuickExitShortcut(keyEvent('Tab', { code: 'Tab', metaKey: true })))
      .toEqual({ kind: 'reserved', message: 'Cmd+Tab 是 macOS 应用切换组合。' });
    expect(parseQuickExitAccelerator('Cmd+Tab')).toBeNull();
    expect(parseQuickExitAccelerator('Cmd+Space')).toBeNull();
  });

  it('defaults to unassigned and round-trips through storage', () => {
    expect(getQuickExitShortcut()).toBeNull();

    setQuickExitShortcut('Ctrl+Alt+X');
    expect(getQuickExitShortcut()).toBe('Ctrl+Alt+X');

    setQuickExitShortcut(null);
    expect(getQuickExitShortcut()).toBeNull();
  });

  it('resolves voice and main-window conflicts', () => {
    expect(resolveQuickExitShortcutStatus('Alt+Q', 'Alt+Q', 'Ctrl+E')).toEqual({
      kind: 'conflict',
      message: '与全局语音快捷键 Alt+Q 冲突。',
    });
    expect(resolveQuickExitShortcutStatus('Ctrl+E', 'Alt+Q', 'Ctrl+E')).toEqual({
      kind: 'conflict',
      message: '与主窗口快捷键 Ctrl+E 冲突。',
    });
    expect(resolveQuickExitShortcutStatus('Ctrl+Alt+X', 'Alt+Q', 'Ctrl+E'))
      .toEqual({ kind: 'valid', hotkey: 'Ctrl+Alt+X' });
  });

  it('notifies subscribers on changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeQuickExitShortcutChanges(listener);

    setQuickExitShortcut('Ctrl+Shift+Z');
    expect(listener).toHaveBeenCalledWith('Ctrl+Shift+Z');

    unsubscribe();
  });
});
