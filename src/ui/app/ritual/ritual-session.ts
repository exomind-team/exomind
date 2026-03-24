export type RitualStage = 'pre_boot' | 'intent_setup' | 'day_hub' | 'shutdown_ready' | 'shutdown_done';

export interface RitualSession {
  dayKey: string;
  bootedAt: number | null;
  selectedPlanId: string | null;
  mainTaskCompletedAt?: number | null;
  shutdownCompletedAt: number | null;
}

export interface ResolveRitualStageInput {
  hasActiveBlock?: boolean;
  isEvening?: boolean;
}

export function createEmptyRitualSession(dayKey: string): RitualSession {
  return {
    dayKey,
    bootedAt: null,
    selectedPlanId: null,
    mainTaskCompletedAt: null,
    shutdownCompletedAt: null,
  };
}

export function resolveRitualStage(
  session: RitualSession,
  input: ResolveRitualStageInput = {},
): RitualStage {
  if (session.shutdownCompletedAt) {
    return 'shutdown_done';
  }

  if (!session.bootedAt) {
    return 'pre_boot';
  }

  if (!session.selectedPlanId) {
    return 'intent_setup';
  }

  if (session.mainTaskCompletedAt && !input.hasActiveBlock && input.isEvening) {
    return 'shutdown_ready';
  }

  return 'day_hub';
}
