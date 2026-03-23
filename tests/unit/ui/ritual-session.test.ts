import { describe, expect, it } from 'vitest';
import { createEmptyRitualSession, resolveRitualStage } from '@/ui/app/ritual/ritual-session';

describe('ritual session（每日仪式会话）', () => {
  it('starts in pre_boot for a new day（新的一天默认未开机）', () => {
    const session = createEmptyRitualSession('2026-03-19');
    expect(resolveRitualStage(session)).toBe('pre_boot');
  });

  it('moves to shutdown_ready after the main task is done and no block is active（主任务完成且无活跃块时进入待收工）', () => {
    const session = {
      dayKey: '2026-03-19',
      bootedAt: 1,
      selectedPlanId: 'plan-1',
      shutdownCompletedAt: null,
      mainTaskCompletedAt: 2,
    };

    expect(resolveRitualStage(session, { hasActiveBlock: false, isEvening: true })).toBe('shutdown_ready');
  });
});
