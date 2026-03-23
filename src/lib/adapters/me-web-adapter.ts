import type { IMePort } from '@/lib/environment/interfaces/me.port';
import type {
  MeBehaviorPattern,
  MeDashboardData,
  MeHabitLoop,
  MeImplicitNode,
  MeKnowledgeLane,
  MeLearningItem,
  MePatternHistoryItem,
  MeStatusMetric,
} from '@/lib/types/me';

const ME_DASHBOARD_STORAGE_KEY = 'exomind:meDashboard'; // storage key（本地存储键）

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const EMPTY_ME_DASHBOARD: MeDashboardData = {
  status: {
    summaryTitle: '暂无状态数据',
    updatedAtLabel: '--:--',
    metrics: [],
    financeMetrics: [],
    behaviorCompletionText: '暂无行为数据',
    behaviorPatterns: [],
    historyItems: [],
  },
  learn: {
    urgentItems: [],
    lanes: [],
  },
  implicit: {
    beliefNodes: [],
    habitLoops: [],
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeArray<T>(value: unknown, normalizeItem: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeItem)
    .filter((item): item is T => item !== null);
}

function normalizeMetricTone(value: unknown): MeStatusMetric['tone'] {
  return value === 'green' || value === 'blue' || value === 'amber' || value === 'rose'
    ? value
    : 'warm';
}

function normalizeBehaviorState(value: unknown): MeBehaviorPattern['state'] {
  return value === 'good' || value === 'risk' ? value : 'warn';
}

function normalizeDeltaTone(value: unknown): MePatternHistoryItem['deltaTone'] {
  return value === 'up' || value === 'down' ? value : 'flat';
}

function normalizeLearningTone(value: unknown): MeLearningItem['tone'] {
  return value === 'blue' || value === 'purple' ? value : 'warm';
}

function normalizeEmphasis(value: unknown): MeImplicitNode['emphasis'] {
  return value === 'primary' || value === 'secondary' ? value : 'tertiary';
}

function normalizeStatusMetric(value: unknown): MeStatusMetric | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') return null;
  return {
    id: record.id,
    title: normalizeString(record.title, '--'),
    value: normalizeString(record.value, '--'),
    hint: normalizeString(record.hint, ''),
    tone: normalizeMetricTone(record.tone),
  };
}

function normalizeBehaviorPattern(value: unknown): MeBehaviorPattern | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') return null;
  return {
    id: record.id,
    title: normalizeString(record.title, '--'),
    streakText: normalizeString(record.streakText, '--'),
    state: normalizeBehaviorState(record.state),
  };
}

function normalizePatternHistoryItem(value: unknown): MePatternHistoryItem | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') return null;
  return {
    id: record.id,
    title: normalizeString(record.title, '--'),
    detail: normalizeString(record.detail, ''),
    deltaText: normalizeString(record.deltaText, '--'),
    deltaTone: normalizeDeltaTone(record.deltaTone),
  };
}

function normalizeLearningItem(value: unknown): MeLearningItem | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') return null;
  return {
    id: record.id,
    title: normalizeString(record.title, '--'),
    source: normalizeString(record.source, '--'),
    priorityText: normalizeString(record.priorityText, '--'),
    tone: normalizeLearningTone(record.tone),
  };
}

function normalizeKnowledgeLane(value: unknown): MeKnowledgeLane | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') return null;
  return {
    id: record.id,
    title: normalizeString(record.title, '--'),
    countText: normalizeString(record.countText, '--'),
    progressText: normalizeString(record.progressText, '--'),
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  };
}

function normalizeImplicitNode(value: unknown): MeImplicitNode | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') return null;
  return {
    id: record.id,
    label: normalizeString(record.label, record.id),
    x: normalizeNumber(record.x, 0),
    y: normalizeNumber(record.y, 0),
    emphasis: normalizeEmphasis(record.emphasis),
  };
}

function normalizeHabitLoop(value: unknown): MeHabitLoop | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string') return null;
  return {
    id: record.id,
    name: normalizeString(record.name, '--'),
    cue: normalizeString(record.cue, '--'),
    routine: normalizeString(record.routine, '--'),
    reward: normalizeString(record.reward, '--'),
    frequencyText: normalizeString(record.frequencyText, '--'),
    state: normalizeBehaviorState(record.state),
  };
}

function normalizeDashboardData(raw: unknown): MeDashboardData {
  if (!raw || typeof raw !== 'object') {
    return deepClone(EMPTY_ME_DASHBOARD);
  }

  const value = raw as Partial<MeDashboardData>;
  return {
    status: {
      summaryTitle: typeof value.status?.summaryTitle === 'string'
        ? value.status.summaryTitle
        : EMPTY_ME_DASHBOARD.status.summaryTitle,
      updatedAtLabel: typeof value.status?.updatedAtLabel === 'string'
        ? value.status.updatedAtLabel
        : EMPTY_ME_DASHBOARD.status.updatedAtLabel,
      metrics: normalizeArray(value.status?.metrics, normalizeStatusMetric),
      financeMetrics: normalizeArray(value.status?.financeMetrics, normalizeStatusMetric),
      behaviorCompletionText: typeof value.status?.behaviorCompletionText === 'string'
        ? value.status.behaviorCompletionText
        : EMPTY_ME_DASHBOARD.status.behaviorCompletionText,
      behaviorPatterns: normalizeArray(value.status?.behaviorPatterns, normalizeBehaviorPattern),
      historyItems: normalizeArray(value.status?.historyItems, normalizePatternHistoryItem),
    },
    learn: {
      urgentItems: normalizeArray(value.learn?.urgentItems, normalizeLearningItem),
      lanes: normalizeArray(value.learn?.lanes, normalizeKnowledgeLane),
    },
    implicit: {
      beliefNodes: normalizeArray(value.implicit?.beliefNodes, normalizeImplicitNode),
      habitLoops: normalizeArray(value.implicit?.habitLoops, normalizeHabitLoop),
    },
  };
}

export class MeWebAdapter implements IMePort {
  async getDashboardData(): Promise<MeDashboardData> {
    if (typeof window === 'undefined') {
      return deepClone(EMPTY_ME_DASHBOARD);
    }

    const raw = window.localStorage.getItem(ME_DASHBOARD_STORAGE_KEY);
    if (!raw) {
      return deepClone(EMPTY_ME_DASHBOARD);
    }

    try {
      return normalizeDashboardData(JSON.parse(raw));
    } catch {
      return deepClone(EMPTY_ME_DASHBOARD);
    }
  }
}
