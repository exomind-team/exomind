import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('task page fuzzy search config（任务页模糊搜索配置）', () => {
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

  it('defaults to enabled when missing（未设置时默认开启）', async () => {
    const module = await import('@/config/task-page-fuzzy-search');
    expect(module.getTaskPageFuzzySearchEnabled()).toBe(true);
  });

  it('persists and emits custom event（保存并广播开关变更）', async () => {
    const module = await import('@/config/task-page-fuzzy-search');
    const listener = vi.fn();
    const unsubscribe = module.subscribeTaskPageFuzzySearchChanges(listener);

    module.setTaskPageFuzzySearchEnabled(false);

    expect(storage['exomind:taskPageFuzzySearchEnabled']).toBe('false');
    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
  });

  it('normalizes storage values and supports storage sync（异常值归一化并支持 storage 同步）', async () => {
    const module = await import('@/config/task-page-fuzzy-search');
    const listener = vi.fn();
    const unsubscribe = module.subscribeTaskPageFuzzySearchChanges(listener);

    storage['exomind:taskPageFuzzySearchEnabled'] = 'unexpected';
    expect(module.getTaskPageFuzzySearchEnabled()).toBe(true);

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'exomind:taskPageFuzzySearchEnabled',
      newValue: 'false',
    }));

    expect(listener).toHaveBeenCalledWith(false);
    unsubscribe();
  });
});
