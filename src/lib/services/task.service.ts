import { ExoMindEnvironment } from '@/lib/environment/environment';
import type { ITaskPort } from '@/lib/environment/interfaces/task.port';
import type {
  CreateTaskInput,
  TaskGoalGroup,
  TaskItem,
  TaskTimerMode,
} from '@/lib/types/task';

type TaskEnvironmentLike = {
  task: ITaskPort;
};

export interface TaskService {
  listTasks(): Promise<TaskItem[]>;
  getLongTermGoals(): Promise<TaskGoalGroup[]>;
  getTask(taskId: string): Promise<TaskItem | null>;
  createTask(input: CreateTaskInput): Promise<TaskItem>;
  setTimerMode(taskId: string, mode: TaskTimerMode): Promise<TaskItem | null>;
  pauseTask(taskId: string): Promise<TaskItem | null>;
  resumeTask(taskId: string): Promise<TaskItem | null>;
  upsertTask(task: TaskItem): Promise<void>;
}

export class TaskServiceImpl implements TaskService {
  private readonly env: TaskEnvironmentLike;

  constructor(env?: TaskEnvironmentLike) {
    this.env = env ?? ExoMindEnvironment.getInstance();
  }

  async listTasks(): Promise<TaskItem[]> {
    return this.env.task.listTasks();
  }

  async getLongTermGoals(): Promise<TaskGoalGroup[]> {
    return this.env.task.getLongTermGoals();
  }

  async getTask(taskId: string): Promise<TaskItem | null> {
    return this.env.task.getTaskById(taskId);
  }

  async createTask(input: CreateTaskInput): Promise<TaskItem> {
    return this.env.task.createTask(input);
  }

  async setTimerMode(taskId: string, mode: TaskTimerMode): Promise<TaskItem | null> {
    return this.env.task.setTaskTimerMode(taskId, mode);
  }

  async pauseTask(taskId: string): Promise<TaskItem | null> {
    return this.env.task.pauseTask(taskId);
  }

  async resumeTask(taskId: string): Promise<TaskItem | null> {
    return this.env.task.resumeTask(taskId);
  }

  async upsertTask(task: TaskItem): Promise<void> {
    await this.env.task.upsertTask(task);
  }
}

let taskServiceInstance: TaskService | null = null;

export function getTaskService(): TaskService {
  if (!taskServiceInstance) {
    taskServiceInstance = new TaskServiceImpl();
  }
  return taskServiceInstance;
}

