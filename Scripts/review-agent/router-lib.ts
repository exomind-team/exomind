import type {
  PersistedState,
  QueueState,
} from './state-lib.ts';

export interface RouterContext {
  state: PersistedState | null;
  queue: QueueState | null;
  openPrNumbers: number[];
}

export interface RouterDecision {
  action: 'discovery' | 'review' | 'idle-wait';
  reason: string;
  selectedPrNumber: number | null;
  sleepSeconds: number;
}

export function decideNextAction(context: RouterContext): RouterDecision {
  if (!context.state) {
    return {
      action: 'discovery',
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
        action: 'review',
        reason: 'resume-selected-pr',
        selectedPrNumber,
        sleepSeconds: 0,
      };
    }

    return {
      action: 'discovery',
      reason: 'stale-selected-pr',
      selectedPrNumber: null,
      sleepSeconds: 0,
    };
  }

  if (context.state.state === 'NO_TARGET') {
    return {
      action: 'discovery',
      reason: 'recheck-no-target',
      selectedPrNumber: null,
      sleepSeconds: 0,
    };
  }

  if (
    context.state.state === 'REVIEW_POSTED'
    || context.state.state === 'NEEDS_HUMAN_TEST'
    || context.state.state === 'APPROVE_READY'
    || context.state.state === 'MERGE_READY'
    || context.state.state === 'MERGE_BLOCKED'
  ) {
    return {
      action: 'discovery',
      reason: 'review-finished',
      selectedPrNumber: null,
      sleepSeconds: 0,
    };
  }

  if (context.state.lastPhase === 'REVIEW' && selectedPrOpen) {
    return {
      action: 'review',
      reason: 'retry-review',
      selectedPrNumber,
      sleepSeconds: 0,
    };
  }

  return {
    action: 'discovery',
    reason: 'retry-discovery',
    selectedPrNumber: null,
    sleepSeconds: 0,
  };
}
