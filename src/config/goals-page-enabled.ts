const GOALS_PAGE_ENABLED_STORAGE_KEY = 'exomind:goalsPageEnabled';
const GOALS_PAGE_ENABLED_CHANGED_EVENT = 'exomind:goals-page-enabled-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

export function getGoalsPageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return normalizeBoolean(window.localStorage.getItem(GOALS_PAGE_ENABLED_STORAGE_KEY));
}

export function setGoalsPageEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GOALS_PAGE_ENABLED_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(GOALS_PAGE_ENABLED_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeGoalsPageEnabledChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== GOALS_PAGE_ENABLED_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(GOALS_PAGE_ENABLED_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(GOALS_PAGE_ENABLED_CHANGED_EVENT, handleCustomEvent);
  };
}
