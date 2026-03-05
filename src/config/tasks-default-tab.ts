export const TASKS_DEFAULT_TAB_STORAGE_KEY = 'exomind:tasks-default-tab';

export const TASKS_DEFAULT_TAB_VALUES = ['now', 'today', 'week', 'month'] as const;
export type TasksDefaultTab = (typeof TASKS_DEFAULT_TAB_VALUES)[number];

function normalizeTab(rawValue: string | null): TasksDefaultTab | null {
  if (!rawValue) return null;
  if ((TASKS_DEFAULT_TAB_VALUES as readonly string[]).includes(rawValue)) {
    return rawValue as TasksDefaultTab;
  }
  return null;
}

function getStorage():
  | Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  if (typeof localStorageLike.removeItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

export function getTasksDefaultTab(): TasksDefaultTab | null {
  const storage = getStorage();
  if (!storage) return null;
  return normalizeTab(storage.getItem(TASKS_DEFAULT_TAB_STORAGE_KEY));
}

export function setTasksDefaultTab(tab: TasksDefaultTab | null): void {
  const storage = getStorage();
  if (!storage) return;
  if (!tab) {
    storage.removeItem(TASKS_DEFAULT_TAB_STORAGE_KEY);
    return;
  }
  storage.setItem(TASKS_DEFAULT_TAB_STORAGE_KEY, tab);
}

export function consumeTasksDefaultTab(): TasksDefaultTab | null {
  const tab = getTasksDefaultTab();
  const storage = getStorage();
  if (!tab || !storage) {
    return tab;
  }
  storage.removeItem(TASKS_DEFAULT_TAB_STORAGE_KEY);
  return tab;
}
