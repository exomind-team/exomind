import type { IMePort } from '@/lib/environment/interfaces/me.port';
import type { MeDashboardData } from '@/lib/types/me';

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
      metrics: Array.isArray(value.status?.metrics) ? value.status.metrics : [],
      financeMetrics: Array.isArray(value.status?.financeMetrics) ? value.status.financeMetrics : [],
      behaviorCompletionText: typeof value.status?.behaviorCompletionText === 'string'
        ? value.status.behaviorCompletionText
        : EMPTY_ME_DASHBOARD.status.behaviorCompletionText,
      behaviorPatterns: Array.isArray(value.status?.behaviorPatterns) ? value.status.behaviorPatterns : [],
      historyItems: Array.isArray(value.status?.historyItems) ? value.status.historyItems : [],
    },
    learn: {
      urgentItems: Array.isArray(value.learn?.urgentItems) ? value.learn.urgentItems : [],
      lanes: Array.isArray(value.learn?.lanes) ? value.learn.lanes : [],
    },
    implicit: {
      beliefNodes: Array.isArray(value.implicit?.beliefNodes) ? value.implicit.beliefNodes : [],
      habitLoops: Array.isArray(value.implicit?.habitLoops) ? value.implicit.habitLoops : [],
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
