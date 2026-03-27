import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from './runtime-config-cache';

const VOICE_SHORTCUT_MIC_PREWARM_STORAGE_KEY = 'exomind:voiceShortcutMicPrewarmEnabled';
const VOICE_SHORTCUT_MIC_PREWARM_CHANGED_EVENT = 'exomind:voice-shortcut-mic-prewarm-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  if (rawValue == null) {
    return true;
  }
  return rawValue === 'true';
}

export function getVoiceShortcutMicPrewarmEnabled(): boolean {
  return normalizeBoolean(getRuntimeConfigValueSync(VOICE_SHORTCUT_MIC_PREWARM_STORAGE_KEY));
}

export function setVoiceShortcutMicPrewarmEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  setRuntimeConfigValue(VOICE_SHORTCUT_MIC_PREWARM_STORAGE_KEY, String(enabled), {
    source: VOICE_SHORTCUT_MIC_PREWARM_CHANGED_EVENT,
    sourceOrigin: window.location?.origin,
  });
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
