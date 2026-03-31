import type {
  TimelineCustomRange,
  TimelineCustomScaleUnit,
  TimelineRange,
} from '@/ui/app/pages/task-timeline-model';
import {
  readRuntimeBackedValue,
  removeRuntimeBackedValue,
  writeRuntimeBackedValue,
} from './runtime-preference-storage';

export type TaskTimelineLayoutMode = 'vertical' | 'auto' | 'horizontal';

export const TASK_TIMELINE_RANGE_STORAGE_KEY = 'task-timeline-range';
export const TASK_TIMELINE_SELECTED_TASK_STORAGE_KEY = 'task-timeline-selected-task';
export const TASK_TIMELINE_SHOW_PENDING_STORAGE_KEY = 'task-timeline-show-pending';
export const TASK_TIMELINE_LAYOUT_MODE_STORAGE_KEY = 'task-timeline-layout-mode';
export const TASK_TIMELINE_RANGE_CHANGED_EVENT = 'exomind:task-timeline-range-changed';
export const TASK_TIMELINE_SELECTED_TASK_CHANGED_EVENT = 'exomind:task-timeline-selected-task-changed';
export const TASK_TIMELINE_SHOW_PENDING_CHANGED_EVENT = 'exomind:task-timeline-show-pending-changed';
export const TASK_TIMELINE_LAYOUT_MODE_CHANGED_EVENT = 'exomind:task-timeline-layout-mode-changed';

const TIMELINE_SCALE_BOUNDS: Record<TimelineCustomScaleUnit, { min: number; max: number }> = {
  h: { min: 1, max: 23 },
  d: { min: 1, max: 30 },
  m: { min: 1, max: 12 },
  y: { min: 1, max: 10 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function parseTaskTimelineRange(rawValue: string | null): TimelineRange {
  const rangeText = rawValue?.trim() || '1d';
  let range: TimelineRange = '1d';
  if (rangeText === 'today') {
    return '1d';
  }
  if (
    rangeText === '1h'
    || rangeText === '8h'
    || rangeText === '1d'
    || rangeText === '3d'
    || rangeText === '7d'
    || rangeText === '1m'
    || rangeText === '3m'
    || rangeText === '1y'
  ) {
    range = rangeText;
  } else {
    const customMatch = rangeText.match(/^custom:(\d+)([hdmy])$/i) ?? rangeText.match(/^(\d+)([hdmy])$/i);
    if (customMatch) {
      const value = Number.parseInt(customMatch[1] ?? '', 10);
      const unit = customMatch[2]?.toLowerCase() as TimelineCustomScaleUnit | undefined;
      const bounds = unit ? TIMELINE_SCALE_BOUNDS[unit] : null;
      if (Number.isFinite(value) && value > 0 && unit && bounds) {
        range = {
          kind: 'custom',
          value: clamp(value, bounds.min, bounds.max),
          unit,
        } satisfies TimelineCustomRange;
      }
    }
  }

  return range;
}

export function serializeTaskTimelineRange(range: TimelineRange): string {
  if (typeof range === 'string') {
    return range;
  }

  return `custom:${range.value}${range.unit}`;
}

export function getTaskTimelineRange(): TimelineRange {
  return parseTaskTimelineRange(readRuntimeBackedValue(TASK_TIMELINE_RANGE_STORAGE_KEY));
}

export function setTaskTimelineRange(range: TimelineRange): TimelineRange {
  const normalized = parseTaskTimelineRange(serializeTaskTimelineRange(range));
  writeRuntimeBackedValue(
    TASK_TIMELINE_RANGE_STORAGE_KEY,
    serializeTaskTimelineRange(normalized),
    TASK_TIMELINE_RANGE_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskTimelineShowPending(): boolean {
  return readRuntimeBackedValue(TASK_TIMELINE_SHOW_PENDING_STORAGE_KEY) === '1';
}

export function setTaskTimelineShowPending(showPending: boolean): boolean {
  const normalized = Boolean(showPending);
  writeRuntimeBackedValue(
    TASK_TIMELINE_SHOW_PENDING_STORAGE_KEY,
    normalized ? '1' : '0',
    TASK_TIMELINE_SHOW_PENDING_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskTimelineSelectedTaskId(): string | null {
  const taskId = readRuntimeBackedValue(TASK_TIMELINE_SELECTED_TASK_STORAGE_KEY);
  return taskId && taskId.trim().length > 0 ? taskId : null;
}

export function setTaskTimelineSelectedTaskId(taskId: string | null): string | null {
  const normalized = taskId?.trim() || null;
  if (!normalized) {
    removeRuntimeBackedValue(TASK_TIMELINE_SELECTED_TASK_STORAGE_KEY);
    return null;
  }

  writeRuntimeBackedValue(
    TASK_TIMELINE_SELECTED_TASK_STORAGE_KEY,
    normalized,
    TASK_TIMELINE_SELECTED_TASK_CHANGED_EVENT,
  );
  return normalized;
}

export function getTaskTimelineLayoutMode(): TaskTimelineLayoutMode {
  const rawValue = readRuntimeBackedValue(TASK_TIMELINE_LAYOUT_MODE_STORAGE_KEY);
  return rawValue === 'horizontal' || rawValue === 'vertical' || rawValue === 'auto'
    ? rawValue
    : 'auto';
}

export function setTaskTimelineLayoutMode(layoutMode: TaskTimelineLayoutMode): TaskTimelineLayoutMode {
  const normalized = layoutMode === 'horizontal' || layoutMode === 'vertical' ? layoutMode : 'auto';
  writeRuntimeBackedValue(
    TASK_TIMELINE_LAYOUT_MODE_STORAGE_KEY,
    normalized,
    TASK_TIMELINE_LAYOUT_MODE_CHANGED_EVENT,
  );
  return normalized;
}
