const VOICE_SHORTCUT_SEND_MODE_STORAGE_KEY = 'exomind:voiceShortcutSendMode';
const VOICE_SHORTCUT_SEND_MODE_CHANGED_EVENT = 'exomind:voice-shortcut-send-mode-changed';

export const VOICE_SHORTCUT_SEND_MODE_VALUES = ['insert-only', 'auto-enter-send'] as const;
export type VoiceShortcutSendMode = (typeof VOICE_SHORTCUT_SEND_MODE_VALUES)[number];

function normalizeMode(rawValue: string | null | undefined): VoiceShortcutSendMode {
  if (rawValue === 'auto-enter-send') return 'auto-enter-send';
  return 'insert-only';
}

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

export function getVoiceShortcutSendMode(): VoiceShortcutSendMode {
  const storage = getStorage();
  if (!storage) return 'insert-only';
  return normalizeMode(storage.getItem(VOICE_SHORTCUT_SEND_MODE_STORAGE_KEY));
}

export function setVoiceShortcutSendMode(mode: VoiceShortcutSendMode): VoiceShortcutSendMode {
  const normalized = normalizeMode(mode);
  const storage = getStorage();
  if (!storage) return normalized;
  storage.setItem(VOICE_SHORTCUT_SEND_MODE_STORAGE_KEY, normalized);
  window.dispatchEvent(new CustomEvent<VoiceShortcutSendMode>(
    VOICE_SHORTCUT_SEND_MODE_CHANGED_EVENT,
    { detail: normalized },
  ));
  return normalized;
}

export function subscribeVoiceShortcutSendModeChanges(
  listener: (mode: VoiceShortcutSendMode) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== VOICE_SHORTCUT_SEND_MODE_STORAGE_KEY) return;
    listener(normalizeMode(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<VoiceShortcutSendMode>;
    listener(normalizeMode(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(VOICE_SHORTCUT_SEND_MODE_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(VOICE_SHORTCUT_SEND_MODE_CHANGED_EVENT, handleCustomEvent);
  };
}
