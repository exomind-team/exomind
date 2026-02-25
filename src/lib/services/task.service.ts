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
  listTasksByTab(tab: TaskListTab): Promise<TaskItem[]>;
  getLongTermGoals(): Promise<TaskGoalGroup[]>;
  getTask(taskId: string): Promise<TaskItem | null>;
  createTask(input: CreateTaskInput): Promise<TaskItem>;
  setTimerMode(taskId: string, mode: TaskTimerMode): Promise<TaskItem | null>;
  pauseTask(taskId: string): Promise<TaskItem | null>;
  resumeTask(taskId: string): Promise<TaskItem | null>;
  upsertTask(task: TaskItem): Promise<void>;
}

export type TaskListTab = 'now' | 'today' | 'week' | 'month';

function parseIsoDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function isWithinCurrentWeek(date: Date, now: Date): boolean {
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() + mondayOffset);

  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return date >= start && date < end;
}

function isWithinCurrentMonth(date: Date, now: Date): boolean {
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function sortByDueThenUpdated(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort((left, right) => {
    const leftDue = parseIsoDate(left.dueAt);
    const rightDue = parseIsoDate(right.dueAt);
    if (leftDue && rightDue) {
      return leftDue.getTime() - rightDue.getTime();
    }
    if (leftDue) return -1;
    if (rightDue) return 1;

    const leftUpdated = parseIsoDate(left.updatedAt)?.getTime() ?? 0;
    const rightUpdated = parseIsoDate(right.updatedAt)?.getTime() ?? 0;
    return rightUpdated - leftUpdated;
  });
}

function isActionable(task: TaskItem): boolean {
  return task.status !== 'done';
}

export class TaskServiceImpl implements TaskService {
  private readonly env: TaskEnvironmentLike;

  constructor(env?: TaskEnvironmentLike) {
    this.env = env ?? ExoMindEnvironment.getInstance();
  }

  async listTasks(): Promise<TaskItem[]> {
    return this.env.task.listTasks();
  }

  async listTasksByTab(tab: TaskListTab): Promise<TaskItem[]> {
    const allTasks = await this.env.task.listTasks();
    const now = new Date();

    if (tab === 'now') {
      const inProgress = allTasks.filter((task) => task.status === 'in_progress');
      if (inProgress.length > 0) {
        return sortByDueThenUpdated(inProgress);
      }
      return sortByDueThenUpdated(allTasks.filter(isActionable)).slice(0, 5);
    }

    if (tab === 'today') {
      return sortByDueThenUpdated(allTasks.filter((task) => {
        if (!isActionable(task)) return false;
        const due = parseIsoDate(task.dueAt);
        const updatedAt = parseIsoDate(task.updatedAt);
        const dueToday = due ? isSameLocalDay(due, now) : false;
        const activeToday = updatedAt ? isSameLocalDay(updatedAt, now) : false;
        return dueToday || activeToday;
      }));
    }

    if (tab === 'week') {
      return sortByDueThenUpdated(allTasks.filter((task) => {
        if (!isActionable(task)) return false;
        const due = parseIsoDate(task.dueAt);
        return !due || isWithinCurrentWeek(due, now);
      }));
    }

    return sortByDueThenUpdated(allTasks.filter((task) => {
      if (!isActionable(task)) return false;
      const due = parseIsoDate(task.dueAt);
      return !due || isWithinCurrentMonth(due, now);
    }));
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
