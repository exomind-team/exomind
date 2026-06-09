import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTimeblockEndAutoOpenFocusEnabled,
  setTimeblockEndAutoOpenFocusEnabled,
  subscribeTimeblockEndAutoOpenFocusChanges,
} from '@/config/timeblock-end-alert';

describe('timeblock end alert config（时间块结束提醒配置）', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
      },
    });
  });

  it('defaults auto-open focus to disabled（默认不自动拉起专注页）', () => {
    expect(getTimeblockEndAutoOpenFocusEnabled()).toBe(false);
  });

  it('persists and emits auto-open focus changes（持久化并广播自动拉起开关）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTimeblockEndAutoOpenFocusChanges(listener);

    expect(setTimeblockEndAutoOpenFocusEnabled(true)).toBe(true);

    expect(storage['exomind:timeblockEndAutoOpenFocusEnabled']).toBe('true');
    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });
});
