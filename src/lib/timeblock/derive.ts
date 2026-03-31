import type { BlockTransition } from '@/lib/types/event';

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
