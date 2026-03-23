import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCommandPaletteEnabled,
  setCommandPaletteEnabled,
  subscribeCommandPaletteEnabledChanges,
} from '@/config/command-palette-enabled';

describe('command palette flag（命令面板开关）', () => {
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

  it('defaults to false when key is missing（默认关闭）', () => {
    expect(getCommandPaletteEnabled()).toBe(false);
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
