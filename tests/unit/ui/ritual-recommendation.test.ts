import { describe, expect, it } from 'vitest';
import { buildMorningPlanCandidates } from '@/ui/app/ritual/ritual-recommendation';

describe('buildMorningPlanCandidates（晨间主线推荐）', () => {
  it('returns at most 3 focused candidates（最多返回 3 条收束后的候选主线）', () => {
    const plans = buildMorningPlanCandidates({
      carryOverTask: '完成仪式首页设计',
      blockers: ['状态提醒规则未定'],
      fixedPoints: ['20:30 收工'],
      energy: 'medium',
    });

    expect(plans.length).toBeLessThanOrEqual(3);
    expect(plans[0]).toMatchObject({
      title: expect.any(String),
      targetOutcome: expect.any(String),
      suggestedWindows: expect.any(Array),
    });
  });
});
