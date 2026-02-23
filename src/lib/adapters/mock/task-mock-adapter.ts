import type { ITaskPort } from '@/lib/environment/interfaces/task.port';
import type { CreateTaskInput, TaskItem, TaskTimerMode } from '@/lib/types/task';
import { MOCK_TASKS_FIXTURE } from './fixtures/tasks';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class TaskMockAdapter implements ITaskPort {
  private tasks: TaskItem[] = deepClone(MOCK_TASKS_FIXTURE);

  async listTasks(): Promise<TaskItem[]> {
    return deepClone(this.tasks);
  }

  async getTaskById(taskId: string): Promise<TaskItem | null> {
    const task = this.tasks.find((item) => item.id === taskId);
    return task ? deepClone(task) : null;
  }

  async createTask(input: CreateTaskInput): Promise<TaskItem> {
    const targetMinutes = input.targetMinutes ?? 25;
    const mode = input.mode ?? 'countdown';
    const createdAt = nowIso();
    const task: TaskItem = {
      id: `task-${crypto.randomUUID()}`,
      title: input.title.trim(),
      note: input.note?.trim() || undefined,
      status: 'todo',
      progress: 0,
      estimatedMinutes: targetMinutes,
      spentMinutes: 0,
      createdAt,
      updatedAt: createdAt,
      timer: {
        mode,
        paused: false,
        elapsedMs: mode === 'countup' ? 0 : targetMinutes * 60 * 1000,
        remainingMs: mode === 'countup' ? undefined : targetMinutes * 60 * 1000,
        targetMinutes: mode === 'countup' ? undefined : targetMinutes,
      },
    };

    this.tasks.unshift(task);
    return deepClone(task);
  }

  async setTaskTimerMode(taskId: string, mode: TaskTimerMode): Promise<TaskItem | null> {
    const index = this.tasks.findIndex((item) => item.id === taskId);
    if (index < 0) return null;

    const current = this.tasks[index];
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

    this.tasks[index] = updated;
    return deepClone(updated);
  }

  async pauseTask(taskId: string): Promise<TaskItem | null> {
    const index = this.tasks.findIndex((item) => item.id === taskId);
    if (index < 0) return null;

    const updated: TaskItem = {
      ...this.tasks[index],
      status: 'in_progress',
      updatedAt: nowIso(),
      timer: {
        ...this.tasks[index].timer,
        paused: true,
      },
    };
    this.tasks[index] = updated;
    return deepClone(updated);
  }

  async resumeTask(taskId: string): Promise<TaskItem | null> {
    const index = this.tasks.findIndex((item) => item.id === taskId);
    if (index < 0) return null;

    const updated: TaskItem = {
      ...this.tasks[index],
      status: 'in_progress',
      updatedAt: nowIso(),
      timer: {
        ...this.tasks[index].timer,
        paused: false,
      },
    };
    this.tasks[index] = updated;
    return deepClone(updated);
  }

  async upsertTask(task: TaskItem): Promise<void> {
    const index = this.tasks.findIndex((item) => item.id === task.id);
    const updated: TaskItem = {
      ...task,
      updatedAt: nowIso(),
    };
    if (index >= 0) {
      this.tasks[index] = updated;
    } else {
      this.tasks.unshift(updated);
    }
  }
}

