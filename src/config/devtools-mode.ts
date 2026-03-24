const DEVTOOLS_ENABLED_STORAGE_KEY = 'exomind:devtoolsEnabled';
const DEVTOOLS_CHANGED_EVENT = 'exomind:devtools-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

function getStorage():
  | Pick<Storage, 'getItem' | 'setItem'>
  | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

export function getDevtoolsEnabled(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return normalizeBoolean(storage.getItem(DEVTOOLS_ENABLED_STORAGE_KEY));
}

export function setDevtoolsEnabled(enabled: boolean): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(DEVTOOLS_ENABLED_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(DEVTOOLS_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeDevtoolsChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== DEVTOOLS_ENABLED_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(DEVTOOLS_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(DEVTOOLS_CHANGED_EVENT, handleCustomEvent);
  };
}
