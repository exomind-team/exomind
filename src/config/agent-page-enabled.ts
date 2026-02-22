const KEY = 'exomind:agentPageEnabled';
const EVENT = 'exomind:agent-page-enabled-changed';

export function getAgentPageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(KEY) === 'true';
}

export function setAgentPageEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: enabled }));
}

export function subscribeAgentPageEnabledChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    listener(event.newValue === 'true');
  };
  const handleCustom = (event: Event) => {
    listener(Boolean((event as CustomEvent<boolean>).detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(EVENT, handleCustom);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(EVENT, handleCustom);
  };
}
