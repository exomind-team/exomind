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

  it('filters invalid array items in dirty storage（过滤脏数组元素避免页面崩溃）', async () => {
    const dirty = {
      status: {
        summaryTitle: '脏数据状态',
        updatedAtLabel: '11:22',
        metrics: [null, 'x', { id: 'm1', title: '身能', value: '80', hint: '正常', tone: 'green' }],
        financeMetrics: [{ id: 1 }, { id: 'f1', title: '预算', value: '¥100', hint: 'safe', tone: 'amber' }],
        behaviorCompletionText: '50%',
        behaviorPatterns: [
          'bad',
          { id: 'bp1', title: '复盘', streakText: '连续 2 天', state: 'good' },
        ],
        historyItems: [
          null,
          { id: 'h1', title: '历史项', detail: 'detail', deltaText: '→0', deltaTone: 'flat' },
        ],
      },
      learn: {
        urgentItems: [
          { id: 'u1', title: 'Rust', source: 'src', priorityText: '1', tone: 'warm' },
          1,
        ],
        lanes: [
          {
            id: 'l1',
            title: '编译器',
            countText: '1',
            progressText: '1/2',
            tags: ['ok', 2, null],
          },
          'bad',
        ],
      },
      implicit: {
        beliefNodes: [
          { id: 'b1', label: '输出优先', x: 12, y: 20, emphasis: 'primary' },
          { id: 'b2', label: '坏坐标', x: 'bad', y: null, emphasis: 'secondary' },
          null,
        ],
        habitLoops: [
          { id: 'hl1', name: 'loop', cue: 'cue', routine: 'routine', reward: 'reward', frequencyText: 'daily', state: 'warn' },
          { id: 12 },
        ],
      },
    };

    window.localStorage.setItem('exomind:meDashboard', JSON.stringify(dirty));

    const adapter = new MeWebAdapter();
    const result = await adapter.getDashboardData();

    expect(result.status.metrics).toHaveLength(1);
    expect(result.status.behaviorPatterns).toHaveLength(1);
    expect(result.status.historyItems).toHaveLength(1);
    expect(result.learn.urgentItems).toHaveLength(1);
    expect(result.learn.lanes).toHaveLength(1);
    expect(result.learn.lanes[0]?.tags).toEqual(['ok']);
    expect(result.implicit.beliefNodes).toHaveLength(2);
    expect(result.implicit.beliefNodes[1]?.x).toBe(0);
    expect(result.implicit.beliefNodes[1]?.y).toBe(0);
    expect(result.implicit.habitLoops).toHaveLength(1);
  });
});
