import type { ITaskPort } from '@/lib/environment/interfaces/task.port';
import { WebStorageAdapter } from '@/lib/adapters/web-storage';
import type {
  CreateTaskInput,
  TaskGoalGroup,
  TaskItem,
  TaskTimerMode,
} from '@/lib/types/task';

const TASK_STORAGE_KEY = 'task_items';
const TASK_GOAL_STORAGE_KEY = 'task_goal_groups';

function nowIso(): string {
  return new Date().toISOString();
}

function cloneTask(task: TaskItem): TaskItem {
  return JSON.parse(JSON.stringify(task)) as TaskItem;
}

function cloneGoalGroup(group: TaskGoalGroup): TaskGoalGroup {
  return JSON.parse(JSON.stringify(group)) as TaskGoalGroup;
}

export class TaskWebAdapter implements ITaskPort {
  private readonly storage = new WebStorageAdapter();

  private async readTasks(): Promise<TaskItem[]> {
    const tasks = await this.storage.read<TaskItem[]>(TASK_STORAGE_KEY);
    return Array.isArray(tasks) ? tasks : [];
  }

  private async writeTasks(tasks: TaskItem[]): Promise<void> {
    await this.storage.write(TASK_STORAGE_KEY, tasks);
  }

  async listTasks(): Promise<TaskItem[]> {
    const tasks = await this.readTasks();
    return tasks.map(cloneTask);
  }

  async getLongTermGoals(): Promise<TaskGoalGroup[]> {
    const groups = await this.storage.read<TaskGoalGroup[]>(TASK_GOAL_STORAGE_KEY);
    if (!Array.isArray(groups)) return [];
    return groups.map(cloneGoalGroup);
  }

  async getTaskById(taskId: string): Promise<TaskItem | null> {
    const tasks = await this.readTasks();
    const task = tasks.find((item) => item.id === taskId);
    return task ? cloneTask(task) : null;
  }

  async createTask(input: CreateTaskInput): Promise<TaskItem> {
    const tasks = await this.readTasks();
    const createdAt = nowIso();
    const nextTask: TaskItem = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      note: input.note?.trim() || undefined,
      status: 'todo',
      progress: 0,
      estimatedMinutes: input.targetMinutes,
      spentMinutes: 0,
      createdAt,
      updatedAt: createdAt,
      timer: {
        mode: input.mode ?? 'countdown',
        paused: false,
        elapsedMs: input.mode === 'countup' ? 0 : (input.targetMinutes ?? 25) * 60 * 1000,
        remainingMs: input.mode === 'countup' ? undefined : (input.targetMinutes ?? 25) * 60 * 1000,
        targetMinutes: input.mode === 'countup' ? undefined : (input.targetMinutes ?? 25),
      },
    };

    tasks.unshift(nextTask);
    await this.writeTasks(tasks);
    return cloneTask(nextTask);
  }

  async setTaskTimerMode(taskId: string, mode: TaskTimerMode): Promise<TaskItem | null> {
    const tasks = await this.readTasks();
    const index = tasks.findIndex((item) => item.id === taskId);
    if (index < 0) return null;

    const current = tasks[index];
    const targetMinutes = current.timer.targetMinutes ?? current.estimatedMinutes ?? 25;
    const updated: TaskItem = {
      ...current,
      updatedAt: nowIso(),
      timer: {
        ...current.timer,
        mode,
        paused: false,
        elapsedMs: mode === 'countup' ? current.timer.elapsedMs : targetMinutes * 60 * 1000,
        remainingMs: mode === 'countup' ? undefined : targetMinutes * 60 * 1000,
        targetMinutes: mode === 'countup' ? undefined : targetMinutes,
      },
    };
    tasks[index] = updated;
    await this.writeTasks(tasks);
    return cloneTask(updated);
  }

  async pauseTask(taskId: string): Promise<TaskItem | null> {
    const tasks = await this.readTasks();
    const index = tasks.findIndex((item) => item.id === taskId);
    if (index < 0) return null;

    const updated: TaskItem = {
      ...tasks[index],
      updatedAt: nowIso(),
      status: 'in_progress',
      timer: {
        ...tasks[index].timer,
        paused: true,
      },
    };
    tasks[index] = updated;
    await this.writeTasks(tasks);
    return cloneTask(updated);
  }

  async resumeTask(taskId: string): Promise<TaskItem | null> {
    const tasks = await this.readTasks();
    const index = tasks.findIndex((item) => item.id === taskId);
    if (index < 0) return null;

    const updated: TaskItem = {
      ...tasks[index],
      updatedAt: nowIso(),
      status: 'in_progress',
      timer: {
        ...tasks[index].timer,
        paused: false,
      },
    };
    tasks[index] = updated;
    await this.writeTasks(tasks);
    return cloneTask(updated);
  }

  async upsertTask(task: TaskItem): Promise<void> {
    const tasks = await this.readTasks();
    const index = tasks.findIndex((item) => item.id === task.id);
    const updated = {
      ...task,
      updatedAt: nowIso(),
    };
    if (index >= 0) {
      tasks[index] = updated;
    } else {
      tasks.unshift(updated);
    }
    await this.writeTasks(tasks);
  }
}

