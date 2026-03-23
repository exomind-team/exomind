import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUseMockDataEnabled,
  setUseMockDataEnabled,
  subscribeUseMockDataChanges,
} from '@/config/mock-data';

describe('mock data flag（测试数据开关）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to false when key is missing（未设置时默认关闭）', () => {
    expect(getUseMockDataEnabled()).toBe(false);
  });

  it('persists and emits custom event when toggled（切换时持久化并发事件）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUseMockDataChanges(listener);

    setUseMockDataEnabled(true);

    expect(window.localStorage.getItem('exomind:useMockData')).toBe('true');
    expect(listener).toHaveBeenCalledWith(true);

    unsubscribe();
  });

  it('handles storage event updates（支持 storage 事件同步）', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeUseMockDataChanges(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:useMockData',
      newValue: 'true',
    }));

    expect(listener).toHaveBeenCalledWith(true);
    unsubscribe();
  });
});
