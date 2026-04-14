import type { TimeBlockData } from '@/lib/types/event';
import {
  deriveAccumulatedRunMsFromBlock,
  derivePhaseFromBlock,
  derivePauseAccumulatedMsFromBlock,
} from '@/lib/timeblock/derive';

export interface CountdownTimingSnapshot {
  effectiveNow: number;
  expectedDurationMs: number;
  workDurationMs: number;
  remainingMs: number;
  overrunMs: number;
  isFeedbackStage: boolean;
}

function isFeedbackStage(block: TimeBlockData): boolean {
  return derivePhaseFromBlock(block) === 'feedback'
    || derivePhaseFromBlock(block) === 'completed';
}

function resolveEffectiveNow(block: TimeBlockData, now: number): number {
  const transitions = block.transitions ?? [];
  const lastTransitionAt = transitions.length > 0 ? transitions[transitions.length - 1].at : block.lastTransitionAt;
  if (isFeedbackStage(block)) {
    return block.actionEndedAt
      ?? block.feedbackStartedAt
      ?? block.feedbackSubmittedAt
      ?? lastTransitionAt
      ?? now;
  }

  if (derivePhaseFromBlock(block) === 'paused') {
    return block.pausedAt ?? lastTransitionAt ?? now;
  }

  return now;
}

function resolveWorkDurationMs(block: TimeBlockData, effectiveNow: number): number {
  const phase = derivePhaseFromBlock(block);
  if ((block.transitions?.length ?? 0) > 0) {
    return Math.max(0, deriveAccumulatedRunMsFromBlock(block, effectiveNow));
  }

  if (typeof block.accumulatedRunMs === 'number') {
    const runningSliceMs = (phase === 'running')
      ? Math.max(0, effectiveNow - (block.lastResumedAt ?? effectiveNow))
      : 0;
    return Math.max(0, block.accumulatedRunMs + runningSliceMs);
  }

  const basePausedMs = derivePauseAccumulatedMsFromBlock(block, effectiveNow);
  const pausedSliceMs = phase === 'paused' && typeof block.pausedAt === 'number'
    ? Math.max(0, effectiveNow - block.pausedAt)
    : 0;
  return Math.max(0, effectiveNow - block.startTime - basePausedMs - pausedSliceMs);
}

export function resolveCountdownTiming(block: TimeBlockData, now: number = Date.now()): CountdownTimingSnapshot | null {
  if (block.mode !== 'countdown') {
    return null;
  }

  const targetMinutes = block.targetMinutes ?? 25;
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) {
    return null;
  }

  const expectedDurationMs = targetMinutes * 60 * 1000;
  const effectiveNow = resolveEffectiveNow(block, now);
  const workDurationMs = resolveWorkDurationMs(block, effectiveNow);
  const remainingMs = Math.max(0, expectedDurationMs - workDurationMs);
  const overrunMs = Math.max(0, workDurationMs - expectedDurationMs);

  return {
    effectiveNow,
    expectedDurationMs,
    workDurationMs,
    remainingMs,
    overrunMs,
    isFeedbackStage: isFeedbackStage(block),
  };
}
