import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProposalInboxEnabled,
  setProposalInboxEnabled,
  subscribeProposalInboxEnabledChanges,
} from '@/config/proposal-inbox-enabled';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('proposal inbox flag（提案箱开关）', () => {
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

  it('defaults to true when key is missing（缺省时默认开启）', () => {
    expect(getProposalInboxEnabled()).toBe(true);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProposalInboxEnabledChanges(listener);

    setProposalInboxEnabled(false);

    expect(storage['exomind:proposalInboxEnabled']).toBe('false');
    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
  });

  it('reads runtime-backed value before localStorage（优先读取 Runtime 中的提案箱开关）', () => {
    storage['exomind:proposalInboxEnabled'] = 'true';
    __primeRuntimeConfigForTests({ 'exomind:proposalInboxEnabled': 'false' });

    expect(getProposalInboxEnabled()).toBe(false);
  });
});
