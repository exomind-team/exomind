import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFocusKeepAwakeEnabled,
  setFocusKeepAwakeEnabled,
  subscribeFocusKeepAwakeChanges,
} from '@/config/focus-keep-awake';

describe('focus keep awake config（专注常亮配置）', () => {
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

  it('defaults to enabled on first install（首次安装默认开启）', () => {
    expect(getFocusKeepAwakeEnabled()).toBe(true);
  });

  it('persists explicit opt-out and emits changes（显式关闭后会持久化并广播）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFocusKeepAwakeChanges(listener);

    expect(setFocusKeepAwakeEnabled(false)).toBe(false);

    expect(storage['exomind:focusKeepAwakeEnabled']).toBe('false');
    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
  });
});
