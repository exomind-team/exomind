import { beforeEach, describe, expect, it, vi } from 'vitest';

function installStorageStub(storage: Record<string, string>): void {
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
      key: (index: number) => Object.keys(storage)[index] ?? null,
      get length() {
        return Object.keys(storage).length;
      },
    },
  });
}

describe('goals page preferences（目标页偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    storage = {};
    installStorageStub(storage);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('defaults to browse mode with cancelled goals hidden（默认浏览模式且隐藏已取消目标）', async () => {
    const module = await import('@/config/goals-page-preferences');

    expect(module.getGoalsPageMode()).toBe('browse');
    expect(module.getGoalsPageShowCancelled()).toBe(false);
    expect(module.getGoalsPageGuideHidden()).toBe(false);
  });

  it('reads runtime-backed preferences before local mirror（优先读取 Runtime 中的目标页偏好）', async () => {
    storage['exomind:goals-mode'] = 'browse';
    storage['exomind:goals-show-cancelled'] = 'false';
    storage['exomind:goals-guide-hidden'] = 'false';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'exomind:goals-mode': 'edit',
      'exomind:goals-show-cancelled': 'true',
      'exomind:goals-guide-hidden': 'true',
    });

    const module = await import('@/config/goals-page-preferences');

    expect(module.getGoalsPageMode()).toBe('edit');
    expect(module.getGoalsPageShowCancelled()).toBe(true);
    expect(module.getGoalsPageGuideHidden()).toBe(true);
  });

  it('writes goals page preferences through runtime-preferred storage（目标页偏好通过 Runtime 优先存储写入）', async () => {
    const module = await import('@/config/goals-page-preferences');

    expect(module.setGoalsPageMode('edit')).toBe('edit');
    expect(storage[module.GOALS_PAGE_MODE_STORAGE_KEY]).toBe('edit');

    expect(module.setGoalsPageShowCancelled(true)).toBe(true);
    expect(storage[module.GOALS_PAGE_SHOW_CANCELLED_STORAGE_KEY]).toBe('true');

    expect(module.setGoalsPageGuideHidden(true)).toBe(true);
    expect(storage[module.GOALS_PAGE_GUIDE_HIDDEN_STORAGE_KEY]).toBe('true');
  });
});
