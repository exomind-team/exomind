import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getGoalsPageEnabled,
  setGoalsPageEnabled,
  subscribeGoalsPageEnabledChanges,
} from '@/config/goals-page-enabled';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('goals page flag（目标页面开关）', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    __resetRuntimeConfigCacheForTests();
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

  it('defaults to false when key is missing（缺省时默认关闭）', () => {
    expect(getGoalsPageEnabled()).toBe(false);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGoalsPageEnabledChanges(listener);

    setGoalsPageEnabled(true);

    expect(storage['exomind:goalsPageEnabled']).toBe('true');
    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });

  it('reads runtime-backed value before localStorage（优先读取 Runtime 中的目标页面开关）', () => {
    storage['exomind:goalsPageEnabled'] = 'false';
    __primeRuntimeConfigForTests({ 'exomind:goalsPageEnabled': 'true' });

    expect(getGoalsPageEnabled()).toBe(true);
  });
});
