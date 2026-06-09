import { createConfigModule } from './config-factory';

const PROPOSAL_INBOX_ENABLED_STORAGE_KEY = 'exomind:proposalInboxEnabled';
const PROPOSAL_INBOX_ENABLED_CHANGED_EVENT = 'exomind:proposal-inbox-enabled-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue !== 'false';
}

const proposalInboxEnabledModule = createConfigModule<boolean>({
  storageKey: PROPOSAL_INBOX_ENABLED_STORAGE_KEY,
  eventName: PROPOSAL_INBOX_ENABLED_CHANGED_EVENT,
  defaultValue: true,
  normalize: normalizeBoolean,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

export function getProposalInboxEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return proposalInboxEnabledModule.get();
}

export function setProposalInboxEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  proposalInboxEnabledModule.set(enabled);
}

export function subscribeProposalInboxEnabledChanges(listener: (enabled: boolean) => void): () => void {
  return proposalInboxEnabledModule.subscribe(listener);
}
