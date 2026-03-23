import { describe, expect, it } from 'vitest';
import { MOCK_ME_DASHBOARD_FIXTURE } from '@/lib/adapters/mock/fixtures/me';
import type { IMePort } from '@/lib/environment/interfaces/me.port';
import type {
  MeDashboardData,
  MeHabitLoop,
  MeImplicitNode,
  MeLearningItem,
  MeStatusMetric,
  MeViewType,
} from '@/lib/types/me';

function assertMeViewType(value: MeViewType): MeViewType {
  return value;
}

describe('issue-215 me domain contract（Me 领域契约）', () => {
  it('defines me view types（定义三视图类型）', () => {
    expect(assertMeViewType('status')).toBe('status');
    expect(assertMeViewType('learn')).toBe('learn');
    expect(assertMeViewType('implicit')).toBe('implicit');
  });

  it('provides fixture with required status/learn/implicit sections（fixture 具备三视图数据）', () => {
    const fixture: MeDashboardData = MOCK_ME_DASHBOARD_FIXTURE;

    expect(fixture.status.metrics.length).toBeGreaterThan(0);
    expect(fixture.learn.urgentItems.length).toBeGreaterThan(0);
    expect(fixture.implicit.beliefNodes.length).toBeGreaterThan(0);
    expect(fixture.implicit.habitLoops.length).toBeGreaterThan(0);
  });

  it('keeps metric and knowledge item schema stable（指标与知识条目结构稳定）', () => {
    const metric: MeStatusMetric = MOCK_ME_DASHBOARD_FIXTURE.status.metrics[0];
    const knowledge: MeLearningItem = MOCK_ME_DASHBOARD_FIXTURE.learn.urgentItems[0];
    const beliefNode: MeImplicitNode = MOCK_ME_DASHBOARD_FIXTURE.implicit.beliefNodes[0];
    const loop: MeHabitLoop = MOCK_ME_DASHBOARD_FIXTURE.implicit.habitLoops[0];

    expect(metric.title.length).toBeGreaterThan(0);
    expect(typeof metric.value).toBe('string');
    expect(knowledge.title.length).toBeGreaterThan(0);
    expect(knowledge.source.length).toBeGreaterThan(0);
    expect(beliefNode.label.length).toBeGreaterThan(0);
    expect(loop.name.length).toBeGreaterThan(0);
  });

  it('declares me port with getDashboardData contract（IMePort 提供读取能力）', async () => {
    const adapter: IMePort = {
      async getDashboardData() {
        return MOCK_ME_DASHBOARD_FIXTURE;
      },
    };

    const data = await adapter.getDashboardData();
    expect(data.status.summaryTitle.length).toBeGreaterThan(0);
  });
});

