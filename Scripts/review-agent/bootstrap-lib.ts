import type {
  PersistedState,
  QueueState,
  ReviewAgentNextPrompt,
  ReviewAgentPhase,
} from './state-lib.ts';

export interface BootstrapContext {
  state: PersistedState | null;
  queue: QueueState | null;
  openPrNumbers: number[];
}

export interface BootstrapDecision {
  phase: ReviewAgentPhase;
  nextPrompt: Exclude<ReviewAgentNextPrompt, 'bootstrap'>;
  reason: string;
  selectedPrNumber: number | null;
  sleepSeconds: number;
}

export function decideBootstrapAction(context: BootstrapContext): BootstrapDecision {
  if (!context.state) {
    return {
      phase: 'DISCOVERY',
      nextPrompt: 'discovery',
      reason: 'missing-state',
      selectedPrNumber: null,
      sleepSeconds: 0,
    };
  }

  const selectedPrNumber = context.queue?.selectedPr?.number ?? context.state.selectedPrNumber;
  const selectedPrOpen = selectedPrNumber !== null && context.openPrNumbers.includes(selectedPrNumber);

  if (context.state.state === 'HAS_TARGET') {
    if (selectedPrOpen) {
      return {
        phase: 'REVIEW',
        nextPrompt: 'review',
        reason: 'resume-selected-pr',
        selectedPrNumber,
        sleepSeconds: 0,
      };
    }

    return {
      phase: 'DISCOVERY',
      nextPrompt: 'discovery',
      reason: 'stale-selected-pr',
      selectedPrNumber: null,
      sleepSeconds: 0,
    };
  }

  if (context.state.state === 'NO_TARGET') {
    return {
      phase: 'IDLE_WAIT',
      nextPrompt: 'idle-wait',
      reason: 'no-target',
      selectedPrNumber: null,
      sleepSeconds: context.state.nextSleepSeconds,
    };
  }

  if (context.state.lastPhase === 'REVIEW' && selectedPrOpen) {
    return {
      phase: 'REVIEW',
      nextPrompt: 'review',
      reason: 'retry-review',
      selectedPrNumber,
      sleepSeconds: 0,
    };
  }

  return {
    phase: 'DISCOVERY',
    nextPrompt: 'discovery',
    reason: 'retry-discovery',
    selectedPrNumber: null,
    sleepSeconds: 0,
  };
}
