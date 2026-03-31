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

describe('task dag preferences（任务 DAG 偏好）', () => {
  let storage: Record<string, string>;

  beforeEach(async () => {
    vi.resetModules();
    storage = {};
    installStorageStub(storage);

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__resetRuntimeConfigCacheForTests();
  });

  it('defaults dag preferences to expected values（默认 DAG 偏好正确）', async () => {
    const module = await import('@/config/task-dag-preferences');

    expect(module.getTaskDagMode()).toBe('browse');
    expect(module.getTaskDagDirection()).toBe('auto');
    expect(module.getTaskDagTerminalFilterMode()).toBe('show');
    expect(module.getTaskDagBackgroundMode()).toBe('dots');
    expect(module.getTaskDagImmersive()).toBe(false);
    expect(module.getTaskDagSearchDraft()).toBe('');
    expect(module.getTaskDagSearchOptions()).toEqual({
      includeDescription: false,
      fuzzy: true,
      filterMode: false,
    });
    expect(module.getTaskDagVisibility()).toEqual({
      collapsedUpstreamOf: [],
      collapsedDownstreamOf: [],
    });
    expect(module.getTaskDagViewport('TB')).toBeNull();
  });

  it('reads runtime-backed dag preferences before local mirror（优先读取 Runtime 中的 DAG 偏好）', async () => {
    storage['exomind:dag-mode'] = 'browse';
    storage['exomind:dag-direction'] = 'auto';
    storage['exomind:dag-hide-terminal'] = 'show';
    storage['exomind:dag-background-mode'] = 'dots';
    storage['exomind:dag-immersive'] = '0';

    const cacheModule = await import('@/config/runtime-config-cache');
    cacheModule.__primeRuntimeConfigForTests({
      'exomind:dag-mode': 'execute',
      'exomind:dag-direction': 'LR',
      'exomind:dag-hide-terminal': 'smart',
      'exomind:dag-background-mode': 'lines',
      'exomind:dag-immersive': '1',
      'exomind:dag-search-draft': 'Markdown',
      'exomind:dag-search-options': JSON.stringify({
        includeDescription: true,
        fuzzy: false,
        filterMode: true,
      }),
      'exomind:dag-visibility': JSON.stringify({
        collapsedUpstreamOf: ['task-a'],
        collapsedDownstreamOf: ['task-b'],
      }),
      'exomind:dag-viewport': JSON.stringify({
        surface: 'desktop',
        direction: 'LR',
        x: 12,
        y: 34,
        zoom: 0.8,
      }),
    });

    const module = await import('@/config/task-dag-preferences');

    expect(module.getTaskDagMode()).toBe('execute');
    expect(module.getTaskDagDirection()).toBe('LR');
    expect(module.getTaskDagTerminalFilterMode()).toBe('smart');
    expect(module.getTaskDagBackgroundMode()).toBe('lines');
    expect(module.getTaskDagImmersive()).toBe(true);
    expect(module.getTaskDagSearchDraft()).toBe('Markdown');
    expect(module.getTaskDagSearchOptions()).toEqual({
      includeDescription: true,
      fuzzy: false,
      filterMode: true,
    });
    expect(module.getTaskDagVisibility()).toEqual({
      collapsedUpstreamOf: ['task-a'],
      collapsedDownstreamOf: ['task-b'],
    });
    expect(module.getTaskDagViewport('LR')).toEqual({ x: 12, y: 34, zoom: 0.8 });
  });

  it('writes dag preferences through runtime-preferred storage（DAG 偏好通过 Runtime 优先存储写入）', async () => {
    const module = await import('@/config/task-dag-preferences');

    expect(module.setTaskDagMode('connect')).toBe('connect');
    expect(storage[module.TASK_DAG_MODE_STORAGE_KEY]).toBe('connect');

    expect(module.setTaskDagDirection('TB')).toBe('TB');
    expect(storage[module.TASK_DAG_DIRECTION_STORAGE_KEY]).toBe('TB');

    expect(module.setTaskDagTerminalFilterMode('hide')).toBe('hide');
    expect(storage[module.TASK_DAG_HIDE_TERMINAL_STORAGE_KEY]).toBe('hide');

    expect(module.setTaskDagBackgroundMode('none')).toBe('none');
    expect(storage[module.TASK_DAG_BACKGROUND_STORAGE_KEY]).toBe('none');

    expect(module.setTaskDagImmersive(true)).toBe(true);
    expect(storage[module.TASK_DAG_IMMERSIVE_STORAGE_KEY]).toBe('1');

    expect(module.setTaskDagSearchDraft('task keyword')).toBe('task keyword');
    expect(storage[module.TASK_DAG_SEARCH_DRAFT_STORAGE_KEY]).toBe('task keyword');

    expect(module.setTaskDagSearchOptions({
      includeDescription: true,
      fuzzy: false,
      filterMode: true,
    })).toEqual({
      includeDescription: true,
      fuzzy: false,
      filterMode: true,
    });
    expect(JSON.parse(storage[module.TASK_DAG_SEARCH_OPTIONS_STORAGE_KEY] ?? '{}')).toEqual({
      includeDescription: true,
      fuzzy: false,
      filterMode: true,
    });

    expect(module.setTaskDagVisibility({
      collapsedUpstreamOf: ['task-x'],
      collapsedDownstreamOf: ['task-y'],
    })).toEqual({
      collapsedUpstreamOf: ['task-x'],
      collapsedDownstreamOf: ['task-y'],
    });
    expect(JSON.parse(storage[module.TASK_DAG_VISIBILITY_STORAGE_KEY] ?? '{}')).toEqual({
      collapsedUpstreamOf: ['task-x'],
      collapsedDownstreamOf: ['task-y'],
    });

    module.setTaskDagViewport('TB', { x: 5, y: 7, zoom: 0.9 });
    expect(JSON.parse(storage[module.TASK_DAG_VIEWPORT_STORAGE_KEY] ?? '{}')).toEqual({
      surface: 'desktop',
      direction: 'TB',
      x: 5,
      y: 7,
      zoom: 0.9,
    });
  });

  it('isolates dag viewport by surface and ignores legacy viewport payloads without surface（DAG 视口会按桌面/移动端隔离，并忽略旧版 payload）', async () => {
    const module = await import('@/config/task-dag-preferences');

    storage[module.TASK_DAG_VIEWPORT_STORAGE_KEY] = JSON.stringify({
      direction: 'TB',
      x: 80,
      y: 120,
      zoom: 0.75,
    });
    expect(module.getTaskDagViewport('TB', 'desktop')).toBeNull();

    module.setTaskDagViewport('TB', { x: 10, y: 20, zoom: 0.5 }, 'mobile');
    expect(module.getTaskDagViewport('TB', 'desktop')).toBeNull();
    expect(module.getTaskDagViewport('TB', 'mobile')).toEqual({ x: 10, y: 20, zoom: 0.5 });
  });
});
