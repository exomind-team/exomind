const ME_PAGE_ENABLED_STORAGE_KEY = 'exomind:mePageEnabled';
const ME_PAGE_ENABLED_CHANGED_EVENT = 'exomind:me-page-enabled-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

export function getMePageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return normalizeBoolean(window.localStorage.getItem(ME_PAGE_ENABLED_STORAGE_KEY));
}

export function setMePageEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ME_PAGE_ENABLED_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(ME_PAGE_ENABLED_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeMePageEnabledChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== ME_PAGE_ENABLED_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(ME_PAGE_ENABLED_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(ME_PAGE_ENABLED_CHANGED_EVENT, handleCustomEvent);
  };
}
