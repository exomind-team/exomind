import { describe, expect, it } from 'vitest';
import type { TaskNode } from '@/lib/types/task';
import {
  filterMonth,
  filterNow,
  filterToday,
  filterWeek,
  isExecutable,
  sortByDue,
} from '@/ui/app/pages/task-tab-filters';

/* ── helpers ── */

function makeTask(overrides: Partial<TaskNode> & { id: string }): TaskNode {
  return {
    title: overrides.id,
    description: undefined,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/* ── sortByDue ── */

describe('sortByDue（排序契约）', () => {
  it('tasks with dueAt appear before tasks without', () => {
    const withDue = makeTask({ id: 'a', dueAt: 1000, updatedAt: 1 });
    const noDue = makeTask({ id: 'b', updatedAt: 9999 });
    const result = sortByDue([noDue, withDue]);
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('tasks with dueAt are sorted ascending by dueAt', () => {
    const early = makeTask({ id: 'early', dueAt: 100, updatedAt: 1 });
    const late = makeTask({ id: 'late', dueAt: 999, updatedAt: 1 });
    const result = sortByDue([late, early]);
    expect(result.map((t) => t.id)).toEqual(['early', 'late']);
  });

  it('same dueAt breaks tie by updatedAt descending', () => {
    const old = makeTask({ id: 'old', dueAt: 100, updatedAt: 1 });
    const recent = makeTask({ id: 'recent', dueAt: 100, updatedAt: 999 });
    const result = sortByDue([old, recent]);
    expect(result.map((t) => t.id)).toEqual(['recent', 'old']);
  });

  it('no-due tasks are sorted by updatedAt descending', () => {
    const a = makeTask({ id: 'a', updatedAt: 10 });
    const b = makeTask({ id: 'b', updatedAt: 50 });
    const result = sortByDue([a, b]);
    expect(result.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('does not mutate original array', () => {
    const arr = [makeTask({ id: 'x', updatedAt: 1 }), makeTask({ id: 'y', updatedAt: 2 })];
    const original = [...arr];
    sortByDue(arr);
    expect(arr.map((t) => t.id)).toEqual(original.map((t) => t.id));
  });
});

/* ── isExecutable ── */

describe('isExecutable（可执行判定）', () => {
  it('pending with no deps is executable', () => {
    const task = makeTask({ id: 'a', status: 'pending', dependsOn: [] });
    expect(isExecutable(task, [task])).toBe(true);
  });

  it('in_progress task is not executable', () => {
    const task = makeTask({ id: 'a', status: 'in_progress' });
    expect(isExecutable(task, [task])).toBe(false);
  });

  it('pending with completed hard dep is executable', () => {
    const dep = makeTask({ id: 'dep', status: 'completed' });
    const task = makeTask({ id: 'a', status: 'pending', dependsOn: [{ taskId: 'dep', type: 'hard' }] });
    expect(isExecutable(task, [dep, task])).toBe(true);
  });

  it('pending with incomplete hard dep is not executable', () => {
    const dep = makeTask({ id: 'dep', status: 'in_progress' });
    const task = makeTask({ id: 'a', status: 'pending', dependsOn: [{ taskId: 'dep', type: 'hard' }] });
    expect(isExecutable(task, [dep, task])).toBe(false);
  });

  it('soft deps do not block execution', () => {
    const dep = makeTask({ id: 'dep', status: 'pending' });
    const task = makeTask({ id: 'a', status: 'pending', dependsOn: [{ taskId: 'dep', type: 'soft' }] });
    expect(isExecutable(task, [dep, task])).toBe(true);
  });
});

/* ── filterNow ── */

describe('filterNow（"当下" tab）', () => {
  it('pins in_progress tasks to top', () => {
    const active = makeTask({ id: 'a', status: 'in_progress', updatedAt: 1 });
    const idle = makeTask({ id: 'b', status: 'pending', updatedAt: 2 });
    const result = filterNow([idle, active]);
    expect(result[0].id).toBe('a');
  });

  it('shows all non-cancelled tasks', () => {
    const t1 = makeTask({ id: 't1', status: 'pending', updatedAt: 1 });
    const t2 = makeTask({ id: 't2', status: 'pending', updatedAt: 2 });
    const t3 = makeTask({ id: 't3', status: 'suspended', updatedAt: 3 });
    expect(filterNow([t1, t2, t3]).length).toBe(3);
  });

  it('sorts non-in_progress tasks by due date', () => {
    const withDue = makeTask({ id: 'a', status: 'pending', dueAt: 100, updatedAt: 1 });
    const noDue = makeTask({ id: 'b', status: 'pending', updatedAt: 999 });
    const result = filterNow([noDue, withDue]);
    expect(result.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('excludes cancelled tasks', () => {
    const cancelled = makeTask({ id: 'x', status: 'cancelled' });
    const ok = makeTask({ id: 'y', status: 'in_progress' });
    expect(filterNow([cancelled, ok]).map((t) => t.id)).toEqual(['y']);
  });

  it('no limit on total tasks shown', () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: `t${i}`, status: 'pending', updatedAt: i }),
    );
    expect(filterNow(tasks).length).toBe(10);
  });
});

/* ── filterToday ── */

describe('filterToday（"今日" tab）', () => {
  const today = new Date(2026, 2, 5, 12, 0, 0); // 2026-03-05 noon
  const todayStart = new Date(2026, 2, 5, 0, 0, 0).getTime();

  it('includes tasks with dueAt today', () => {
    const task = makeTask({ id: 'a', dueAt: todayStart + 3600_000, updatedAt: todayStart });
    const result = filterToday([task], today);
    expect(result.map((t) => t.id)).toEqual(['a']);
  });

  it('includes in_progress tasks with updatedAt today', () => {
    const task = makeTask({ id: 'a', status: 'in_progress', updatedAt: todayStart + 1000 });
    const result = filterToday([task], today);
    expect(result.map((t) => t.id)).toEqual(['a']);
  });

  it('excludes in_progress tasks updated yesterday', () => {
    const task = makeTask({ id: 'a', status: 'in_progress', updatedAt: todayStart - 1 });
    const result = filterToday([task], today);
    expect(result).toEqual([]);
  });

  it('excludes tasks with dueAt tomorrow', () => {
    const task = makeTask({ id: 'a', dueAt: todayStart + 86_400_000, updatedAt: todayStart });
    const result = filterToday([task], today);
    expect(result).toEqual([]);
  });

  it('excludes cancelled tasks', () => {
    const task = makeTask({ id: 'a', status: 'cancelled', dueAt: todayStart + 1000, updatedAt: todayStart });
    expect(filterToday([task], today)).toEqual([]);
  });

  it('sorts results by due date', () => {
    const late = makeTask({ id: 'late', dueAt: todayStart + 50_000, updatedAt: todayStart });
    const early = makeTask({ id: 'early', dueAt: todayStart + 10_000, updatedAt: todayStart });
    const noDue = makeTask({ id: 'noDue', status: 'in_progress', updatedAt: todayStart + 1000 });
    const result = filterToday([late, noDue, early], today);
    expect(result.map((t) => t.id)).toEqual(['early', 'late', 'noDue']);
  });
});

/* ── filterWeek ── */

describe('filterWeek（"一周" tab）', () => {
  const now = new Date(2026, 2, 5, 12, 0, 0);
  const nowMs = now.getTime();

  it('includes tasks with dueAt within 7 days', () => {
    const task = makeTask({ id: 'a', dueAt: nowMs + 3 * 86_400_000, updatedAt: nowMs });
    expect(filterWeek([task], now).map((t) => t.id)).toEqual(['a']);
  });

  it('excludes tasks with dueAt beyond 7 days', () => {
    const task = makeTask({ id: 'a', dueAt: nowMs + 8 * 86_400_000, updatedAt: nowMs });
    expect(filterWeek([task], now)).toEqual([]);
  });

  it('includes in_progress tasks regardless of dueAt', () => {
    const task = makeTask({ id: 'a', status: 'in_progress', updatedAt: nowMs });
    expect(filterWeek([task], now).map((t) => t.id)).toEqual(['a']);
  });

  it('excludes cancelled tasks', () => {
    const task = makeTask({ id: 'a', status: 'cancelled', dueAt: nowMs + 1000, updatedAt: nowMs });
    expect(filterWeek([task], now)).toEqual([]);
  });

  it('sorts: dueAt asc, no-due at bottom', () => {
    const far = makeTask({ id: 'far', dueAt: nowMs + 5 * 86_400_000, updatedAt: nowMs });
    const near = makeTask({ id: 'near', dueAt: nowMs + 1 * 86_400_000, updatedAt: nowMs });
    const noDue = makeTask({ id: 'noDue', status: 'in_progress', updatedAt: nowMs });
    const result = filterWeek([far, noDue, near], now);
    expect(result.map((t) => t.id)).toEqual(['near', 'far', 'noDue']);
  });
});

/* ── filterMonth ── */

describe('filterMonth（"月" tab）', () => {
  const now = new Date(2026, 2, 5, 12, 0, 0); // March 2026
  const monthStart = new Date(2026, 2, 1).getTime();
  const monthEnd = new Date(2026, 3, 1).getTime();

  it('includes tasks with dueAt in current month', () => {
    const task = makeTask({ id: 'a', dueAt: monthStart + 10 * 86_400_000, updatedAt: monthStart });
    expect(filterMonth([task], now).map((t) => t.id)).toEqual(['a']);
  });

  it('excludes tasks with dueAt in next month', () => {
    const task = makeTask({ id: 'a', dueAt: monthEnd + 1000, updatedAt: monthStart });
    expect(filterMonth([task], now)).toEqual([]);
  });

  it('excludes tasks with dueAt in previous month', () => {
    const task = makeTask({ id: 'a', dueAt: monthStart - 1, updatedAt: monthStart });
    expect(filterMonth([task], now)).toEqual([]);
  });

  it('includes in_progress tasks regardless of dueAt', () => {
    const task = makeTask({ id: 'a', status: 'in_progress', updatedAt: monthStart });
    expect(filterMonth([task], now).map((t) => t.id)).toEqual(['a']);
  });

  it('excludes cancelled tasks', () => {
    const task = makeTask({ id: 'a', status: 'cancelled', dueAt: monthStart + 1000, updatedAt: monthStart });
    expect(filterMonth([task], now)).toEqual([]);
  });
});
