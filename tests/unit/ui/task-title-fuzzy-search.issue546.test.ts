import { describe, expect, it } from 'vitest';
import type { TaskNode } from '@/lib/types/task';
import {
  extractTaskTitleSearchQuery,
  filterTasksByTitleFuzzySearch,
  getTaskTitleFuzzyScore,
} from '@/ui/app/pages/task-title-fuzzy-search';

function makeTask(id: string, title: string): TaskNode {
  return {
    id,
    title,
    description: undefined,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('task title fuzzy search issue-546（任务页标题模糊搜索）', () => {
  it('extracts only the first line from the input', () => {
    expect(extractTaskTitleSearchQuery(' Alpha Beta \n第二行不参与匹配')).toBe('Alpha Beta');
  });

  it('scores by total character occurrences and filters titles missing any query char', () => {
    const tasks = [
      makeTask('task-1', 'aba'),
      makeTask('task-2', 'baaab'),
      makeTask('task-3', 'delta'),
      makeTask('task-4', 'abacus'),
    ];

    expect(getTaskTitleFuzzyScore('baaab', 'ab')).toBe(5);
    expect(getTaskTitleFuzzyScore('delta', 'ab')).toBeNull();
    expect(filterTasksByTitleFuzzySearch(tasks, 'ab').map((task) => task.id)).toEqual([
      'task-2',
      'task-1',
      'task-4',
    ]);
  });

  it('requires repeated query characters to appear at least as many times in the title', () => {
    const tasks = [
      makeTask('task-1', '55'),
      makeTask('task-2', '1555 bug'),
      makeTask('task-3', '50505'),
    ];

    expect(getTaskTitleFuzzyScore('55', '555')).toBeNull();
    expect(filterTasksByTitleFuzzySearch(tasks, '555').map((task) => task.id)).toEqual([
      'task-2',
      'task-3',
    ]);
  });

  it('prioritizes longer continuous matches before total character frequency', () => {
    const tasks = [
      makeTask('task-1', 'Hub 123 Git'),
      makeTask('task-2', 'GitHub issue#455'),
      makeTask('task-3', 'Git-X-Hub notes'),
    ];

    expect(filterTasksByTitleFuzzySearch(tasks, 'GitHub').map((task) => task.id)).toEqual([
      'task-2',
      'task-3',
      'task-1',
    ]);
  });

  it('sorts search results by status priority, then createdAt desc, before fuzzy tie-breakers', () => {
    const tasks = [
      { ...makeTask('task-completed', 'baaab'), status: 'completed' as const, createdAt: 120, updatedAt: 120 },
      { ...makeTask('task-pending-old', 'baaab'), status: 'pending' as const, createdAt: 20, updatedAt: 20 },
      { ...makeTask('task-in-progress', 'ab'), status: 'in_progress' as const, createdAt: 10, updatedAt: 10 },
      { ...makeTask('task-cancelled', 'ababa'), status: 'cancelled' as const, createdAt: 200, updatedAt: 200 },
      { ...makeTask('task-suspended', 'abacus'), status: 'suspended' as const, createdAt: 30, updatedAt: 30 },
      { ...makeTask('task-pending-new', 'ab'), status: 'pending' as const, createdAt: 90, updatedAt: 90 },
    ];

    expect(filterTasksByTitleFuzzySearch(tasks, 'ab').map((task) => task.id)).toEqual([
      'task-in-progress',
      'task-suspended',
      'task-pending-new',
      'task-pending-old',
      'task-completed',
      'task-cancelled',
    ]);
  });
});
