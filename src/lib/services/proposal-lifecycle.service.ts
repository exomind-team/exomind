import type {
  ProposalCreatedPayload,
  ProposalExecutionFailedPayload,
  ProposalStatusChangedPayload,
} from './signal-handlers';

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
