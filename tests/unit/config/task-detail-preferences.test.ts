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

describe('task detail preferences（任务详情偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    storage = {};
    installStorageStub(storage);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('defaults task timer auto fill to disabled（默认关闭计时器自动填充）', async () => {
    const module = await import('@/config/task-detail-preferences');

    expect(module.getTaskTimerAutoFillEnabled()).toBe(false);
  });

  it('reads runtime-backed auto fill flag before local mirror（优先读取 Runtime 中的自动填充开关）', async () => {
    storage['exomind:task-timer:auto-fill'] = '0';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'exomind:task-timer:auto-fill': '1',
    });

    const module = await import('@/config/task-detail-preferences');

    expect(module.getTaskTimerAutoFillEnabled()).toBe(true);
  });

  it('writes auto fill flag through runtime-preferred storage（自动填充开关通过 Runtime 优先存储写入）', async () => {
    const module = await import('@/config/task-detail-preferences');

    expect(module.setTaskTimerAutoFillEnabled(true)).toBe(true);
    expect(storage[module.TASK_TIMER_AUTO_FILL_STORAGE_KEY]).toBe('1');
    expect(module.setTaskTimerAutoFillEnabled(false)).toBe(false);
    expect(storage[module.TASK_TIMER_AUTO_FILL_STORAGE_KEY]).toBe('0');
  });
});
