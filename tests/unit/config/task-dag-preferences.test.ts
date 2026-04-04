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
    expect(module.getTaskDagLayoutMode()).toBe('auto');
    expect(module.getTaskDagTerminalFilterMode()).toBe('smart');
    expect(module.getTaskDagFocusMode()).toBe('soft');
    expect(module.getTaskDagBackgroundMode()).toBe('dots');
    expect(module.getTaskDagImmersive()).toBe(false);
    expect(module.getTaskDagSearchDraft()).toBe('');
    expect(module.getTaskDagSearchOptions()).toEqual({
      includeDescription: false,
      fuzzy: true,
      filterMode: false,
    });
    expect(module.getTaskDagTagFilter()).toEqual({
      selectedTags: [],
      matchMode: 'and',
    });
    expect(module.getTaskDagFocusedSeriesAnchorIds()).toEqual([]);
    expect(module.getTaskDagIntervalCollapseState()).toEqual({
      intervals: [],
    });
    expect(module.getTaskDagVisibility()).toEqual({
      collapsedUpstreamOf: [],
      collapsedDownstreamOf: [],
    });
    expect(module.getTaskDagControlsState()).toEqual({
      desktopViewOpen: true,
      desktopToolsOpen: false,
      mobileViewOpen: false,
      mobileToolsOpen: false,
      tagSectionOpen: false,
      focusSectionOpen: false,
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
      'exomind:dag-layout-mode': 'manual',
      'exomind:dag-hide-terminal': 'smart',
      'exomind:dag-focus-mode': 'hard',
      'exomind:dag-background-mode': 'lines',
      'exomind:dag-immersive': '1',
      'exomind:dag-search-draft': 'Markdown',
      'exomind:dag-search-options': JSON.stringify({
        includeDescription: true,
        fuzzy: false,
        filterMode: true,
      }),
      'exomind:dag-tag-filter': JSON.stringify({
        selectedTags: ['backend', 'dag'],
        matchMode: 'or',
      }),
      'exomind:dag-focused-series': JSON.stringify(['task-b', 'task-x']),
      'exomind:dag-interval-collapse': JSON.stringify({
        intervals: [
          { startId: 'task-a', endId: 'task-c', collapsed: true },
        ],
      }),
      'exomind:dag-visibility': JSON.stringify({
        collapsedUpstreamOf: ['task-a'],
        collapsedDownstreamOf: ['task-b'],
      }),
      'exomind:dag-controls-state': JSON.stringify({
        desktopViewOpen: false,
        desktopToolsOpen: true,
        mobileViewOpen: true,
        mobileToolsOpen: 'yes',
        tagSectionOpen: true,
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
    expect(module.getTaskDagLayoutMode()).toBe('manual');
    expect(module.getTaskDagTerminalFilterMode()).toBe('smart');
    expect(module.getTaskDagFocusMode()).toBe('hard');
    expect(module.getTaskDagBackgroundMode()).toBe('lines');
    expect(module.getTaskDagImmersive()).toBe(true);
    expect(module.getTaskDagSearchDraft()).toBe('Markdown');
    expect(module.getTaskDagSearchOptions()).toEqual({
      includeDescription: true,
      fuzzy: false,
      filterMode: true,
    });
    expect(module.getTaskDagTagFilter()).toEqual({
      selectedTags: ['backend', 'dag'],
      matchMode: 'or',
    });
    expect(module.getTaskDagFocusedSeriesAnchorIds()).toEqual(['task-b', 'task-x']);
    expect(module.getTaskDagIntervalCollapseState()).toEqual({
      intervals: [
        { startId: 'task-a', endId: 'task-c', collapsed: true },
      ],
    });
    expect(module.getTaskDagVisibility()).toEqual({
      collapsedUpstreamOf: ['task-a'],
      collapsedDownstreamOf: ['task-b'],
    });
    expect(module.getTaskDagControlsState()).toEqual({
      desktopViewOpen: false,
      desktopToolsOpen: true,
      mobileViewOpen: true,
      mobileToolsOpen: false,
      tagSectionOpen: true,
      focusSectionOpen: false,
    });
    expect(module.getTaskDagViewport('LR')).toEqual({ x: 12, y: 34, zoom: 0.8 });
  });

  it('writes dag preferences through runtime-preferred storage（DAG 偏好通过 Runtime 优先存储写入）', async () => {
    const module = await import('@/config/task-dag-preferences');

    expect(module.TASK_DAG_FOCUS_MODE_STORAGE_KEY).toBe('exomind:dag-focus-mode');
    expect(module.TASK_DAG_FOCUS_MODE_CHANGED_EVENT).toBe('exomind:dag-focus-mode-changed');
    expect(module.TASK_DAG_CONTROLS_STATE_STORAGE_KEY).toBe('exomind:dag-controls-state');
    expect(module.TASK_DAG_CONTROLS_STATE_CHANGED_EVENT).toBe('exomind:dag-controls-state-changed');

    expect(module.setTaskDagMode('connect')).toBe('connect');
    expect(storage[module.TASK_DAG_MODE_STORAGE_KEY]).toBe('connect');

    expect(module.setTaskDagDirection('TB')).toBe('TB');
    expect(storage[module.TASK_DAG_DIRECTION_STORAGE_KEY]).toBe('TB');

    expect(module.setTaskDagLayoutMode('manual')).toBe('manual');
    expect(storage[module.TASK_DAG_LAYOUT_MODE_STORAGE_KEY]).toBe('manual');

    expect(module.setTaskDagTerminalFilterMode('hide')).toBe('hide');
    expect(storage[module.TASK_DAG_HIDE_TERMINAL_STORAGE_KEY]).toBe('hide');

    expect(module.setTaskDagFocusMode('hard')).toBe('hard');
    expect(storage[module.TASK_DAG_FOCUS_MODE_STORAGE_KEY]).toBe('hard');

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

    expect(module.setTaskDagTagFilter({
      selectedTags: ['backend', 'dag'],
      matchMode: 'or',
    })).toEqual({
      selectedTags: ['backend', 'dag'],
      matchMode: 'or',
    });
    expect(JSON.parse(storage[module.TASK_DAG_TAG_FILTER_STORAGE_KEY] ?? '{}')).toEqual({
      selectedTags: ['backend', 'dag'],
      matchMode: 'or',
    });

    expect(module.setTaskDagFocusedSeriesAnchorIds(['task-b', 'task-x', 'task-b', ''])).toEqual([
      'task-b',
      'task-x',
    ]);
    expect(JSON.parse(storage[module.TASK_DAG_FOCUSED_SERIES_STORAGE_KEY] ?? '[]')).toEqual([
      'task-b',
      'task-x',
    ]);

    expect(module.setTaskDagIntervalCollapseState({
      intervals: [
        { startId: 'task-a', endId: 'task-c', collapsed: true },
        { startId: 'task-a', endId: 'task-c', collapsed: false },
        { startId: 'task-b', endId: 'task-d', collapsed: true },
      ],
    })).toEqual({
      intervals: [
        { startId: 'task-a', endId: 'task-c', collapsed: true },
        { startId: 'task-b', endId: 'task-d', collapsed: true },
      ],
    });
    expect(JSON.parse(storage[module.TASK_DAG_INTERVAL_COLLAPSE_STORAGE_KEY] ?? '{}')).toEqual({
      intervals: [
        { startId: 'task-a', endId: 'task-c', collapsed: true },
        { startId: 'task-b', endId: 'task-d', collapsed: true },
      ],
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

    expect(module.setTaskDagControlsState({
      desktopViewOpen: false,
      desktopToolsOpen: true,
      mobileViewOpen: true,
      mobileToolsOpen: 'yes',
      tagSectionOpen: true,
    } as never)).toEqual({
      desktopViewOpen: false,
      desktopToolsOpen: true,
      mobileViewOpen: true,
      mobileToolsOpen: false,
      tagSectionOpen: true,
      focusSectionOpen: false,
    });
    expect(JSON.parse(storage[module.TASK_DAG_CONTROLS_STATE_STORAGE_KEY] ?? '{}')).toEqual({
      desktopViewOpen: false,
      desktopToolsOpen: true,
      mobileViewOpen: true,
      mobileToolsOpen: false,
      tagSectionOpen: true,
      focusSectionOpen: false,
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

  it('accepts legacy single-anchor payloads and clears focused-series storage when empty（兼容旧单锚点 payload，并在清空时移除存储）', async () => {
    const module = await import('@/config/task-dag-preferences');

    storage[module.TASK_DAG_FOCUSED_SERIES_STORAGE_KEY] = 'task-b';
    expect(module.getTaskDagFocusedSeriesAnchorIds()).toEqual(['task-b']);

    expect(module.setTaskDagFocusedSeriesAnchorIds([])).toEqual([]);
    expect(storage[module.TASK_DAG_FOCUSED_SERIES_STORAGE_KEY]).toBeUndefined();
  });
});
