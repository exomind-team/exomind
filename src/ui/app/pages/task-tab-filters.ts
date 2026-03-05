import type { TaskNode } from '@/lib/types/task';

/** Sort contract: dueAt asc (tasks with due date first), no-due at bottom, tiebreak by updatedAt desc */
export function sortByDue(tasks: TaskNode[]): TaskNode[] {
  return [...tasks].sort((a, b) => {
    const aHasDue = a.dueAt !== undefined;
    const bHasDue = b.dueAt !== undefined;
    if (aHasDue && !bHasDue) return -1;
    if (!aHasDue && bHasDue) return 1;
    if (aHasDue && bHasDue) {
      const diff = a.dueAt! - b.dueAt!;
      if (diff !== 0) return diff;
    }
    return b.updatedAt - a.updatedAt;
  });
}

/** Check if a not_started task has all hard dependencies completed */
export function isExecutable(task: TaskNode, allTasks: TaskNode[]): boolean {
  if (task.status !== 'not_started') return false;
  const hardDeps = task.dependsOn.filter((d) => d.type === 'hard');
  if (hardDeps.length === 0) return true;
  return hardDeps.every((dep) => {
    const depTask = allTasks.find((t) => t.id === dep.taskId);
    return depTask?.status === 'completed';
  });
}

/** Exclude abandoned tasks (archived) */
function excludeAbandoned(tasks: TaskNode[]): TaskNode[] {
  return tasks.filter((t) => t.status !== 'abandoned');
}

/** "当下" tab: show all non-abandoned tasks, in_progress pinned to top, rest sorted by due */
export function filterNow(tasks: TaskNode[]): TaskNode[] {
  const pool = excludeAbandoned(tasks);
  const inProgress = pool.filter((t) => t.status === 'in_progress');
  const rest = pool.filter((t) => t.status !== 'in_progress');
  return [...inProgress, ...sortByDue(rest)];
}

/** "今日" tab: dueAt today OR in_progress with updatedAt today */
export function filterToday(tasks: TaskNode[], now: Date): TaskNode[] {
  const pool = excludeAbandoned(tasks);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEnd = todayStart + 86_400_000;
  const filtered = pool.filter(
    (t) =>
      (t.dueAt !== undefined && t.dueAt >= todayStart && t.dueAt < todayEnd) ||
      (t.status === 'in_progress' && t.updatedAt >= todayStart),
  );
  return sortByDue(filtered);
}

/** "一周" tab: dueAt within 7 days OR in_progress */
export function filterWeek(tasks: TaskNode[], now: Date): TaskNode[] {
  const pool = excludeAbandoned(tasks);
  const weekEnd = now.getTime() + 7 * 86_400_000;
  const filtered = pool.filter(
    (t) => t.status === 'in_progress' || (t.dueAt !== undefined && t.dueAt <= weekEnd),
  );
  return sortByDue(filtered);
}

/** "月" tab: dueAt in current month OR in_progress */
export function filterMonth(tasks: TaskNode[], now: Date): TaskNode[] {
  const pool = excludeAbandoned(tasks);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  const filtered = pool.filter(
    (t) =>
      t.status === 'in_progress' ||
      (t.dueAt !== undefined && t.dueAt >= monthStart && t.dueAt < monthEnd),
  );
  return sortByDue(filtered);
}
