export type TaskTimerMode = 'countdown' | 'countup'; // timer mode（计时模式）
export type TaskStatus = 'todo' | 'in_progress' | 'done'; // status（任务状态）

export interface TaskTimerState {
  mode: TaskTimerMode;
  paused: boolean;
  elapsedMs: number;
  remainingMs?: number;
  targetMinutes?: number;
}

export interface TaskItem {
  id: string;
  title: string;
  note?: string;
  status: TaskStatus;
  progress: number; // 0-100
  estimatedMinutes?: number;
  spentMinutes?: number;
  createdAt: string;
  updatedAt: string;
  timer: TaskTimerState;
}

export interface CreateTaskInput {
  title: string;
  note?: string;
  mode?: TaskTimerMode;
  targetMinutes?: number;
}

