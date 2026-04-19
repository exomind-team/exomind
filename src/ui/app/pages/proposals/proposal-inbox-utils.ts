import type {
  Proposal,
  ProposalActionType,
  ProposalReferenceType,
  ProposalStatus,
  ProposalTaskDependency,
  TaskCreateProposalActionParams,
  TaskUpdateProposalActionParams,
} from '@/lib/types/proposal';

export type ProposalStatusTone = 'warning' | 'info' | 'success' | 'danger' | 'muted';
type TaskPriority = 'low' | 'medium' | 'high';

const STATUS_PRIORITY: Record<ProposalStatus, number> = {
  pending: 0,
  in_review: 1,
  snoozed: 2,
  approved: 3,
  rejected: 4,
};

const STATUS_META: Record<
  ProposalStatus,
  { label: string; tone: ProposalStatusTone }
> = {
  pending: { label: '待处理', tone: 'warning' },
  in_review: { label: '审议中', tone: 'info' },
  approved: { label: '已批准', tone: 'success' },
  rejected: { label: '已拒绝', tone: 'danger' },
  snoozed: { label: '已暂缓', tone: 'muted' },
};

const ACTION_LABELS: Record<ProposalActionType, string> = {
  'task.create': '创建任务',
  'task.update': '修改任务',
  append_event: '追加记录',
  start_timeblock: '启动时间块',
  approve_agent_access: '授权访问',
};

const REFERENCE_LABELS: Record<ProposalReferenceType, string> = {
  event: '事件',
  timeblock: '时间块',
  task: '任务',
};

function normalizeForSort(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    );
  }
  return value;
}

const TASK_PRIORITY_VALUES: TaskPriority[] = ['low', 'medium', 'high'];
const TASK_CREATE_TOP_LEVEL_KEYS = ['fields'] as const;
const TASK_CREATE_FIELD_KEYS = [
  'title',
  'description',
  'doneCondition',
  'priority',
  'tags',
  'estimatedMinutes',
  'dueAt',
  'dependsOn',
] as const;
const TASK_UPDATE_TOP_LEVEL_KEYS = ['taskId', 'patch'] as const;
const TASK_UPDATE_PATCH_KEYS = [
  'title',
  'description',
  'doneCondition',
  'priority',
  'tags',
  'estimatedMinutes',
  'dueAt',
  'dependsOn',
] as const;

export interface ProposalActionParamsValidationResult {
  normalized: Record<string, unknown> | null;
  error: string | null;
  taskCreateParams: TaskCreateProposalActionParams | null;
  taskUpdateParams: TaskUpdateProposalActionParams | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} 必须是 JSON object`);
  }
  return value;
}

function ensureAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${label} 包含未支持字段：${unknownKeys.join(', ')}`);
  }
}

function parseRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} 不能为空`);
  }
  return trimmed;
}

function parseOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseNullableString(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串或 null`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function parseOptionalPriority(value: unknown, label: string): TaskPriority | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !TASK_PRIORITY_VALUES.includes(value as TaskPriority)) {
    throw new Error(`${label} 只接受 low / medium / high`);
  }
  return value as TaskPriority;
}

function parseOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} 必须是大于 0 的整数`);
  }
  return Number(value);
}

function parseNullablePositiveInteger(
  value: unknown,
  label: string,
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} 必须是大于 0 的整数或 null`);
  }
  return Number(value);
}

function parseOptionalIsoDateTime(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是 ISO 时间字符串`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} 不是有效时间`);
  }
  return parsed.toISOString();
}

function parseNullableIsoDateTime(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是 ISO 时间字符串或 null`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} 不是有效时间`);
  }
  return parsed.toISOString();
}

function parseStringArray(
  value: unknown,
  label: string,
  options?: { allowEmpty?: boolean },
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必须是字符串数组`);
  }
  const normalized = value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(`${label}[${index}] 必须是字符串`);
    }
    return item.trim();
  }).filter(Boolean);

  if (normalized.length === 0 && options?.allowEmpty !== true) {
    return undefined;
  }
  return normalized;
}

function parseDependencies(
  value: unknown,
  label: string,
  options?: { allowEmpty?: boolean },
): ProposalTaskDependency[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} 必须是依赖数组`);
  }

  const normalized = value.map((item, index) => {
    const dependency = ensureRecord(item, `${label}[${index}]`);
    ensureAllowedKeys(dependency, ['taskId', 'type'], `${label}[${index}]`);
    const taskId = parseRequiredString(dependency.taskId, `${label}[${index}].taskId`);
    const type = dependency.type;
    if (type !== 'soft' && type !== 'hard') {
      throw new Error(`${label}[${index}].type 只接受 soft / hard`);
    }
    return { taskId, type: type as ProposalTaskDependency['type'] };
  });

  if (normalized.length === 0 && options?.allowEmpty !== true) {
    return undefined;
  }
  return normalized;
}

function parseTaskCreateActionParams(
  value: Record<string, unknown>,
): TaskCreateProposalActionParams {
  ensureAllowedKeys(value, TASK_CREATE_TOP_LEVEL_KEYS, 'task.create');
  const fields = ensureRecord(value.fields, 'task.create.fields');
  ensureAllowedKeys(fields, TASK_CREATE_FIELD_KEYS, 'task.create.fields');

  return {
    fields: {
      title: parseRequiredString(fields.title, 'fields.title'),
      ...(parseOptionalString(fields.description, 'fields.description') !== undefined
        ? { description: parseOptionalString(fields.description, 'fields.description') }
        : {}),
      ...(parseOptionalString(fields.doneCondition, 'fields.doneCondition') !== undefined
        ? { doneCondition: parseOptionalString(fields.doneCondition, 'fields.doneCondition') }
        : {}),
      ...(parseOptionalPriority(fields.priority, 'fields.priority') !== undefined
        ? { priority: parseOptionalPriority(fields.priority, 'fields.priority') }
        : {}),
      ...(parseStringArray(fields.tags, 'fields.tags') !== undefined
        ? { tags: parseStringArray(fields.tags, 'fields.tags') }
        : {}),
      ...(parseOptionalPositiveInteger(fields.estimatedMinutes, 'fields.estimatedMinutes') !== undefined
        ? { estimatedMinutes: parseOptionalPositiveInteger(fields.estimatedMinutes, 'fields.estimatedMinutes') }
        : {}),
      ...(parseOptionalIsoDateTime(fields.dueAt, 'fields.dueAt') !== undefined
        ? { dueAt: parseOptionalIsoDateTime(fields.dueAt, 'fields.dueAt') }
        : {}),
      ...(parseDependencies(fields.dependsOn, 'fields.dependsOn') !== undefined
        ? { dependsOn: parseDependencies(fields.dependsOn, 'fields.dependsOn') }
        : {}),
    },
  };
}

function parseTaskUpdateActionParams(
  value: Record<string, unknown>,
): TaskUpdateProposalActionParams {
  ensureAllowedKeys(value, TASK_UPDATE_TOP_LEVEL_KEYS, 'task.update');
  const patch = ensureRecord(value.patch, 'task.update.patch');
  ensureAllowedKeys(patch, TASK_UPDATE_PATCH_KEYS, 'task.update.patch');

  const normalizedPatch = {
    ...(parseOptionalString(patch.title, 'patch.title') !== undefined
      ? { title: parseRequiredString(patch.title, 'patch.title') }
      : {}),
    ...(parseNullableString(patch.description, 'patch.description') !== undefined
      ? { description: parseNullableString(patch.description, 'patch.description') }
      : {}),
    ...(parseNullableString(patch.doneCondition, 'patch.doneCondition') !== undefined
      ? { doneCondition: parseNullableString(patch.doneCondition, 'patch.doneCondition') }
      : {}),
    ...(parseOptionalPriority(patch.priority, 'patch.priority') !== undefined
      ? { priority: parseOptionalPriority(patch.priority, 'patch.priority') }
      : {}),
    ...(parseStringArray(patch.tags, 'patch.tags', { allowEmpty: true }) !== undefined
      ? { tags: parseStringArray(patch.tags, 'patch.tags', { allowEmpty: true }) }
      : {}),
    ...(parseNullablePositiveInteger(patch.estimatedMinutes, 'patch.estimatedMinutes') !== undefined
      ? { estimatedMinutes: parseNullablePositiveInteger(patch.estimatedMinutes, 'patch.estimatedMinutes') }
      : {}),
    ...(parseNullableIsoDateTime(patch.dueAt, 'patch.dueAt') !== undefined
      ? { dueAt: parseNullableIsoDateTime(patch.dueAt, 'patch.dueAt') }
      : {}),
    ...(parseDependencies(patch.dependsOn, 'patch.dependsOn', { allowEmpty: true }) !== undefined
      ? { dependsOn: parseDependencies(patch.dependsOn, 'patch.dependsOn', { allowEmpty: true }) }
      : {}),
  };

  if (Object.keys(normalizedPatch).length === 0) {
    throw new Error('task.update.patch 至少要包含一个字段');
  }

  return {
    taskId: parseRequiredString(value.taskId, 'task.update.taskId'),
    patch: normalizedPatch,
  };
}

export function validateProposalActionParams(
  actionType: ProposalActionType,
  value: Record<string, unknown>,
): ProposalActionParamsValidationResult {
  try {
    if (actionType === 'task.create') {
      const taskCreateParams = parseTaskCreateActionParams(value);
      return {
        normalized: taskCreateParams as unknown as Record<string, unknown>,
        error: null,
        taskCreateParams,
        taskUpdateParams: null,
      };
    }

    if (actionType === 'task.update') {
      const taskUpdateParams = parseTaskUpdateActionParams(value);
      return {
        normalized: taskUpdateParams as unknown as Record<string, unknown>,
        error: null,
        taskCreateParams: null,
        taskUpdateParams,
      };
    }

    return {
      normalized: value,
      error: null,
      taskCreateParams: null,
      taskUpdateParams: null,
    };
  } catch (error) {
    return {
      normalized: null,
      error: error instanceof Error ? error.message : 'action_params 校验失败',
      taskCreateParams: null,
      taskUpdateParams: null,
    };
  }
}

export function sortProposals(proposals: Proposal[]): Proposal[] {
  return [...proposals].sort((left, right) => {
    const priorityDiff = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const updatedDiff = normalizeForSort(right.updatedAt) - normalizeForSort(left.updatedAt);
    if (updatedDiff !== 0) {
      return updatedDiff;
    }

    const createdDiff = normalizeForSort(right.createdAt) - normalizeForSort(left.createdAt);
    if (createdDiff !== 0) {
      return createdDiff;
    }

    return right.id.localeCompare(left.id);
  });
}

export function formatProposalShortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function normalizeProposalActionParams(value: unknown): string {
  return JSON.stringify(sortJsonValue(value ?? {}), null, 2);
}

export function tryParseProposalActionParams(
  value: string,
): { parsed: Record<string, unknown> | null; error: string | null } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        parsed: null,
        error: 'action_params 需要是 JSON object',
      };
    }

    return {
      parsed: parsed as Record<string, unknown>,
      error: null,
    };
  } catch (error) {
    return {
      parsed: null,
      error: error instanceof Error ? error.message : 'JSON 解析失败',
    };
  }
}

export function resolveProposalStatusMeta(status: ProposalStatus): {
  label: string;
  tone: ProposalStatusTone;
} {
  return STATUS_META[status];
}

export function resolveProposalActionLabel(actionType: ProposalActionType): string {
  return ACTION_LABELS[actionType];
}

export function resolveProposalReferenceLabel(refType: ProposalReferenceType): string {
  return REFERENCE_LABELS[refType];
}

export function formatProposalAbsoluteTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatProposalRelativeTime(
  value: string,
  now = Date.now(),
): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return '未知时间';
  }

  const diffMinutes = Math.round((now - timestamp) / 60_000);
  if (diffMinutes <= 1) {
    return '刚刚';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  return `${Math.round(diffHours / 24)}d`;
}
