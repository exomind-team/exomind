import { beforeEach, describe, expect, it } from 'vitest';
import { MeWebAdapter } from '@/lib/adapters/me-web-adapter';
import { MOCK_ME_DASHBOARD_FIXTURE } from '@/lib/adapters/mock/fixtures/me';

describe('issue-215 me web adapter（真实模式数据读取）', () => {
  beforeEach(() => {
    window.localStorage.removeItem('exomind:meDashboard');
  });

  it('returns empty-state dashboard when storage is empty（无存储时返回空态）', async () => {
    const adapter = new MeWebAdapter();
    const result = await adapter.getDashboardData();

    expect(result.status.summaryTitle).toBe('暂无状态数据');
    expect(result.status.metrics).toHaveLength(0);
    expect(result.learn.urgentItems).toHaveLength(0);
    expect(result.implicit.beliefNodes).toHaveLength(0);
    expect(result.status.summaryTitle).not.toBe(MOCK_ME_DASHBOARD_FIXTURE.status.summaryTitle);
  });

  it('returns empty-state dashboard when storage is invalid JSON（坏数据时返回空态）', async () => {
    window.localStorage.setItem('exomind:meDashboard', '{invalid-json');

    const adapter = new MeWebAdapter();
    const result = await adapter.getDashboardData();

    expect(result.status.summaryTitle).toBe('暂无状态数据');
    expect(result.status.metrics).toHaveLength(0);
    expect(result.learn.lanes).toHaveLength(0);
  });

  it('returns stored dashboard data when storage is valid（有真实数据时返回真实数据）', async () => {
    const stored = {
      status: {
        summaryTitle: '真实状态',
        updatedAtLabel: '10:00',
        metrics: [],
        financeMetrics: [],
        behaviorCompletionText: '0%',
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
    window.localStorage.setItem('exomind:meDashboard', JSON.stringify(stored));

    const adapter = new MeWebAdapter();
    const result = await adapter.getDashboardData();

    expect(result.status.summaryTitle).toBe('真实状态');
    expect(result.status.updatedAtLabel).toBe('10:00');
  });
});

