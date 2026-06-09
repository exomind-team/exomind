import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDevtoolsEnabled,
  setDevtoolsEnabled,
  subscribeDevtoolsChanges,
} from '@/config/devtools-mode';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('devtools flag（开发者工具开关）', () => {
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

  it('defaults to false when key is missing（未设置时默认关闭）', () => {
    expect(getDevtoolsEnabled()).toBe(false);
  });

  it('reads runtime-backed value before localStorage（优先读取 Runtime 中的 devtools 开关）', () => {
    storage['exomind:devtoolsEnabled'] = 'false';
    __primeRuntimeConfigForTests({ 'exomind:devtoolsEnabled': 'true' });

    expect(getDevtoolsEnabled()).toBe(true);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDevtoolsChanges(listener);

    setDevtoolsEnabled(true);

    expect(storage['exomind:devtoolsEnabled']).toBe('true');
    expect(listener).toHaveBeenCalledWith(true);

    unsubscribe();
  });

  it('handles storage event updates（支持 storage 事件同步）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDevtoolsChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:devtoolsEnabled',
      newValue: 'true',
    }));

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });
});
