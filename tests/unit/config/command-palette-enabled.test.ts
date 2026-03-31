import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCommandPaletteEnabled,
  setCommandPaletteEnabled,
  subscribeCommandPaletteEnabledChanges,
} from '@/config/command-palette-enabled';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('command palette flag（命令面板开关）', () => {
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

  it('defaults to false when key is missing（默认关闭）', () => {
    expect(getCommandPaletteEnabled()).toBe(false);
  });

  it('reads runtime-backed value before localStorage（优先读取 Runtime 中的命令面板开关）', () => {
    storage['exomind:commandPaletteEnabled'] = 'false';
    __primeRuntimeConfigForTests({ 'exomind:commandPaletteEnabled': 'true' });

    expect(getCommandPaletteEnabled()).toBe(true);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommandPaletteEnabledChanges(listener);

    setCommandPaletteEnabled(true);

    expect(storage['exomind:commandPaletteEnabled']).toBe('true');
    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });

  it('handles storage event updates（支持 storage 事件同步）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCommandPaletteEnabledChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:commandPaletteEnabled',
      newValue: 'true',
    }));

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });
});
