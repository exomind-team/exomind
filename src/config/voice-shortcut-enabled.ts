import { createConfigModule } from './config-factory';

const VOICE_SHORTCUT_ENABLED_STORAGE_KEY = 'exomind:voiceShortcutEnabled';
const VOICE_SHORTCUT_ENABLED_EVENT_NAME = 'exomind:voice-shortcut-enabled-changed';

function normalizeBoolean(value: string | null | undefined): boolean {
  if (value == null) {
    return true;
  }
  return value === '1' || value.toLowerCase() === 'true';
}

const voiceShortcutEnabledModule = createConfigModule<boolean>({
  storageKey: VOICE_SHORTCUT_ENABLED_STORAGE_KEY,
  eventName: VOICE_SHORTCUT_ENABLED_EVENT_NAME,
  defaultValue: true,
  normalize: normalizeBoolean,
  serialize: (value) => (value ? '1' : '0'),
  persistMode: 'runtime-preferred',
});

export function getVoiceShortcutEnabled(): boolean {
  return voiceShortcutEnabledModule.get();
}

export function setVoiceShortcutEnabled(value: boolean): boolean {
  return voiceShortcutEnabledModule.set(value);
}

export function subscribeVoiceShortcutEnabledChanges(
  listener: (value: boolean) => void,
): () => void {
  return voiceShortcutEnabledModule.subscribe(listener);
}
