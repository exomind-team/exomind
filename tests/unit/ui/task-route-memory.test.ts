import { describe, expect, it } from 'vitest';
import { buildTasksMainSearch, resolveTasksRestorePath, shouldForceTasksMain } from '@/ui/app/pages/task-route-memory';

describe('task route memory helpers', () => {
  it('marks explicit task-root returns with a force-main search flag', () => {
    expect(buildTasksMainSearch()).toEqual({ main: '1' });
    expect(buildTasksMainSearch({ from: 'dag' })).toEqual({ from: 'dag', main: '1' });
  });

  it('skips restore when the search explicitly requests the tasks root', () => {
    expect(shouldForceTasksMain('?main=1')).toBe(true);
    expect(resolveTasksRestorePath('/tasks/dag', '?main=1')).toBeNull();
  });

  it('restores the saved sub-route when no force-main flag is present', () => {
    expect(shouldForceTasksMain('')).toBe(false);
    expect(resolveTasksRestorePath('/tasks/dag', '')).toBe('/tasks/dag');
    expect(resolveTasksRestorePath('/agents', '')).toBeNull();
  });
});
