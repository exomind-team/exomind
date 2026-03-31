import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMePageEnabled,
  setMePageEnabled,
  subscribeMePageEnabledChanges,
} from '@/config/me-page-enabled';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('me page flag（Me 页面开关）', () => {
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
    expect(getMePageEnabled()).toBe(false);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMePageEnabledChanges(listener);

    setMePageEnabled(true);

    expect(storage['exomind:mePageEnabled']).toBe('true');
    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });

  it('reads runtime-backed value before localStorage（优先读取 Runtime 中的 Me 页面开关）', () => {
    storage['exomind:mePageEnabled'] = 'false';
    __primeRuntimeConfigForTests({ 'exomind:mePageEnabled': 'true' });

    expect(getMePageEnabled()).toBe(true);
  });
});
