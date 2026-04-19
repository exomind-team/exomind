/**
 * TaskPouchAdapter
 *
 * 基于 PouchDB TaskStorage 实现 ITaskPort。
 * 仿照 WebEventLogStorageAdapter 模式：委托给 Storage 层，负责数据转换。
 *
 * 已弃用待删除：业务数据链路已切换到 RT Tasks，本适配器仅保留给
 * 旧版迁移/兼容路径使用，后续迁移完成后应整体移除。
 */

import type {
  ITaskPort,
  CreateTaskInput,
  UpdateTaskInput,
} from "@/lib/environment/interfaces/task.port";
import type { TaskNode, TaskStatus } from "@/lib/types/task";
import {
  buildInitialTaskStatusTransition,
  canTransition,
  transition,
} from "@/lib/types/task";
import { getTaskStorage } from "@/lib/storage/task-storage";
import { getCurrentUserId } from "@/lib/storage/event-storage";
import { createUuidV4 } from "@/lib/utils/uuid";

const ALL_STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "suspended",
  "completed",
  "cancelled",
];

export class TaskPouchAdapter implements ITaskPort {
  constructor(private readonly userId?: string) {}

  private get storage() {
    return getTaskStorage(this.userId || getCurrentUserId());
  }

  async listTasks(includeCancelled = false): Promise<TaskNode[]> {
    const tasks = await this.storage.getTasks();
    return includeCancelled
      ? tasks
      : tasks.filter((t) => t.status !== "cancelled");
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
      status: "pending",
      priority: input.priority ?? "medium",
      dueAt: input.dueAt,
      source: input.source,
      parentId: input.parentId,
      dependsOn: [],
      tags: input.tags ?? [],
      estimatedMinutes: input.estimatedMinutes,
      statusTransitions: [],
      createdAt: now,
      updatedAt: now,
    };
    task.statusTransitions = [buildInitialTaskStatusTransition(task.id, now)];
    await this.storage.addTask(task);
    return task;
  }

  async updateTask(
    id: string,
    input: UpdateTaskInput,
  ): Promise<TaskNode | null> {
    const normalizedUpdates: Partial<TaskNode> = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description ?? undefined }
        : {}),
      ...(input.doneCondition !== undefined
        ? { doneCondition: input.doneCondition ?? undefined }
        : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt ?? undefined } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.dependsOn !== undefined ? { dependsOn: input.dependsOn } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.estimatedMinutes !== undefined
        ? { estimatedMinutes: input.estimatedMinutes ?? undefined }
        : {}),
      ...(input.timeBlockIds !== undefined ? { timeBlockIds: input.timeBlockIds } : {}),
    };
    const result = await this.storage.updateTask(id, normalizedUpdates);
    return result ?? null;
  }

  async cancelTask(id: string): Promise<TaskNode | null> {
    const task = await this.storage.getTask(id);
    if (!task) return null;
    const cancelled = transition(task, "cancelled");
    await this.storage.updateTask(id, {
      status: cancelled.status,
      statusTransitions: cancelled.statusTransitions,
      updatedAt: cancelled.updatedAt,
      completedAt: cancelled.completedAt,
    });
    return cancelled;
  }

  async transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null> {
    const task = await this.storage.getTask(id);
    if (!task) return null;
    const transitioned = transition(task, to);
    await this.storage.updateTask(id, {
      status: transitioned.status,
      statusTransitions: transitioned.statusTransitions,
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
