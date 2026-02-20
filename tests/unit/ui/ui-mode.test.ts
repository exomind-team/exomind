import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUIMode,
  setUIMode,
  subscribeUIModeChanges,
  type UIMode,
} from '@/config/ui-mode';

describe('ui mode（界面模式）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to old when not set（未设置时默认旧版）', () => {
    expect(getUIMode()).toBe('old');
  });

  it('falls back to old for invalid value（非法值回退 old）', () => {
    window.localStorage.setItem('exomind:uiMode', 'broken');
    expect(getUIMode()).toBe('old');
  });

  it('persists ui mode and notifies listener（持久化并通知订阅者）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUIModeChanges(listener);

    setUIMode('new');

    expect(window.localStorage.getItem('exomind:uiMode')).toBe('new');
    expect(listener).toHaveBeenCalledWith('new');

    unsubscribe();
  });

  it('supports switch back to old（支持切回旧版）', () => {
    setUIMode('new');
    expect(getUIMode()).toBe('new');

    setUIMode('old');
    expect(getUIMode()).toBe('old');
  });

  it('accepts only old/new via typing（类型限定 old/new）', () => {
    const modes: UIMode[] = ['old', 'new'];
    expect(modes).toEqual(['old', 'new']);
  });
});

