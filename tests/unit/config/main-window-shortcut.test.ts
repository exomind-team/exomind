import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMainWindowShortcutSelection,
  getResolvedMainWindowShortcutHotkey,
  parseMainWindowShortcutSelection,
  setMainWindowShortcutSelection,
  subscribeMainWindowShortcutSelectionChanges,
  validateMainWindowShortcutSelection,
} from '@/config/main-window-shortcut';

describe('main window shortcut config（主窗口快捷键配置）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('uses Ctrl+E as default selection and hotkey', () => {
    expect(getMainWindowShortcutSelection()).toEqual(['Ctrl', 'E']);
    expect(getResolvedMainWindowShortcutHotkey()).toBe('Ctrl+E');
  });

  it('normalizes deduplicated ordered selections', () => {
    setMainWindowShortcutSelection(['E', 'Ctrl', 'Ctrl', 'Alt', 'Unknown' as never]);

    expect(getMainWindowShortcutSelection()).toEqual(['Ctrl', 'Alt', 'E']);
    expect(getResolvedMainWindowShortcutHotkey()).toBe('Ctrl+Alt+E');
  });

  it('migrates legacy default Alt+E storage to Ctrl+E when not customized', () => {
    window.localStorage.setItem('exomind:mainWindowShortcutSelection', JSON.stringify(['Alt', 'E']));

    expect(getMainWindowShortcutSelection()).toEqual(['Ctrl', 'E']);
    expect(window.localStorage.getItem('exomind:mainWindowShortcutSelection')).toBe(JSON.stringify(['Ctrl', 'E']));
  });

  it('keeps explicit Alt+E customization when customized flag is set', () => {
    window.localStorage.setItem('exomind:mainWindowShortcutSelection', JSON.stringify(['Alt', 'E']));
    window.localStorage.setItem('exomind:mainWindowShortcutSelectionCustomized', 'true');

    expect(getMainWindowShortcutSelection()).toEqual(['Alt', 'E']);
    expect(getResolvedMainWindowShortcutHotkey()).toBe('Alt+E');
  });

  it('flags multiple primary keys as invalid', () => {
    expect(validateMainWindowShortcutSelection(['Alt', 'Q', 'E'])).toEqual({
      kind: 'invalid',
      hotkey: null,
      reason: 'multiple-primary-keys',
      message: '当前组合无效，主窗口快捷键未启用；Q / E / Space 只能选择一个。',
    });
  });

  it('flags voice shortcut conflicts', () => {
    expect(validateMainWindowShortcutSelection(['Alt', 'Q'], 'Alt+Q')).toEqual({
      kind: 'conflict',
      hotkey: 'Alt+Q',
      voiceHotkey: 'Alt+Q',
      message: '当前与全局语音快捷键 Alt+Q 冲突，主窗口快捷键未启用。',
    });
  });

  it('notifies subscribers on selection changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMainWindowShortcutSelectionChanges(listener);

    setMainWindowShortcutSelection(['Ctrl', 'Space']);

    expect(listener).toHaveBeenCalledWith(['Ctrl', 'Space']);
    unsubscribe();
  });

  it('parses runtime hotkey strings back into selection arrays', () => {
    expect(parseMainWindowShortcutSelection('Ctrl+Alt+Space')).toEqual(['Ctrl', 'Alt', 'Space']);
    expect(parseMainWindowShortcutSelection('control+e')).toEqual(['Ctrl', 'E']);
    expect(parseMainWindowShortcutSelection('Shift+E')).toBeNull();
  });
});
