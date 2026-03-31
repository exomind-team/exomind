import type { GoalDisplayStatus, TaskEdgeStatus } from './goal-types';

const STATUS_LABELS = {
  pending: '待办',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  cancelled: '已取消',
} satisfies Record<TaskEdgeStatus | GoalDisplayStatus, string>;

export function formatTaskStatus(status: TaskEdgeStatus): string {
  return STATUS_LABELS[status];
}

export function formatGoalStatus(status: GoalDisplayStatus): string {
  return STATUS_LABELS[status];
}
