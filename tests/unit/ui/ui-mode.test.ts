import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUIMode,
  setUIMode,
  subscribeUIModeChanges,
  type UIMode,
} from '@/config/ui-mode';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => (store.has(key) ? store.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

describe('ui mode（界面模式）', () => {
  const localStorageMock = createLocalStorageMock();

  beforeEach(() => {
    localStorageMock.clear();
    vi.stubGlobal('localStorage', localStorageMock);
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  });

  it('defaults to new when not set（未设置时默认新版）', () => {
    expect(getUIMode()).toBe('new');
  });

  it('falls back to new for invalid value（非法值回退 new）', () => {
    window.localStorage.setItem('exomind:uiMode', 'broken');
    expect(getUIMode()).toBe('new');
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
