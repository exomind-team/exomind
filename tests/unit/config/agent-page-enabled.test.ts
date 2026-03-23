import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAgentPageEnabled,
  setAgentPageEnabled,
  subscribeAgentPageEnabledChanges,
} from '@/config/agent-page-enabled';

describe('agent page flag（网络页面开关）', () => {
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

  it('defaults to true when key is missing（缺省时默认开启）', () => {
    expect(getAgentPageEnabled()).toBe(true);
  });

  it('returns false when stored value is false（显式 false 时关闭）', () => {
    storage['exomind:agentPageEnabled'] = 'false';
    expect(getAgentPageEnabled()).toBe(false);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentPageEnabledChanges(listener);

    setAgentPageEnabled(false);

    expect(storage['exomind:agentPageEnabled']).toBe('false');
    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
  });

  it('treats storage key removal as enabled（storage 删除键后恢复默认开启）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAgentPageEnabledChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:agentPageEnabled',
      newValue: null,
    }));

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });
});
