import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTasksMainSearch, resolveTasksRestorePath, shouldForceTasksMain } from '@/ui/app/pages/task-route-memory';

describe('task route memory helpers', () => {
  it('marks explicit task-root returns with a force-main search flag', () => {
    expect(buildTasksMainSearch()).toEqual({ main: '1' });
    expect(buildTasksMainSearch({ from: 'dag' })).toEqual({ from: 'dag', main: '1' });
  });

  it('skips restore when the search explicitly requests the tasks root', () => {
    expect(shouldForceTasksMain('?main=1')).toBe(true);
    expect(shouldForceTasksMain('?main=%221%22')).toBe(true);
    expect(resolveTasksRestorePath('/tasks/dag', '?main=1')).toBeNull();
    expect(resolveTasksRestorePath('/tasks/dag', '?main=%221%22')).toBeNull();
  });

  it('restores the saved sub-route when no force-main flag is present', () => {
    expect(shouldForceTasksMain('')).toBe(false);
    expect(resolveTasksRestorePath('/tasks/dag', '')).toBe('/tasks/dag');
    expect(resolveTasksRestorePath('/agents', '')).toBeNull();
  });

  it('reads the tasks-root restore flag from router search state instead of window location', () => {
    const routesSource = readFileSync(path.resolve('src/routes.tsx'), 'utf-8');
    const tasksRouteStart = routesSource.indexOf('const newTasksRoute = createRoute({');
    const remindersRouteStart = routesSource.indexOf('const newRemindersRoute = createRoute({');
    const tasksRouteSource = routesSource.slice(tasksRouteStart, remindersRouteStart);

    expect(tasksRouteSource).toContain("const currentSearch = location.searchStr ?? '';");
    expect(tasksRouteSource).not.toContain('window.location.search');
  });
});
