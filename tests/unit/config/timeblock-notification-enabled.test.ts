import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTimeblockNotificationEnabled,
  setTimeblockNotificationEnabled,
  subscribeTimeblockNotificationEnabledChanges,
} from '@/config/timeblock-notification-enabled';

describe('timeblock notification flag（时间块通知开关）', () => {
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
        removeItem: (key: string) => {
          delete storage[key];
        },
        clear: () => {
          for (const key of Object.keys(storage)) {
            delete storage[key];
          }
        },
      },
    });
  });

  it('defaults to false when key is missing（默认关闭）', () => {
    expect(getTimeblockNotificationEnabled()).toBe(false);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTimeblockNotificationEnabledChanges(listener);

    setTimeblockNotificationEnabled(true);

    expect(storage['exomind:timeblockNotificationEnabled']).toBe('true');
    expect(listener).toHaveBeenCalledWith(true);

    unsubscribe();
  });

  it('handles storage event updates（支持 storage 事件同步）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTimeblockNotificationEnabledChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:timeblockNotificationEnabled',
      newValue: 'true',
    }));

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });
});
