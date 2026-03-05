import type { ActiveBlockData } from '@/lib/types/event';

function isFeedbackStage(block: ActiveBlockData): boolean {
  return block.phase === 'feedback_in_progress'
    || block.phase === 'action_ended'
    || block.phase === 'feedback_submitted'
    || Boolean(block.actionEndedAt || block.feedbackStartedAt || block.feedbackSubmittedAt);
}

function resolveEffectiveNow(block: ActiveBlockData, now: number): number {
  if (isFeedbackStage(block)) {
    return block.actionEndedAt
      ?? block.feedbackStartedAt
      ?? block.feedbackSubmittedAt
      ?? block.lastTransitionAt
      ?? now;
  }

  if (block.paused) {
    return block.pausedAt ?? block.lastTransitionAt ?? now;
  }

  return now;
}

function resolveWorkDurationMs(block: ActiveBlockData, effectiveNow: number): number {
  if (typeof block.accumulatedRunMs === 'number') {
    const runningSliceMs = (!block.paused && !block.actionEndedAt)
      ? Math.max(0, effectiveNow - (block.lastResumedAt ?? effectiveNow))
      : 0;
    return Math.max(0, block.accumulatedRunMs + runningSliceMs);
  }

  const basePausedMs = Math.max(0, block.pauseAccumulatedMs ?? 0);
  const pausedSliceMs = block.paused && typeof block.pausedAt === 'number'
    ? Math.max(0, effectiveNow - block.pausedAt)
    : 0;
  return Math.max(0, effectiveNow - block.startTime - basePausedMs - pausedSliceMs);
}

export function resolveCountdownOverrunMs(block: ActiveBlockData, now: number = Date.now()): number {
  if (block.mode !== 'countdown') {
    return 0;
  }

  const targetMinutes = block.targetMinutes ?? 25;
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) {
    return 0;
  }

  const expectedDurationMs = targetMinutes * 60 * 1000;
  const effectiveNow = resolveEffectiveNow(block, now);
  const workDurationMs = resolveWorkDurationMs(block, effectiveNow);
  return Math.max(0, workDurationMs - expectedDurationMs);
}
