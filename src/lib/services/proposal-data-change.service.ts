const proposalDataChangeListeners = new Set<() => void>();

export function subscribeProposalDataChanges(listener: () => void): () => void {
  proposalDataChangeListeners.add(listener);
  return () => {
    proposalDataChangeListeners.delete(listener);
  };
}

export function notifyProposalDataChanged(): void {
  for (const listener of [...proposalDataChangeListeners]) {
    try {
      listener();
    } catch {
      // Ignore listener errors so one broken consumer does not block the rest.
    }
  }
}
