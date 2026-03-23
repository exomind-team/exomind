const VOICE_SHORTCUT_MIC_PREWARM_STORAGE_KEY = 'exomind:voiceShortcutMicPrewarmEnabled';
const VOICE_SHORTCUT_MIC_PREWARM_CHANGED_EVENT = 'exomind:voice-shortcut-mic-prewarm-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  if (rawValue == null) {
    return true;
  }
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

export function getVoiceShortcutMicPrewarmEnabled(): boolean {
  const storage = getStorage();
  if (!storage) return true;
  return normalizeBoolean(storage.getItem(VOICE_SHORTCUT_MIC_PREWARM_STORAGE_KEY));
}

export function setVoiceShortcutMicPrewarmEnabled(enabled: boolean): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(VOICE_SHORTCUT_MIC_PREWARM_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent<boolean>(VOICE_SHORTCUT_MIC_PREWARM_CHANGED_EVENT, { detail: enabled }));
}

export function subscribeVoiceShortcutMicPrewarmChanges(
  listener: (enabled: boolean) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== VOICE_SHORTCUT_MIC_PREWARM_STORAGE_KEY) return;
    listener(normalizeBoolean(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<boolean>;
    listener(Boolean(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(VOICE_SHORTCUT_MIC_PREWARM_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(VOICE_SHORTCUT_MIC_PREWARM_CHANGED_EVENT, handleCustomEvent);
  };
}
