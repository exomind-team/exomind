import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from './runtime-config-cache';

const MAIN_WINDOW_SHORTCUT_FOCUS_STORAGE_KEY = 'exomind:mainWindowShortcutQuickFocusEnabled';
const MAIN_WINDOW_SHORTCUT_FOCUS_CHANGED_EVENT = 'exomind:main-window-shortcut-quick-focus-changed';

export type MainWindowShortcutQuickFocusEnabled = boolean;

type SetMainWindowShortcutQuickFocusOptions = {
  emitEvent?: boolean;
};

function normalizeEnabled(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

export function getMainWindowShortcutQuickFocusEnabled(): MainWindowShortcutQuickFocusEnabled {
  return normalizeEnabled(getRuntimeConfigValueSync(MAIN_WINDOW_SHORTCUT_FOCUS_STORAGE_KEY));
}

export function setMainWindowShortcutQuickFocusEnabled(
  enabled: boolean,
  options: SetMainWindowShortcutQuickFocusOptions = {},
): MainWindowShortcutQuickFocusEnabled {
  if (typeof window === 'undefined') {
    return enabled;
  }

  setRuntimeConfigValue(MAIN_WINDOW_SHORTCUT_FOCUS_STORAGE_KEY, enabled ? 'true' : 'false', {
    source: MAIN_WINDOW_SHORTCUT_FOCUS_CHANGED_EVENT,
    sourceOrigin: window.location?.origin,
  });
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
