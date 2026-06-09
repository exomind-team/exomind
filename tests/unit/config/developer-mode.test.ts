import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDeveloperModeEnabled,
  setDeveloperModeEnabled,
  subscribeDeveloperModeChanges,
} from '@/config/developer-mode';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('developer mode flag（开发者模式开关）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('defaults to false when key is missing（未设置时默认关闭）', () => {
    expect(getDeveloperModeEnabled()).toBe(false);
  });

  it('reads runtime-backed value before localStorage（优先读取 Runtime 中的开发者模式开关）', () => {
    window.localStorage.setItem('exomind:developerMode', 'false');
    __primeRuntimeConfigForTests({ 'exomind:developerMode': 'true' });

    expect(getDeveloperModeEnabled()).toBe(true);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDeveloperModeChanges(listener);

    setDeveloperModeEnabled(true);

    expect(window.localStorage.getItem('exomind:developerMode')).toBe('true');
    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });
});
