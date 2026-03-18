export const TASKS_LAST_PATH_KEY = 'exomind:last-tasks-path';
export const TASKS_FORCE_MAIN_QUERY_KEY = 'main';
export const TASKS_FORCE_MAIN_QUERY_VALUE = '1';

export function buildTasksMainSearch(search?: Record<string, string>): Record<string, string> {
  return {
    ...(search ?? {}),
    [TASKS_FORCE_MAIN_QUERY_KEY]: TASKS_FORCE_MAIN_QUERY_VALUE,
  };
}

export function shouldForceTasksMain(search: string): boolean {
  const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(normalizedSearch).get(TASKS_FORCE_MAIN_QUERY_KEY) === TASKS_FORCE_MAIN_QUERY_VALUE;
}

export function resolveTasksRestorePath(savedPath: string | null, search: string): string | null {
  if (shouldForceTasksMain(search)) {
    return null;
  }

  return savedPath && savedPath.startsWith('/tasks/') ? savedPath : null;
}
