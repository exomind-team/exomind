import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDesktopAdaptiveEnabled,
  setDesktopAdaptiveEnabled,
  subscribeDesktopAdaptiveChanges,
} from '@/config/desktop-adaptive';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('desktop adaptive flag（桌面端适配开关）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('defaults to true when key is missing（未设置时默认开启）', () => {
    expect(getDesktopAdaptiveEnabled()).toBe(true);
  });

  it('reads runtime-backed value before localStorage（优先读取 Runtime 中的桌面端适配开关）', () => {
    window.localStorage.setItem('exomind:desktopAdaptiveEnabled', 'true');
    __primeRuntimeConfigForTests({ 'exomind:desktopAdaptiveEnabled': 'false' });

    expect(getDesktopAdaptiveEnabled()).toBe(false);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDesktopAdaptiveChanges(listener);

    setDesktopAdaptiveEnabled(false);

    expect(window.localStorage.getItem('exomind:desktopAdaptiveEnabled')).toBe('false');
    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
  });
});
