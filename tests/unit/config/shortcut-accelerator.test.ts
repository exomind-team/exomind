import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureShortcutAccelerator,
  isShortcutAcceleratorReserved,
  parseShortcutAccelerator,
  shortcutAcceleratorsEqual,
  type ShortcutKeyEventLike,
} from '@/config/shortcut-accelerator';

function keyEvent(
  key: string,
  overrides: Partial<ShortcutKeyEventLike> = {},
): ShortcutKeyEventLike {
  return { key, code: key, ...overrides };
}

describe('shared shortcut accelerator（共享快捷键捕获）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures and canonicalizes modifiers before the primary key', () => {
    expect(captureShortcutAccelerator(keyEvent('A', {
      code: 'KeyA',
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    }))).toEqual({ kind: 'captured', accelerator: 'Ctrl+Alt+Shift+A' });
  });

  it('respects a consumer policy for allowed modifiers and keys', () => {
    const policy = {
      allowedModifiers: ['Ctrl', 'Alt'] as const,
      isAllowedPrimaryKey: (key: string) => ['Q', 'E', 'Space'].includes(key),
    };

    expect(captureShortcutAccelerator(keyEvent('Q', { code: 'KeyQ', ctrlKey: true }), policy))
      .toEqual({ kind: 'captured', accelerator: 'Ctrl+Q' });
    expect(captureShortcutAccelerator(keyEvent('A', { code: 'KeyA', ctrlKey: true }), policy))
      .toEqual({ kind: 'ignored' });
    expect(captureShortcutAccelerator(keyEvent('Q', { code: 'KeyQ', shiftKey: true }), policy))
      .toEqual({ kind: 'ignored' });
  });

  it('rejects duplicate modifiers during parse', () => {
    expect(parseShortcutAccelerator('Ctrl+Ctrl+A')).toBeNull();
    expect(parseShortcutAccelerator('Control+Alt+Ctrl+A')).toBeNull();
    expect(parseShortcutAccelerator('Ctrl+Alt+Shift+A')).toBe('Ctrl+Alt+Shift+A');
  });

  it('rejects Windows meta and reserved combinations', () => {
    vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0' });
    expect(captureShortcutAccelerator(keyEvent('A', { code: 'KeyA', metaKey: true })))
      .toEqual({ kind: 'meta-reserved' });
    expect(parseShortcutAccelerator('Cmd+A')).toBeNull();
    expect(captureShortcutAccelerator(keyEvent('F4', { code: 'F4', altKey: true })))
      .toEqual({ kind: 'reserved', message: 'Alt+F4 是 Windows 系统关闭窗口组合。' });
    expect(parseShortcutAccelerator('Alt+F4')).toBeNull();
    expect(parseShortcutAccelerator('Ctrl+Alt+Delete')).toBeNull();
    expect(isShortcutAcceleratorReserved('Ctrl+Shift+Escape'))
      .toBe('Ctrl+Shift+Escape 是 Windows 任务管理器组合。');
  });

  it('accepts Command on macOS and rejects Cmd+Space', () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh; Intel Mac OS X 10_15_7' });
    expect(captureShortcutAccelerator(keyEvent('A', { code: 'KeyA', metaKey: true })))
      .toEqual({ kind: 'captured', accelerator: 'Cmd+A' });
    expect(parseShortcutAccelerator('command+shift+a')).toBe('Cmd+Shift+A');
    expect(captureShortcutAccelerator(keyEvent(' ', { code: 'Space', metaKey: true })))
      .toEqual({ kind: 'reserved', message: 'Cmd+Space 是 macOS Spotlight 组合。' });
    expect(captureShortcutAccelerator(keyEvent('Tab', { code: 'Tab', metaKey: true })))
      .toEqual({ kind: 'reserved', message: 'Cmd+Tab 是 macOS 应用切换组合。' });
    expect(parseShortcutAccelerator('Cmd+Tab')).toBeNull();
    expect(parseShortcutAccelerator('Cmd+Space')).toBeNull();
  });

  it('handles cancel/clear/modifier-only/IME and unsupported keys', () => {
    expect(captureShortcutAccelerator(keyEvent('Escape'))).toEqual({ kind: 'cancelled' });
    expect(captureShortcutAccelerator(keyEvent('Backspace'))).toEqual({ kind: 'cleared' });
    expect(captureShortcutAccelerator(keyEvent('Control', { ctrlKey: true })))
      .toEqual({ kind: 'modifier-only' });
    expect(captureShortcutAccelerator(keyEvent('Process', { code: 'KeyA', isComposing: true })))
      .toEqual({ kind: 'ignored' });
    expect(captureShortcutAccelerator(keyEvent('Enter', { ctrlKey: true })))
      .toEqual({ kind: 'ignored' });
    expect(captureShortcutAccelerator(keyEvent('A', { code: 'KeyA' })))
      .toEqual({ kind: 'lone-key', key: 'A' });
  });

  it('compares accelerators case-insensitively', () => {
    expect(shortcutAcceleratorsEqual('Ctrl+E', 'ctrl+e')).toBe(true);
    expect(shortcutAcceleratorsEqual(null, null)).toBe(true);
    expect(shortcutAcceleratorsEqual('Ctrl+E', null)).toBe(false);
    expect(shortcutAcceleratorsEqual('Ctrl+E', 'Ctrl+Q')).toBe(false);
  });
});
