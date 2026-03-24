import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRitualSession,
  loadRitualSession,
  saveRitualSession,
} from '@/ui/app/ritual/ritual-session-storage';

describe('ritual session storage（每日仪式会话存储）', () => {
  beforeEach(() => {
    clearRitualSession();
  });

  it('loads the saved ritual session from localStorage（可从本地存储读取会话）', () => {
    saveRitualSession({
      dayKey: '2026-03-19',
      bootedAt: 100,
      selectedPlanId: 'carry-over',
      mainTaskCompletedAt: null,
      shutdownCompletedAt: null,
    });

    expect(loadRitualSession()).toMatchObject({
      dayKey: '2026-03-19',
      selectedPlanId: 'carry-over',
    });
  });
});
