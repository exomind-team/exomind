const COMMAND_PALETTE_ENABLED_STORAGE_KEY = 'exomind:commandPaletteEnabled';
const COMMAND_PALETTE_ENABLED_CHANGED_EVENT = 'exomind:command-palette-enabled-changed';

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

export function getCommandPaletteEnabled(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return normalizeBoolean(storage.getItem(COMMAND_PALETTE_ENABLED_STORAGE_KEY));
}

export function setCommandPaletteEnabled(enabled: boolean): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(COMMAND_PALETTE_ENABLED_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(COMMAND_PALETTE_ENABLED_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeCommandPaletteEnabledChanges(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== COMMAND_PALETTE_ENABLED_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(COMMAND_PALETTE_ENABLED_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(COMMAND_PALETTE_ENABLED_CHANGED_EVENT, handleCustomEvent);
  };
}
