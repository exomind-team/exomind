import {
  buildRuntimeAuthHeaders,
  getSelectedRuntimeTarget,
  type RuntimeTarget,
} from '@/config/runtime-target';
import type { ITaskPort, CreateTaskInput, UpdateTaskInput } from '@/lib/environment/interfaces/task.port';
import type { Dependency, LegacyTaskStatus, TaskNode, TaskNodeLike, TaskStatus } from '@/lib/types/task';
import { canTransition, normalizeTaskNode } from '@/lib/types/task';
import { appendRuntimeProfileScope } from './runtime-profile-scope';

type RuntimeFetch = typeof fetch;

interface RuntimeTaskDependencyPayload {
  task_id: string;
  type: 'soft' | 'hard';
}

interface RuntimeTaskPayload {
  id: string;
  title: string;
  description?: string | null;
  done_condition?: string | null;
  status: TaskStatus | LegacyTaskStatus;
  priority: 'low' | 'medium' | 'high';
  tags?: string[];
  source?: string | null;
  parent_id?: string | null;
  depends_on?: RuntimeTaskDependencyPayload[];
  due_at?: number | null;
  estimated_minutes?: number | null;
  time_block_ids?: string[];
  created_at: number;
  updated_at: number;
  completed_at?: number | null;
}

export interface TaskRtAdapterOptions {
  fetchImpl?: RuntimeFetch;
  resolveTarget?: () => RuntimeTarget;
}

const ALL_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'suspended', 'completed', 'cancelled'];

function formatHostForUrl(host: string): string {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

function buildBaseUrl(target: RuntimeTarget): string {
  return `http://${formatHostForUrl(target.host)}:${target.port}`;
}

function toRuntimeDependency(dependency: Dependency): RuntimeTaskDependencyPayload {
  return {
    task_id: dependency.taskId,
    type: dependency.type,
  };
}

function toRuntimeTaskNode(task: RuntimeTaskPayload): TaskNode {
  return normalizeTaskNode({
    id: task.id,
    title: task.title,
    description: task.description ?? undefined,
    doneCondition: task.done_condition ?? undefined,
    status: task.status,
    priority: task.priority,
    dueAt: task.due_at ?? undefined,
    source: task.source ?? undefined,
    parentId: task.parent_id ?? undefined,
    dependsOn: (task.depends_on ?? []).map((dependency) => ({
      taskId: dependency.task_id,
      type: dependency.type,
    })),
    tags: task.tags ?? [],
    estimatedMinutes: task.estimated_minutes ?? undefined,
    timeBlockIds: task.time_block_ids ?? [],
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    completedAt: task.completed_at ?? undefined,
  } satisfies TaskNodeLike);
}

function toRuntimeCreatePayload(input: CreateTaskInput): Record<string, unknown> {
  return {
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.doneCondition !== undefined ? { done_condition: input.doneCondition } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.estimatedMinutes !== undefined ? { estimated_minutes: input.estimatedMinutes } : {}),
    depends_on: [],
    time_block_ids: [],
  };
}

function toRuntimeUpdatePayload(input: UpdateTaskInput): Record<string, unknown> {
  // Use `'key' in input` to detect explicitly provided fields (including undefined).
  // When a field is explicitly set to undefined, send `null` so the backend clears it.
  return {
    ...('title' in input ? { title: input.title } : {}),
    ...('description' in input ? { description: input.description ?? null } : {}),
    ...('doneCondition' in input ? { done_condition: input.doneCondition ?? null } : {}),
    ...('priority' in input ? { priority: input.priority } : {}),
    ...('dueAt' in input ? { due_at: input.dueAt ?? null } : {}),
    ...('source' in input ? { source: input.source ?? null } : {}),
    ...('parentId' in input ? { parent_id: input.parentId ?? null } : {}),
    ...('dependsOn' in input && input.dependsOn ? { depends_on: input.dependsOn.map(toRuntimeDependency) } : {}),
    ...('tags' in input ? { tags: input.tags } : {}),
    ...('estimatedMinutes' in input ? { estimated_minutes: input.estimatedMinutes ?? null } : {}),
    ...('timeBlockIds' in input ? { time_block_ids: input.timeBlockIds } : {}),
  };
}

export class TaskRtAdapter implements ITaskPort {
  private readonly fetchImpl: RuntimeFetch;
  private readonly resolveTarget: () => RuntimeTarget;

  constructor(options: TaskRtAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveTarget = options.resolveTarget ?? (() => getSelectedRuntimeTarget());
  }

  async listTasks(includeCancelled = false): Promise<TaskNode[]> {
    const tasks = await this.requestJson<RuntimeTaskPayload[]>('/tasks');
    const mapped = tasks.map(toRuntimeTaskNode);
    return includeCancelled ? mapped : mapped.filter((task) => task.status !== 'cancelled');
  }

  async getTaskById(id: string): Promise<TaskNode | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`/tasks/${encodeURIComponent(id)}`, target), {
      method: 'GET',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT get task failed: ${response.status}`);
    }
    return toRuntimeTaskNode(await response.json() as RuntimeTaskPayload);
  }

  async createTask(input: CreateTaskInput): Promise<TaskNode> {
    const task = await this.requestJson<RuntimeTaskPayload>('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(toRuntimeCreatePayload(input)),
    });
    return toRuntimeTaskNode(task);
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<TaskNode | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`/tasks/${encodeURIComponent(id)}`, target), {
      method: 'PUT',
      headers: buildRuntimeAuthHeaders(target, { 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify(toRuntimeUpdatePayload(input)),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT update task failed: ${response.status}`);
    }
    return toRuntimeTaskNode(await response.json() as RuntimeTaskPayload);
  }

  async cancelTask(id: string): Promise<TaskNode | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`/tasks/${encodeURIComponent(id)}/cancel`, target), {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(target, { Accept: 'application/json' }),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT cancel task failed: ${response.status}`);
    }
    return toRuntimeTaskNode(await response.json() as RuntimeTaskPayload);
  }

  async transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(`/tasks/${encodeURIComponent(id)}/transition`, target), {
      method: 'POST',
      headers: buildRuntimeAuthHeaders(target, { 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({ status: to }),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`RT transition task failed: ${response.status}`);
    }
    return toRuntimeTaskNode(await response.json() as RuntimeTaskPayload);
  }

  async getAvailableTransitions(id: string): Promise<TaskStatus[]> {
    const task = await this.getTaskById(id);
    if (!task) {
      return [];
    }
    return ALL_STATUSES.filter((status) => canTransition(task.status, status));
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const target = this.resolveTarget();
    const response = await this.fetchImpl(this.url(path, target), {
      ...init,
      headers: buildRuntimeAuthHeaders(target, {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`RT request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private baseUrl(target = this.resolveTarget()): string {
    return buildBaseUrl(target);
  }

  private url(path: string, target = this.resolveTarget()): string {
    return `${this.baseUrl(target)}${appendRuntimeProfileScope(path)}`;
  }
}
