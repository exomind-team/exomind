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

export type TaskGoalStatusTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'brand'
  | 'info'
  | 'indigo'
  | 'lime'
  | 'pink'
  | 'neutral'; // status tone（状态色调）

export interface TaskGoalStatusBadge {
  icon: string; // emoji/icon text（图标文案）
  text: string; // status text（状态文本）
  tone: TaskGoalStatusTone;
}

export interface TaskGoalProgress {
  value: number; // 0-100
  tone: TaskGoalStatusTone;
  label?: string;
}

export interface TaskGoalCard {
  id: string;
  title: string;
  showGithubIcon?: boolean;
  focus: string;
  acceptance: string;
  stage: string;
  stageTone: TaskGoalStatusTone;
  status: TaskGoalStatusBadge;
  timeline?: string;
  progress?: TaskGoalProgress;
  accentTone: TaskGoalStatusTone;
}

export interface TaskGoalGroup {
  id: string;
  icon: string;
  title: string;
  badgeText: string;
  badgeTone: TaskGoalStatusTone;
  goals: TaskGoalCard[];
}

