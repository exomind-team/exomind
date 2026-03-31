import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VOLCANO_PACKAGE_HOURS,
  getVolcanoUsageStats,
  getVolcanoUsageSummary,
  recordVolcanoUsageDuration,
  setVolcanoPackageHours,
  VOLCANO_USAGE_STORAGE_KEY,
} from '@/config/volcano-usage-stats';

describe('volcano-usage-stats（火山用量统计）', () => {
  beforeEach(() => {
    window.localStorage.removeItem(VOLCANO_USAGE_STORAGE_KEY);
  });

  it('tracks total, today, remaining and usage ratio（统计累计/今日/剩余/占比）', () => {
    setVolcanoPackageHours(30);
    vi.setSystemTime(new Date('2026-03-31T10:00:00.000Z'));

    recordVolcanoUsageDuration(3_600_000, new Date('2026-03-31T08:00:00.000Z'));
    recordVolcanoUsageDuration(1_800_000, new Date('2026-03-30T08:00:00.000Z'));

    const stats = getVolcanoUsageStats();
    const summary = getVolcanoUsageSummary(stats, new Date('2026-03-31T10:00:00.000Z'));

    expect(summary.packageHours).toBe(30);
    expect(summary.totalUsedSeconds).toBe(5_400);
    expect(summary.todayUsedSeconds).toBe(3_600);
    expect(summary.remainingSeconds).toBe(102_600);
    expect(summary.usedRatio).toBeCloseTo(0.05, 4);
  });

  it('defaults package hours to 30（默认资源包总时长为 30 小时）', () => {
    const stats = getVolcanoUsageStats();
    expect(stats.packageHours).toBe(DEFAULT_VOLCANO_PACKAGE_HOURS);
  });
});
