/**
 * TaskPouchAdapter
 *
 * 基于 PouchDB TaskStorage 实现 ITaskPort。
 * 仿照 WebEventLogStorageAdapter 模式：委托给 Storage 层，负责数据转换。
 */

import type { ITaskPort, CreateTaskInput, UpdateTaskInput } from '@/lib/environment/interfaces/task.port';
import type { TaskNode, TaskStatus } from '@/lib/types/task';
import { canTransition, transition } from '@/lib/types/task';
import { getTaskStorage } from '@/lib/storage/task-storage';
import { getCurrentUserId } from '@/lib/storage/event-storage';
import { createUuidV4 } from '@/lib/utils/uuid';

const ALL_STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'suspended', 'completed', 'abandoned'];

export class TaskPouchAdapter implements ITaskPort {
  constructor(private readonly userId?: string) {}

  private get storage() {
    return getTaskStorage(this.userId || getCurrentUserId());
  }

  async listTasks(includeAbandoned = false): Promise<TaskNode[]> {
    const tasks = await this.storage.getTasks();
    return includeAbandoned ? tasks : tasks.filter((t) => t.status !== 'abandoned');
  }

  async getTaskById(id: string): Promise<TaskNode | null> {
    const task = await this.storage.getTask(id);
    return task ?? null;
  }

  async createTask(input: CreateTaskInput): Promise<TaskNode> {
    const now = Date.now();
    const task: TaskNode = {
      id: createUuidV4(),
      title: input.title.trim(),
      description: input.description,
      doneCondition: input.doneCondition,
      status: 'not_started',
      priority: input.priority ?? 'medium',
      dueAt: input.dueAt,
      source: input.source,
      parentId: input.parentId,
      dependsOn: [],
      tags: input.tags ?? [],
      estimatedMinutes: input.estimatedMinutes,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.addTask(task);
    return task;
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<TaskNode | null> {
    const result = await this.storage.updateTask(id, input);
    return result ?? null;
  }

  async abandonTask(id: string): Promise<TaskNode | null> {
    const task = await this.storage.getTask(id);
    if (!task) return null;
    const abandoned = transition(task, 'abandoned');
    await this.storage.updateTask(id, {
      status: abandoned.status,
      updatedAt: abandoned.updatedAt,
      completedAt: abandoned.completedAt,
    });
    return abandoned;
  }

  async transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null> {
    const task = await this.storage.getTask(id);
    if (!task) return null;
    const transitioned = transition(task, to);
    await this.storage.updateTask(id, {
      status: transitioned.status,
      updatedAt: transitioned.updatedAt,
      completedAt: transitioned.completedAt,
    });
    return transitioned;
  }

  async getAvailableTransitions(id: string): Promise<TaskStatus[]> {
    const task = await this.storage.getTask(id);
    if (!task) return [];
    return ALL_STATUSES.filter((s) => canTransition(task.status, s));
  }
}
