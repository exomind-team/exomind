import { createConfigModule } from './config-factory';

export const VOLCANO_USAGE_STORAGE_KEY = 'exomind:volcanoUsageStats';
const VOLCANO_USAGE_EVENT_NAME = 'exomind:volcano-usage-stats-changed';
export const DEFAULT_VOLCANO_PACKAGE_HOURS = 30;

export interface VolcanoUsageDayRecord {
  seconds: number;
  requests: number;
}

export interface VolcanoUsageStats {
  packageHours: number;
  totalUsedSeconds: number;
  totalRequests: number;
  byDay: Record<string, VolcanoUsageDayRecord>;
  updatedAt: string | null;
}

export interface VolcanoUsageSummary {
  packageHours: number;
  packageSeconds: number;
  totalUsedSeconds: number;
  todayUsedSeconds: number;
  last7DaysUsedSeconds: number;
  totalRequests: number;
  remainingSeconds: number;
  usedRatio: number;
  estimatedRemainingDays: number | null;
}

function createDefaultStats(): VolcanoUsageStats {
  return {
    packageHours: DEFAULT_VOLCANO_PACKAGE_HOURS,
    totalUsedSeconds: 0,
    totalRequests: 0,
    byDay: {},
    updatedAt: null,
  };
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function normalizeNonNegativeInt(value: unknown): number {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? Math.round(next) : 0;
}

function normalizeStats(rawValue: string | null | undefined): VolcanoUsageStats {
  if (!rawValue) {
    return createDefaultStats();
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<VolcanoUsageStats> | null;
    if (!parsed || typeof parsed !== 'object') {
      return createDefaultStats();
    }

    const byDayEntries = Object.entries(parsed.byDay ?? {}).map(([day, record]) => {
      const nextRecord = typeof record === 'object' && record !== null ? record as Partial<VolcanoUsageDayRecord> : {};
      return [
        day,
        {
          seconds: normalizeNonNegativeInt(nextRecord.seconds),
          requests: normalizeNonNegativeInt(nextRecord.requests),
        },
      ] as const;
    });

    return {
      packageHours: normalizePositiveNumber(parsed.packageHours, DEFAULT_VOLCANO_PACKAGE_HOURS),
      totalUsedSeconds: normalizeNonNegativeInt(parsed.totalUsedSeconds),
      totalRequests: normalizeNonNegativeInt(parsed.totalRequests),
      byDay: Object.fromEntries(byDayEntries),
      updatedAt: typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim() ? parsed.updatedAt : null,
    };
  } catch {
    return createDefaultStats();
  }
}

function toDayKey(input: Date | number): string {
  const date = typeof input === 'number' ? new Date(input) : input;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const volcanoUsageModule = createConfigModule<VolcanoUsageStats>({
  storageKey: VOLCANO_USAGE_STORAGE_KEY,
  eventName: VOLCANO_USAGE_EVENT_NAME,
  defaultValue: createDefaultStats(),
  normalize: normalizeStats,
  serialize: (value) => JSON.stringify(value),
});

export function getVolcanoUsageStats(): VolcanoUsageStats {
  return volcanoUsageModule.get();
}

export function subscribeVolcanoUsageStatsChanges(
  listener: (value: VolcanoUsageStats) => void,
): () => void {
  return volcanoUsageModule.subscribe(listener);
}

export function setVolcanoPackageHours(hours: number): VolcanoUsageStats {
  const current = getVolcanoUsageStats();
  return volcanoUsageModule.set({
    ...current,
    packageHours: normalizePositiveNumber(hours, DEFAULT_VOLCANO_PACKAGE_HOURS),
    updatedAt: new Date().toISOString(),
  });
}

export function recordVolcanoUsageDuration(durationMs: number, at: Date | number = Date.now()): VolcanoUsageStats {
  const seconds = Math.round(durationMs / 1000);
  if (seconds <= 0) {
    return getVolcanoUsageStats();
  }

  const current = getVolcanoUsageStats();
  const dayKey = toDayKey(at);
  const currentDay = current.byDay[dayKey] ?? { seconds: 0, requests: 0 };

  return volcanoUsageModule.set({
    ...current,
    totalUsedSeconds: current.totalUsedSeconds + seconds,
    totalRequests: current.totalRequests + 1,
    byDay: {
      ...current.byDay,
      [dayKey]: {
        seconds: currentDay.seconds + seconds,
        requests: currentDay.requests + 1,
      },
    },
    updatedAt: new Date(typeof at === 'number' ? at : at.getTime()).toISOString(),
  });
}

export function getVolcanoUsageSummary(
  stats: VolcanoUsageStats,
  now: Date | number = Date.now(),
): VolcanoUsageSummary {
  const packageSeconds = Math.round(stats.packageHours * 3600);
  const currentDate = typeof now === 'number' ? new Date(now) : now;
  const todayKey = toDayKey(currentDate);

  let last7DaysUsedSeconds = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(currentDate);
    date.setDate(currentDate.getDate() - offset);
    last7DaysUsedSeconds += stats.byDay[toDayKey(date)]?.seconds ?? 0;
  }

  const remainingSeconds = Math.max(0, packageSeconds - stats.totalUsedSeconds);
  const usedRatio = packageSeconds > 0 ? Math.min(1, stats.totalUsedSeconds / packageSeconds) : 0;
  const averageDailySeconds = last7DaysUsedSeconds > 0 ? last7DaysUsedSeconds / 7 : 0;

  return {
    packageHours: stats.packageHours,
    packageSeconds,
    totalUsedSeconds: stats.totalUsedSeconds,
    todayUsedSeconds: stats.byDay[todayKey]?.seconds ?? 0,
    last7DaysUsedSeconds,
    totalRequests: stats.totalRequests,
    remainingSeconds,
    usedRatio,
    estimatedRemainingDays: averageDailySeconds > 0 ? remainingSeconds / averageDailySeconds : null,
  };
}
