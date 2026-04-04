import type { TaskDagVisibilityState } from '@/lib/task/task-dag-visibility';
import type { DagDirection } from '@/ui/app/pages/task-dag-layout';
import {
  readRuntimeBackedValue,
  removeRuntimeBackedValue,
  writeRuntimeBackedValue,
} from './runtime-preference-storage';

export type TaskDagMode = 'browse' | 'connect' | 'execute';
export type TaskDagLayoutMode = 'auto' | 'manual';
export type TaskDagTerminalFilterMode = 'show' | 'smart' | 'hide';
export type TaskDagFocusMode = 'soft' | 'hard';
export type TaskDagBackgroundMode = 'none' | 'dots' | 'lines';
export type TaskDagViewportSurface = 'desktop' | 'mobile';
export type TaskDagSearchOptions = {
  includeDescription: boolean;
  fuzzy: boolean;
  filterMode: boolean;
};
export type TaskDagTagFilter = {
  selectedTags: string[];
  matchMode: 'and' | 'or';
};
export type TaskDagViewport = {
  x: number;
  y: number;
  zoom: number;
};
export type TaskDagControlsState = {
  desktopViewOpen: boolean;
  desktopToolsOpen: boolean;
  mobileViewOpen: boolean;
  mobileToolsOpen: boolean;
  tagSectionOpen: boolean;
  focusSectionOpen: boolean;
};

export const TASK_DAG_MODE_STORAGE_KEY = 'exomind:dag-mode';
export const TASK_DAG_DIRECTION_STORAGE_KEY = 'exomind:dag-direction';
export const TASK_DAG_LAYOUT_MODE_STORAGE_KEY = 'exomind:dag-layout-mode';
export const TASK_DAG_HIDE_TERMINAL_STORAGE_KEY = 'exomind:dag-hide-terminal';
export const TASK_DAG_FOCUS_MODE_STORAGE_KEY = 'exomind:dag-focus-mode';
export const TASK_DAG_BACKGROUND_STORAGE_KEY = 'exomind:dag-background-mode';
export const TASK_DAG_IMMERSIVE_STORAGE_KEY = 'exomind:dag-immersive';
export const TASK_DAG_VIEWPORT_STORAGE_KEY = 'exomind:dag-viewport';
export const TASK_DAG_SEARCH_DRAFT_STORAGE_KEY = 'exomind:dag-search-draft';
export const TASK_DAG_SEARCH_OPTIONS_STORAGE_KEY = 'exomind:dag-search-options';
export const TASK_DAG_TAG_FILTER_STORAGE_KEY = 'exomind:dag-tag-filter';
export const TASK_DAG_FOCUSED_SERIES_STORAGE_KEY = 'exomind:dag-focused-series';
export const TASK_DAG_VISIBILITY_STORAGE_KEY = 'exomind:dag-visibility';
export const TASK_DAG_CONTROLS_STATE_STORAGE_KEY = 'exomind:dag-controls-state';
export const TASK_DAG_MODE_CHANGED_EVENT = 'exomind:dag-mode-changed';
export const TASK_DAG_DIRECTION_CHANGED_EVENT = 'exomind:dag-direction-changed';
export const TASK_DAG_LAYOUT_MODE_CHANGED_EVENT = 'exomind:dag-layout-mode-changed';
export const TASK_DAG_HIDE_TERMINAL_CHANGED_EVENT = 'exomind:dag-hide-terminal-changed';
export const TASK_DAG_FOCUS_MODE_CHANGED_EVENT = 'exomind:dag-focus-mode-changed';
export const TASK_DAG_BACKGROUND_CHANGED_EVENT = 'exomind:dag-background-mode-changed';
export const TASK_DAG_IMMERSIVE_CHANGED_EVENT = 'exomind:dag-immersive-changed';
export const TASK_DAG_VIEWPORT_CHANGED_EVENT = 'exomind:dag-viewport-changed';
export const TASK_DAG_SEARCH_DRAFT_CHANGED_EVENT = 'exomind:dag-search-draft-changed';
export const TASK_DAG_SEARCH_OPTIONS_CHANGED_EVENT = 'exomind:dag-search-options-changed';
export const TASK_DAG_TAG_FILTER_CHANGED_EVENT = 'exomind:dag-tag-filter-changed';
export const TASK_DAG_FOCUSED_SERIES_CHANGED_EVENT = 'exomind:dag-focused-series-changed';
export const TASK_DAG_VISIBILITY_CHANGED_EVENT = 'exomind:dag-visibility-changed';
export const TASK_DAG_CONTROLS_STATE_CHANGED_EVENT = 'exomind:dag-controls-state-changed';

const DEFAULT_TASK_DAG_SEARCH_OPTIONS: TaskDagSearchOptions = {
  includeDescription: false,
  fuzzy: true,
  filterMode: false,
};
const DEFAULT_TASK_DAG_TAG_FILTER: TaskDagTagFilter = {
  selectedTags: [],
  matchMode: 'and',
};
const DEFAULT_TASK_DAG_CONTROLS_STATE: TaskDagControlsState = {
  desktopViewOpen: true,
  desktopToolsOpen: false,
  mobileViewOpen: false,
  mobileToolsOpen: false,
  tagSectionOpen: false,
  focusSectionOpen: false,
};

const EMPTY_TASK_DAG_VISIBILITY_STATE: TaskDagVisibilityState = {
  collapsedUpstreamOf: [],
  collapsedDownstreamOf: [],
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeViewportSurface(surface: TaskDagViewportSurface | undefined): TaskDagViewportSurface {
  return surface === 'mobile' ? 'mobile' : 'desktop';
}

export function getTaskDagMode(): TaskDagMode {
  const saved = readRuntimeBackedValue(TASK_DAG_MODE_STORAGE_KEY);
  return saved === 'connect' || saved === 'execute' ? saved : 'browse';
}

export function setTaskDagMode(mode: TaskDagMode): TaskDagMode {
  const normalized = mode === 'connect' || mode === 'execute' ? mode : 'browse';
  writeRuntimeBackedValue(TASK_DAG_MODE_STORAGE_KEY, normalized, TASK_DAG_MODE_CHANGED_EVENT);
  return normalized;
}

export function getTaskDagDirection(): DagDirection {
  const saved = readRuntimeBackedValue(TASK_DAG_DIRECTION_STORAGE_KEY);
  return saved === 'TB' || saved === 'LR' || saved === 'auto' ? saved : 'auto';
}

export function getTaskDagLayoutMode(): TaskDagLayoutMode {
  return readRuntimeBackedValue(TASK_DAG_LAYOUT_MODE_STORAGE_KEY) === 'manual' ? 'manual' : 'auto';
}

export function setTaskDagLayoutMode(mode: TaskDagLayoutMode): TaskDagLayoutMode {
  const normalized = mode === 'manual' ? 'manual' : 'auto';
  writeRuntimeBackedValue(
    TASK_DAG_LAYOUT_MODE_STORAGE_KEY,
    normalized,
    TASK_DAG_LAYOUT_MODE_CHANGED_EVENT,
  );
  return normalized;
}

export function setTaskDagDirection(direction: DagDirection): DagDirection {
  const normalized = direction === 'TB' || direction === 'LR' ? direction : 'auto';
  writeRuntimeBackedValue(
    TASK_DAG_DIRECTION_STORAGE_KEY,
    normalized,
    TASK_DAG_DIRECTION_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagTerminalFilterMode(): TaskDagTerminalFilterMode {
  const saved = readRuntimeBackedValue(TASK_DAG_HIDE_TERMINAL_STORAGE_KEY);
  if (saved === 'show' || saved === 'smart' || saved === 'hide') {
    return saved;
  }
  if (saved === '1' || saved === 'true') {
    return 'smart';
  }
  if (saved === '0' || saved === 'false') {
    return 'show';
  }
  return 'smart';
}

export function setTaskDagTerminalFilterMode(mode: TaskDagTerminalFilterMode): TaskDagTerminalFilterMode {
  const normalized = mode === 'smart' || mode === 'hide' ? mode : 'show';
  writeRuntimeBackedValue(
    TASK_DAG_HIDE_TERMINAL_STORAGE_KEY,
    normalized,
    TASK_DAG_HIDE_TERMINAL_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagFocusMode(): TaskDagFocusMode {
  return readRuntimeBackedValue(TASK_DAG_FOCUS_MODE_STORAGE_KEY) === 'hard' ? 'hard' : 'soft';
}

export function setTaskDagFocusMode(mode: TaskDagFocusMode): TaskDagFocusMode {
  const normalized = mode === 'hard' ? 'hard' : 'soft';
  writeRuntimeBackedValue(
    TASK_DAG_FOCUS_MODE_STORAGE_KEY,
    normalized,
    TASK_DAG_FOCUS_MODE_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagBackgroundMode(): TaskDagBackgroundMode {
  const saved = readRuntimeBackedValue(TASK_DAG_BACKGROUND_STORAGE_KEY);
  return saved === 'none' || saved === 'lines' ? saved : 'dots';
}

export function setTaskDagBackgroundMode(mode: TaskDagBackgroundMode): TaskDagBackgroundMode {
  const normalized = mode === 'none' || mode === 'lines' ? mode : 'dots';
  writeRuntimeBackedValue(
    TASK_DAG_BACKGROUND_STORAGE_KEY,
    normalized,
    TASK_DAG_BACKGROUND_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagImmersive(): boolean {
  return readRuntimeBackedValue(TASK_DAG_IMMERSIVE_STORAGE_KEY) === '1';
}

export function setTaskDagImmersive(immersive: boolean): boolean {
  const normalized = Boolean(immersive);
  writeRuntimeBackedValue(
    TASK_DAG_IMMERSIVE_STORAGE_KEY,
    normalized ? '1' : '0',
    TASK_DAG_IMMERSIVE_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagSearchOptions(): TaskDagSearchOptions {
  try {
    const raw = readRuntimeBackedValue(TASK_DAG_SEARCH_OPTIONS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TASK_DAG_SEARCH_OPTIONS;
    }

    const parsed = JSON.parse(raw) as Partial<TaskDagSearchOptions>;
    return {
      ...DEFAULT_TASK_DAG_SEARCH_OPTIONS,
      ...parsed,
    };
  } catch {
    return DEFAULT_TASK_DAG_SEARCH_OPTIONS;
  }
}

export function setTaskDagSearchOptions(options: TaskDagSearchOptions): TaskDagSearchOptions {
  const normalized = {
    ...DEFAULT_TASK_DAG_SEARCH_OPTIONS,
    ...options,
  };
  writeRuntimeBackedValue(
    TASK_DAG_SEARCH_OPTIONS_STORAGE_KEY,
    JSON.stringify(normalized),
    TASK_DAG_SEARCH_OPTIONS_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagSearchDraft(): string {
  return readRuntimeBackedValue(TASK_DAG_SEARCH_DRAFT_STORAGE_KEY) ?? '';
}

export function setTaskDagSearchDraft(draft: string): string {
  const normalized = draft ?? '';
  writeRuntimeBackedValue(
    TASK_DAG_SEARCH_DRAFT_STORAGE_KEY,
    normalized,
    TASK_DAG_SEARCH_DRAFT_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagTagFilter(): TaskDagTagFilter {
  try {
    const raw = readRuntimeBackedValue(TASK_DAG_TAG_FILTER_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TASK_DAG_TAG_FILTER;
    }

    const parsed = JSON.parse(raw) as Partial<TaskDagTagFilter>;
    return {
      selectedTags: Array.isArray(parsed.selectedTags)
        ? parsed.selectedTags
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
        : [],
      matchMode: parsed.matchMode === 'or' ? 'or' : 'and',
    };
  } catch {
    return DEFAULT_TASK_DAG_TAG_FILTER;
  }
}

export function setTaskDagTagFilter(tagFilter: TaskDagTagFilter): TaskDagTagFilter {
  const normalized: TaskDagTagFilter = {
    selectedTags: Array.isArray(tagFilter.selectedTags)
      ? Array.from(new Set(
        tagFilter.selectedTags
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ))
      : [],
    matchMode: tagFilter.matchMode === 'or' ? 'or' : 'and',
  };
  writeRuntimeBackedValue(
    TASK_DAG_TAG_FILTER_STORAGE_KEY,
    JSON.stringify(normalized),
    TASK_DAG_TAG_FILTER_CHANGED_EVENT,
  );
  return normalized;
}

function normalizeFocusedSeriesAnchorIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

export function getTaskDagFocusedSeriesAnchorIds(): string[] {
  const saved = readRuntimeBackedValue(TASK_DAG_FOCUSED_SERIES_STORAGE_KEY);
  if (!saved) {
    return [];
  }

  try {
    const parsed = JSON.parse(saved) as unknown;
    if (typeof parsed === 'string') {
      return parsed.trim() ? [parsed.trim()] : [];
    }
    return normalizeFocusedSeriesAnchorIds(parsed);
  } catch {
    const normalized = saved.trim();
    return normalized ? [normalized] : [];
  }
}

export function setTaskDagFocusedSeriesAnchorIds(anchorIds: string[]): string[] {
  const normalized = normalizeFocusedSeriesAnchorIds(anchorIds);
  if (normalized.length === 0) {
    removeRuntimeBackedValue(TASK_DAG_FOCUSED_SERIES_STORAGE_KEY);
    return [];
  }

  writeRuntimeBackedValue(
    TASK_DAG_FOCUSED_SERIES_STORAGE_KEY,
    JSON.stringify(normalized),
    TASK_DAG_FOCUSED_SERIES_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagFocusedSeriesAnchorId(): string | null {
  return getTaskDagFocusedSeriesAnchorIds()[0] ?? null;
}

export function setTaskDagFocusedSeriesAnchorId(anchorId: string | null): string | null {
  return setTaskDagFocusedSeriesAnchorIds(anchorId ? [anchorId] : [])[0] ?? null;
}

function normalizeControlsState(
  controlsState: Partial<TaskDagControlsState> | null | undefined,
): TaskDagControlsState {
  return {
    desktopViewOpen: typeof controlsState?.desktopViewOpen === 'boolean'
      ? controlsState.desktopViewOpen
      : DEFAULT_TASK_DAG_CONTROLS_STATE.desktopViewOpen,
    desktopToolsOpen: typeof controlsState?.desktopToolsOpen === 'boolean'
      ? controlsState.desktopToolsOpen
      : DEFAULT_TASK_DAG_CONTROLS_STATE.desktopToolsOpen,
    mobileViewOpen: typeof controlsState?.mobileViewOpen === 'boolean'
      ? controlsState.mobileViewOpen
      : DEFAULT_TASK_DAG_CONTROLS_STATE.mobileViewOpen,
    mobileToolsOpen: typeof controlsState?.mobileToolsOpen === 'boolean'
      ? controlsState.mobileToolsOpen
      : DEFAULT_TASK_DAG_CONTROLS_STATE.mobileToolsOpen,
    tagSectionOpen: typeof controlsState?.tagSectionOpen === 'boolean'
      ? controlsState.tagSectionOpen
      : DEFAULT_TASK_DAG_CONTROLS_STATE.tagSectionOpen,
    focusSectionOpen: typeof controlsState?.focusSectionOpen === 'boolean'
      ? controlsState.focusSectionOpen
      : DEFAULT_TASK_DAG_CONTROLS_STATE.focusSectionOpen,
  };
}

export function getTaskDagControlsState(): TaskDagControlsState {
  try {
    const raw = readRuntimeBackedValue(TASK_DAG_CONTROLS_STATE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TASK_DAG_CONTROLS_STATE;
    }
    return normalizeControlsState(JSON.parse(raw) as Partial<TaskDagControlsState>);
  } catch {
    return DEFAULT_TASK_DAG_CONTROLS_STATE;
  }
}

export function setTaskDagControlsState(controlsState: TaskDagControlsState): TaskDagControlsState {
  const normalized = normalizeControlsState(controlsState);
  writeRuntimeBackedValue(
    TASK_DAG_CONTROLS_STATE_STORAGE_KEY,
    JSON.stringify(normalized),
    TASK_DAG_CONTROLS_STATE_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagVisibility(): TaskDagVisibilityState {
  try {
    const raw = readRuntimeBackedValue(TASK_DAG_VISIBILITY_STORAGE_KEY);
    if (!raw) {
      return EMPTY_TASK_DAG_VISIBILITY_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<TaskDagVisibilityState>;
    return {
      collapsedUpstreamOf: Array.isArray(parsed.collapsedUpstreamOf)
        ? parsed.collapsedUpstreamOf.filter((value): value is string => typeof value === 'string')
        : [],
      collapsedDownstreamOf: Array.isArray(parsed.collapsedDownstreamOf)
        ? parsed.collapsedDownstreamOf.filter((value): value is string => typeof value === 'string')
        : [],
    };
  } catch {
    return EMPTY_TASK_DAG_VISIBILITY_STATE;
  }
}

export function setTaskDagVisibility(visibility: TaskDagVisibilityState): TaskDagVisibilityState {
  const normalized = {
    collapsedUpstreamOf: Array.isArray(visibility.collapsedUpstreamOf)
      ? visibility.collapsedUpstreamOf.filter((value): value is string => typeof value === 'string')
      : [],
    collapsedDownstreamOf: Array.isArray(visibility.collapsedDownstreamOf)
      ? visibility.collapsedDownstreamOf.filter((value): value is string => typeof value === 'string')
      : [],
  };
  writeRuntimeBackedValue(
    TASK_DAG_VISIBILITY_STORAGE_KEY,
    JSON.stringify(normalized),
    TASK_DAG_VISIBILITY_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskDagViewport(
  direction: DagDirection,
  surface: TaskDagViewportSurface = 'desktop',
): TaskDagViewport | null {
  try {
    const raw = readRuntimeBackedValue(TASK_DAG_VIEWPORT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      surface?: unknown;
      direction?: unknown;
      x?: unknown;
      y?: unknown;
      zoom?: unknown;
    };
    if (parsed.surface !== normalizeViewportSurface(surface)) {
      return null;
    }
    if (parsed.direction !== direction) {
      return null;
    }
    if (!isFiniteNumber(parsed.x) || !isFiniteNumber(parsed.y) || !isFiniteNumber(parsed.zoom)) {
      return null;
    }
    return {
      x: parsed.x,
      y: parsed.y,
      zoom: parsed.zoom,
    };
  } catch {
    return null;
  }
}

export function setTaskDagViewport(
  direction: DagDirection,
  viewport: TaskDagViewport,
  surface: TaskDagViewportSurface = 'desktop',
): void {
  writeRuntimeBackedValue(
    TASK_DAG_VIEWPORT_STORAGE_KEY,
    JSON.stringify({
      surface: normalizeViewportSurface(surface),
      direction,
      x: viewport.x,
      y: viewport.y,
      zoom: viewport.zoom,
    }),
    TASK_DAG_VIEWPORT_CHANGED_EVENT,
  );
}
