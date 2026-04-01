import type {
  Proposal,
  ProposalActionType,
  ProposalReferenceType,
  ProposalStatus,
} from '@/lib/types/proposal';

export type ProposalStatusTone = 'warning' | 'info' | 'success' | 'danger' | 'muted';

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
  create_task: '创建任务',
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

    return right.id - left.id;
  });
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
