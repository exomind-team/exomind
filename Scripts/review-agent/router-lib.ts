import type {
  PersistedState,
  QueueState,
} from './state-lib.ts';

export interface RouterContext {
  state: PersistedState | null;
  queue: QueueState | null;
  openPrNumbers: number[];
  selectedPrUpdatedAt: string | null;
}

export interface RouterDecision {
  action: 'discovery' | 'review' | 'idle-wait';
  reason: string;
  selectedPrNumber: number | null;
  sleepSeconds: number;
  referencesMustRead: string[];
}

const DISCOVERY_LOOP_REFERENCE = 'docs/agents/review-agent/discovery-loop.md';
const REVIEW_LOOP_REFERENCE = 'docs/agents/review-agent/review-loop.md';

function buildRouterReferencesMustRead(action: RouterDecision['action']): string[] {
  if (action === 'review') {
    return [REVIEW_LOOP_REFERENCE];
  }

  if (action === 'discovery') {
    return [DISCOVERY_LOOP_REFERENCE];
  }

  return [];
}

export function decideNextAction(context: RouterContext): RouterDecision {
  if (!context.state) {
    return {
      action: 'discovery',
      reason: 'missing-state',
      selectedPrNumber: null,
      sleepSeconds: 0,
      referencesMustRead: buildRouterReferencesMustRead('discovery'),
    };
  }

  const selectedPrNumber = context.queue?.selectedPr?.number ?? context.state.selectedPrNumber;
  const selectedPrOpen = selectedPrNumber !== null && context.openPrNumbers.includes(selectedPrNumber);
  const selectedPrFresh = isSelectedPrFresh(context);

  if (context.state.state === 'HAS_TARGET') {
    if (selectedPrOpen && selectedPrFresh) {
      return {
        action: 'review',
        reason: 'resume-selected-pr',
        selectedPrNumber,
        sleepSeconds: 0,
        referencesMustRead: buildRouterReferencesMustRead('review'),
      };
    }

    return {
      action: 'discovery',
      reason: 'stale-selected-pr',
      selectedPrNumber: null,
      sleepSeconds: 0,
      referencesMustRead: buildRouterReferencesMustRead('discovery'),
    };
  }

  if (context.state.state === 'NO_TARGET') {
    return {
      action: 'discovery',
      reason: 'recheck-no-target',
      selectedPrNumber: null,
      sleepSeconds: 0,
      referencesMustRead: buildRouterReferencesMustRead('discovery'),
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
      referencesMustRead: buildRouterReferencesMustRead('discovery'),
    };
  }

  if (context.state.lastPhase === 'REVIEW' && selectedPrOpen && selectedPrFresh) {
    return {
      action: 'review',
      reason: 'retry-review',
      selectedPrNumber,
      sleepSeconds: 0,
      referencesMustRead: buildRouterReferencesMustRead('review'),
    };
  }

  return {
    action: 'discovery',
    reason: 'retry-discovery',
    selectedPrNumber: null,
    sleepSeconds: 0,
    referencesMustRead: buildRouterReferencesMustRead('discovery'),
  };
}

function isSelectedPrFresh(context: RouterContext): boolean {
  const queuedUpdatedAt = context.queue?.selectedPr?.updatedAt ?? null;
  if (!queuedUpdatedAt || !context.selectedPrUpdatedAt) {
    return false;
  }

  return queuedUpdatedAt === context.selectedPrUpdatedAt;
}
