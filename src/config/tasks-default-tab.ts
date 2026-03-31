import {
  getRuntimeConfigValueSync,
  removeRuntimeConfigValue,
  setRuntimeConfigValue,
} from './runtime-config-cache';

export const TASKS_DEFAULT_TAB_STORAGE_KEY = 'exomind:tasks-default-tab';

export const TASKS_DEFAULT_TAB_VALUES = ['now', 'today', 'week', 'month', 'dag'] as const;
export type TasksDefaultTab = (typeof TASKS_DEFAULT_TAB_VALUES)[number];

function normalizeTab(rawValue: string | null | undefined): TasksDefaultTab | null {
  if (!rawValue) return null;
  if ((TASKS_DEFAULT_TAB_VALUES as readonly string[]).includes(rawValue)) {
    return rawValue as TasksDefaultTab;
  }
  return null;
}

export function getTasksDefaultTab(): TasksDefaultTab | null {
  return normalizeTab(getRuntimeConfigValueSync(TASKS_DEFAULT_TAB_STORAGE_KEY));
}

export function setTasksDefaultTab(tab: TasksDefaultTab | null): void {
  if (!tab) {
    removeRuntimeConfigValue(TASKS_DEFAULT_TAB_STORAGE_KEY);
    return;
  }
  setRuntimeConfigValue(TASKS_DEFAULT_TAB_STORAGE_KEY, tab, {
    source: 'exomind:tasks-default-tab-changed',
    sourceOrigin: typeof window !== 'undefined' ? window.location?.origin : undefined,
  });
}

export function consumeTasksDefaultTab(): TasksDefaultTab | null {
  const tab = getTasksDefaultTab();
  if (!tab) {
    return tab;
  }
  removeRuntimeConfigValue(TASKS_DEFAULT_TAB_STORAGE_KEY);
  return tab;
}
