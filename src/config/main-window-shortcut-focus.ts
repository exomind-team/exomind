const MAIN_WINDOW_SHORTCUT_FOCUS_STORAGE_KEY = 'exomind:mainWindowShortcutQuickFocusEnabled';
const MAIN_WINDOW_SHORTCUT_FOCUS_CHANGED_EVENT = 'exomind:main-window-shortcut-quick-focus-changed';

export type MainWindowShortcutQuickFocusEnabled = boolean;

type SetMainWindowShortcutQuickFocusOptions = {
  emitEvent?: boolean;
};

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

function normalizeEnabled(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

export function getMainWindowShortcutQuickFocusEnabled(): MainWindowShortcutQuickFocusEnabled {
  const storage = getStorage();
  if (!storage) {
    return false;
  }
  return normalizeEnabled(storage.getItem(MAIN_WINDOW_SHORTCUT_FOCUS_STORAGE_KEY));
}

export function setMainWindowShortcutQuickFocusEnabled(
  enabled: boolean,
  options: SetMainWindowShortcutQuickFocusOptions = {},
): MainWindowShortcutQuickFocusEnabled {
  const storage = getStorage();
  if (!storage) {
    return enabled;
  }

  storage.setItem(MAIN_WINDOW_SHORTCUT_FOCUS_STORAGE_KEY, enabled ? 'true' : 'false');
  if (options.emitEvent !== false) {
    window.dispatchEvent(new CustomEvent<boolean>(MAIN_WINDOW_SHORTCUT_FOCUS_CHANGED_EVENT, { detail: enabled }));
  }
  return enabled;
}

export function subscribeMainWindowShortcutQuickFocusChanges(
  listener: (enabled: MainWindowShortcutQuickFocusEnabled) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== MAIN_WINDOW_SHORTCUT_FOCUS_STORAGE_KEY) return;
    listener(normalizeEnabled(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(MAIN_WINDOW_SHORTCUT_FOCUS_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(MAIN_WINDOW_SHORTCUT_FOCUS_CHANGED_EVENT, handleCustomEvent);
  };
}
