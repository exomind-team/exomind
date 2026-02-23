import type {
  CreateTaskInput,
  TaskGoalGroup,
  TaskItem,
  TaskTimerMode,
} from '@/lib/types/task';

export interface ITaskPort {
  listTasks(): Promise<TaskItem[]>;
  getLongTermGoals(): Promise<TaskGoalGroup[]>;
  getTaskById(taskId: string): Promise<TaskItem | null>;
  createTask(input: CreateTaskInput): Promise<TaskItem>;
  setTaskTimerMode(taskId: string, mode: TaskTimerMode): Promise<TaskItem | null>;
  pauseTask(taskId: string): Promise<TaskItem | null>;
  resumeTask(taskId: string): Promise<TaskItem | null>;
  upsertTask(task: TaskItem): Promise<void>;
}

