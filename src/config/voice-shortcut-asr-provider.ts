const VOICE_SHORTCUT_ASR_PROVIDER_STORAGE_KEY = 'exomind:voiceShortcutAsrProvider';
const VOICE_SHORTCUT_ASR_PROVIDER_CHANGED_EVENT = 'exomind:voice-shortcut-asr-provider-changed';

export const VOICE_SHORTCUT_ASR_PROVIDER_VALUES = ['moss', 'volcano'] as const;
export type VoiceShortcutAsrProvider = (typeof VOICE_SHORTCUT_ASR_PROVIDER_VALUES)[number];

function normalizeProvider(rawValue: string | null | undefined): VoiceShortcutAsrProvider {
  return rawValue === 'volcano' ? 'volcano' : 'moss';
}

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

export function getVoiceShortcutAsrProvider(): VoiceShortcutAsrProvider {
  const storage = getStorage();
  if (!storage) return 'moss';
  return normalizeProvider(storage.getItem(VOICE_SHORTCUT_ASR_PROVIDER_STORAGE_KEY));
}

export function setVoiceShortcutAsrProvider(provider: VoiceShortcutAsrProvider): VoiceShortcutAsrProvider {
  const normalized = normalizeProvider(provider);
  const storage = getStorage();
  if (!storage) return normalized;
  storage.setItem(VOICE_SHORTCUT_ASR_PROVIDER_STORAGE_KEY, normalized);
  window.dispatchEvent(new CustomEvent<VoiceShortcutAsrProvider>(
    VOICE_SHORTCUT_ASR_PROVIDER_CHANGED_EVENT,
    { detail: normalized }
  ));
  return normalized;
}

export function subscribeVoiceShortcutAsrProviderChanges(
  listener: (provider: VoiceShortcutAsrProvider) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== VOICE_SHORTCUT_ASR_PROVIDER_STORAGE_KEY) return;
    listener(normalizeProvider(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<VoiceShortcutAsrProvider>;
    listener(normalizeProvider(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(VOICE_SHORTCUT_ASR_PROVIDER_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(VOICE_SHORTCUT_ASR_PROVIDER_CHANGED_EVENT, handleCustomEvent);
  };
}

export function getVoiceShortcutAsrProviderLabel(provider: VoiceShortcutAsrProvider): string {
  return provider === 'volcano' ? '火山' : 'MOSS';
}
