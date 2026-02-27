const VOICE_TRANSCRIPT_SEND_MODE_STORAGE_KEY = 'exomind:voiceTranscriptSendMode';
const VOICE_TRANSCRIPT_SEND_MODE_CHANGED_EVENT = 'exomind:voice-transcript-send-mode-changed';

export const VOICE_TRANSCRIPT_SEND_MODE_VALUES = ['insert', 'direct-send'] as const;
export type VoiceTranscriptSendMode = (typeof VOICE_TRANSCRIPT_SEND_MODE_VALUES)[number];

function normalizeMode(rawValue: string | null | undefined): VoiceTranscriptSendMode {
  if (rawValue === 'direct-send') return 'direct-send';
  return 'insert';
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

export function getVoiceTranscriptSendMode(): VoiceTranscriptSendMode {
  const storage = getStorage();
  if (!storage) return 'insert';
  return normalizeMode(storage.getItem(VOICE_TRANSCRIPT_SEND_MODE_STORAGE_KEY));
}

export function setVoiceTranscriptSendMode(mode: VoiceTranscriptSendMode): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(VOICE_TRANSCRIPT_SEND_MODE_STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent<VoiceTranscriptSendMode>(VOICE_TRANSCRIPT_SEND_MODE_CHANGED_EVENT, { detail: mode }));
}

export function subscribeVoiceTranscriptSendModeChanges(listener: (mode: VoiceTranscriptSendMode) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== VOICE_TRANSCRIPT_SEND_MODE_STORAGE_KEY) return;
    listener(normalizeMode(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<VoiceTranscriptSendMode>;
    listener(normalizeMode(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(VOICE_TRANSCRIPT_SEND_MODE_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(VOICE_TRANSCRIPT_SEND_MODE_CHANGED_EVENT, handleCustomEvent);
  };
}
