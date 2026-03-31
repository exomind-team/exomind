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

describe('task timeline preferences（任务时间线偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    storage = {};
    installStorageStub(storage);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('defaults timeline preferences to expected values（默认时间线偏好正确）', async () => {
    const module = await import('@/config/task-timeline-preferences');

    expect(module.getTaskTimelineShowPending()).toBe(false);
    expect(module.getTaskTimelineLayoutMode()).toBe('auto');
    expect(module.getTaskTimelineRange()).toBe('1d');
    expect(module.getTaskTimelineSelectedTaskId()).toBeNull();
  });

  it('reads runtime-backed timeline preferences before local mirror（优先读取 Runtime 中的时间线偏好）', async () => {
    storage['task-timeline-range'] = '1d';
    storage['task-timeline-show-pending'] = '0';
    storage['task-timeline-selected-task'] = 'legacy-task';
    storage['task-timeline-layout-mode'] = 'auto';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'task-timeline-range': 'custom:12h',
      'task-timeline-show-pending': '1',
      'task-timeline-selected-task': 'task-7',
      'task-timeline-layout-mode': 'vertical',
    });

    const module = await import('@/config/task-timeline-preferences');

    expect(module.getTaskTimelineRange()).toEqual({ kind: 'custom', value: 12, unit: 'h' });
    expect(module.getTaskTimelineShowPending()).toBe(true);
    expect(module.getTaskTimelineSelectedTaskId()).toBe('task-7');
    expect(module.getTaskTimelineLayoutMode()).toBe('vertical');
  });

  it('writes timeline preferences through runtime-preferred storage（时间线偏好通过 Runtime 优先存储写入）', async () => {
    const module = await import('@/config/task-timeline-preferences');

    expect(module.setTaskTimelineRange({ kind: 'custom', value: 23, unit: 'h' })).toEqual({
      kind: 'custom',
      value: 23,
      unit: 'h',
    });
    expect(storage[module.TASK_TIMELINE_RANGE_STORAGE_KEY]).toBe('custom:23h');

    expect(module.setTaskTimelineShowPending(true)).toBe(true);
    expect(storage[module.TASK_TIMELINE_SHOW_PENDING_STORAGE_KEY]).toBe('1');

    expect(module.setTaskTimelineSelectedTaskId('task-9')).toBe('task-9');
    expect(storage[module.TASK_TIMELINE_SELECTED_TASK_STORAGE_KEY]).toBe('task-9');

    expect(module.setTaskTimelineLayoutMode('horizontal')).toBe('horizontal');
    expect(storage[module.TASK_TIMELINE_LAYOUT_MODE_STORAGE_KEY]).toBe('horizontal');

    expect(module.setTaskTimelineSelectedTaskId(null)).toBeNull();
    expect(storage).not.toHaveProperty(module.TASK_TIMELINE_SELECTED_TASK_STORAGE_KEY);
  });
});
