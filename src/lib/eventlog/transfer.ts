import type { EventData } from '../types/event';
import type { TaskNode } from '../types/task';

export type ImportStrategy = 'merge' | 'overwrite';

export interface EventLogTransferPayloadV1 {
  version: 1;
  exportedAt: string;
  events: EventData[];
  tasks?: TaskNode[];
}

const TRANSFER_VERSION = 1;
const TASK_STATUS_VALUES = new Set(['not_started', 'in_progress', 'suspended', 'completed', 'abandoned']);
const TASK_PRIORITY_VALUES = new Set(['low', 'medium', 'high']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTaskDependency(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.taskId === 'string'
    && (item.type === 'soft' || item.type === 'hard')
  );
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isTaskNode(value: unknown): value is TaskNode {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string'
    && typeof item.title === 'string'
    && typeof item.status === 'string'
    && TASK_STATUS_VALUES.has(item.status)
    && typeof item.priority === 'string'
    && TASK_PRIORITY_VALUES.has(item.priority)
    && Array.isArray(item.dependsOn)
    && item.dependsOn.every((dep) => isTaskDependency(dep))
    && Array.isArray(item.tags)
    && item.tags.every((tag) => typeof tag === 'string')
    && typeof item.createdAt === 'number'
    && Number.isFinite(item.createdAt)
    && typeof item.updatedAt === 'number'
    && Number.isFinite(item.updatedAt)
    && isOptionalString(item.description)
    && isOptionalString(item.doneCondition)
    && isOptionalString(item.source)
    && isOptionalString(item.parentId)
    && isOptionalFiniteNumber(item.dueAt)
    && isOptionalFiniteNumber(item.estimatedMinutes)
    && isOptionalFiniteNumber(item.completedAt)
    && isOptionalStringArray(item.timeBlockIds)
  );
}

function isEventData(value: unknown): value is EventData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.timestamp === 'number' &&
    Number.isFinite(item.timestamp) &&
    typeof item.content === 'string' &&
    Array.isArray(item.tags) &&
    item.tags.every((tag) => typeof tag === 'string') &&
    (item.metadata === undefined || isRecord(item.metadata))
  );
}

export function createTransferPayload(events: EventData[], tasks: TaskNode[] = []): EventLogTransferPayloadV1 {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    events: [...events],
    tasks: [...tasks],
  };
}

export function parseTransferPayload(raw: string): EventLogTransferPayloadV1 {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('无效的 JSON 文件');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('备份文件格式不正确');
  }

  const payload = parsed as Record<string, unknown>;

  if (payload.version !== TRANSFER_VERSION) {
    throw new Error('不支持的备份版本');
  }

  if (!Array.isArray(payload.events)) {
    throw new Error('备份文件缺少 events 数组');
  }

  if (!payload.events.every(isEventData)) {
    throw new Error('备份文件中的事件数据格式不正确');
  }

  let tasks: TaskNode[] | undefined;
  if ('tasks' in payload) {
    if (!Array.isArray(payload.tasks)) {
      throw new Error('备份文件中的任务数据格式不正确');
    }
    if (!payload.tasks.every(isTaskNode)) {
      throw new Error('备份文件中的任务数据格式不正确');
    }
    tasks = [...payload.tasks];
  }

  return {
    version: 1,
    exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : new Date().toISOString(),
    events: [...payload.events],
    tasks,
  };
}

export function mergeEventsById(existing: EventData[], incoming: EventData[]): EventData[] {
  const merged = new Map<string, EventData>();

  for (const event of existing) {
    merged.set(event.id, event);
  }

  for (const event of incoming) {
    merged.set(event.id, event);
  }

  return Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp);
}

export function mergeTasksById(existing: TaskNode[], incoming: TaskNode[]): TaskNode[] {
  const merged = new Map<string, TaskNode>();

  for (const task of existing) {
    merged.set(task.id, task);
  }

  for (const task of incoming) {
    merged.set(task.id, task);
  }

  return Array.from(merged.values()).sort(
    (a, b) => (b.createdAt - a.createdAt) || (b.updatedAt - a.updatedAt),
  );
}
