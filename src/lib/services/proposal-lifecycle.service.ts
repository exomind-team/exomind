import type { Proposal, ProposalStatus } from '@/lib/types/proposal';

type ProposalLifecycleCursorKind =
  | 'proposal_created'
  | 'proposal_status_changed'
  | 'proposal_execution_failed';

interface ProposalLifecycleCursor<K extends ProposalLifecycleCursorKind> {
  kind: K;
  proposalId: string;
  updatedAt: string;
  originHostId?: string;
}

interface ProposalLifecycleBasePayload<K extends ProposalLifecycleCursorKind> {
  schemaVersion: 1;
  scopeKey?: string;
  cursor: ProposalLifecycleCursor<K>;
  proposal: Proposal;
}

export interface ProposalCreatedPayload
  extends ProposalLifecycleBasePayload<'proposal_created'> {}

export interface ProposalStatusChangedPayload
  extends ProposalLifecycleBasePayload<'proposal_status_changed'> {
  transition: {
    fromStatus: ProposalStatus;
    toStatus: ProposalStatus;
  };
}

export interface ProposalExecutionFailedPayload
  extends ProposalLifecycleBasePayload<'proposal_execution_failed'> {
  execution: {
    failureMessage: string;
  };
}

export type ProposalLifecycleEvent =
  | {
    topic: 'proposal.created';
    payload: ProposalCreatedPayload;
  }
  | {
    topic: 'proposal.status_changed';
    payload: ProposalStatusChangedPayload;
  }
  | {
    topic: 'proposal.execution_failed';
    payload: ProposalExecutionFailedPayload;
  };

const proposalLifecycleListeners = new Set<(event: ProposalLifecycleEvent) => void>();

export function subscribeProposalLifecycle(
  listener: (event: ProposalLifecycleEvent) => void,
): () => void {
  proposalLifecycleListeners.add(listener);
  return () => {
    proposalLifecycleListeners.delete(listener);
  };
}

export function emitProposalLifecycle(event: ProposalLifecycleEvent): void {
  for (const listener of [...proposalLifecycleListeners]) {
    try {
      listener(event);
    } catch {
      // Ignore listener errors so one broken consumer does not block the rest.
    }
  }
}
