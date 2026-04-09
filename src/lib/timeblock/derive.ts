import type { BlockTransition, TimeBlockData } from '@/lib/types/event';

export function derivePhase(transitions: BlockTransition[]): 'running' | 'paused' | 'feedback' | 'completed' | 'idle' {
  if (transitions.length === 0) return 'idle';
  const last = transitions[transitions.length - 1];
  switch (last.type) {
    case 'start': case 'resume': return 'running';
    case 'pause': return 'paused';
    case 'feedback_start': return 'feedback';
    case 'feedback_submit': case 'end': return 'completed';
    default: return 'idle';
  }
}

export function deriveIsPaused(transitions: BlockTransition[]): boolean {
  return derivePhase(transitions) === 'paused';
}

export function deriveStartTime(transitions: BlockTransition[]): number | undefined {
  return transitions.length > 0 ? transitions[0].at : undefined;
}

export function deriveEndTime(transitions: BlockTransition[]): number | undefined {
  for (let i = transitions.length - 1; i >= 0; i--) {
    if (transitions[i].type === 'end') return transitions[i].at;
  }
  return undefined;
}

export function deriveAccumulatedRunMs(transitions: BlockTransition[], now: number = Date.now()): number {
  let total = 0;
  let runStart: number | undefined;
  for (const t of transitions) {
    if (t.type === 'start' || t.type === 'resume') {
      runStart = t.at;
    } else if ((t.type === 'pause' || t.type === 'feedback_start' || t.type === 'end') && runStart !== undefined) {
      total += t.at - runStart;
      runStart = undefined;
    }
  }
  if (runStart !== undefined) total += now - runStart;
  return total;
}

export function derivePauseAccumulatedMs(transitions: BlockTransition[], now: number = Date.now()): number {
  let total = 0;
  let pauseStart: number | undefined;
  for (const t of transitions) {
    if (t.type === 'pause') {
      pauseStart = t.at;
    } else if (t.type === 'resume' && pauseStart !== undefined) {
      total += t.at - pauseStart;
      pauseStart = undefined;
    }
  }
  if (pauseStart !== undefined) total += now - pauseStart;
  return total;
}

export function deriveLastResumedAt(transitions: BlockTransition[]): number | undefined {
  for (let i = transitions.length - 1; i >= 0; i--) {
    if (transitions[i].type === 'resume' || transitions[i].type === 'start') return transitions[i].at;
  }
  return undefined;
}

export function derivePhaseFromBlock(block: Pick<TimeBlockData, 'transitions' | 'phase' | 'paused' | 'actionEndedAt' | 'feedbackStartedAt' | 'feedbackSubmittedAt'>): 'running' | 'paused' | 'feedback' | 'completed' | 'idle' {
  const transitions = block.transitions ?? [];
  if (transitions.length > 0) {
    return derivePhase(transitions);
  }
  if (block.feedbackSubmittedAt || block.phase === 'feedback_submitted') {
    return 'completed';
  }
  if (block.actionEndedAt || block.feedbackStartedAt || block.phase === 'feedback_in_progress' || block.phase === 'action_ended') {
    return 'feedback';
  }
  if (block.phase === 'paused' || block.paused) {
    return 'paused';
  }
  if (block.phase === 'running') {
    return 'running';
  }
  return 'idle';
}

export function deriveStartTimeFromBlock(block: Pick<TimeBlockData, 'transitions' | 'startTime'>): number | undefined {
  return deriveStartTime(block.transitions ?? []) ?? block.startTime;
}

export function deriveEndTimeFromBlock(block: Pick<TimeBlockData, 'transitions' | 'endTime' | 'feedbackSubmittedAt'>): number | undefined {
  return deriveEndTime(block.transitions ?? []) ?? block.endTime ?? block.feedbackSubmittedAt;
}

export function deriveAccumulatedRunMsFromBlock(
  block: Pick<TimeBlockData, 'transitions' | 'accumulatedRunMs' | 'elapsed' | 'mode' | 'targetMinutes'>,
  now: number = Date.now(),
): number {
  if ((block.transitions ?? []).length > 0) {
    return deriveAccumulatedRunMs(block.transitions ?? [], now);
  }
  if (typeof block.accumulatedRunMs === 'number') {
    return Math.max(0, block.accumulatedRunMs);
  }
  if (block.mode === 'countdown') {
    return Math.max(0, (block.targetMinutes ?? 25) * 60_000 - Math.max(0, block.elapsed ?? 0));
  }
  return Math.max(0, block.elapsed ?? 0);
}

export function derivePauseAccumulatedMsFromBlock(
  block: Pick<TimeBlockData, 'transitions' | 'pauseAccumulatedMs'>,
  now: number = Date.now(),
): number {
  if ((block.transitions ?? []).length > 0) {
    return derivePauseAccumulatedMs(block.transitions ?? [], now);
  }
  return Math.max(0, block.pauseAccumulatedMs ?? 0);
}
