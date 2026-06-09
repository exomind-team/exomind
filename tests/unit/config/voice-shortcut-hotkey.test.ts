import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getVoiceShortcutHotkey,
  setVoiceShortcutHotkey,
  subscribeVoiceShortcutHotkeyChanges,
} from '@/config/voice-shortcut-hotkey';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('voice shortcut hotkey config（语音全局快捷键配置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('uses Alt+Q as default hotkey（默认快捷键）', () => {
    expect(getVoiceShortcutHotkey()).toBe('Alt+Q');
  });

  it('normalizes and stores supported hotkey values（标准化并保存支持的热键）', () => {
    setVoiceShortcutHotkey(' ctrl+space ');

    expect(getVoiceShortcutHotkey()).toBe('Ctrl+Space');
    expect(window.localStorage.getItem('exomind:voiceShortcutHotkey')).toBe('Ctrl+Space');
  });

  it('falls back to default when unsupported value is provided（不支持值回落默认）', () => {
    setVoiceShortcutHotkey('Alt+1');

    expect(getVoiceShortcutHotkey()).toBe('Alt+Q');
  });

  it('reads runtime-backed value before localStorage（优先读取 Runtime 值）', () => {
    window.localStorage.setItem('exomind:voiceShortcutHotkey', 'Alt+W');
    __primeRuntimeConfigForTests({ 'exomind:voiceShortcutHotkey': 'Ctrl+Space' });

    expect(getVoiceShortcutHotkey()).toBe('Ctrl+Space');
  });

  it('can store hotkey without notifying subscribers（可静默同步快捷键存储）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceShortcutHotkeyChanges(listener);

    setVoiceShortcutHotkey('Ctrl+Space', { emitEvent: false });

    expect(getVoiceShortcutHotkey()).toBe('Ctrl+Space');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies subscribers on local changes（本地变更通知订阅者）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceShortcutHotkeyChanges(listener);

    setVoiceShortcutHotkey('Alt+W');

    expect(listener).toHaveBeenCalledWith('Alt+W');
    unsubscribe();
  });
});
