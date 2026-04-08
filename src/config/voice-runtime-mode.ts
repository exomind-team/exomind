import { createConfigModule } from './config-factory';

export const VOICE_RUNTIME_MODE_VALUES = ['off', 'push-to-talk', 'ambient'] as const;

export type VoiceRuntimeMode = (typeof VOICE_RUNTIME_MODE_VALUES)[number];

const VOICE_RUNTIME_MODE_STORAGE_KEY = 'exomind:voiceRuntimeMode';
const VOICE_RUNTIME_MODE_EVENT_NAME = 'exomind:voice-runtime-mode-changed';

function normalizeVoiceRuntimeMode(
  value: string | null | undefined,
): VoiceRuntimeMode {
  return VOICE_RUNTIME_MODE_VALUES.includes(value as VoiceRuntimeMode)
    ? (value as VoiceRuntimeMode)
    : 'off';
}

const voiceRuntimeModeModule = createConfigModule<VoiceRuntimeMode>({
  storageKey: VOICE_RUNTIME_MODE_STORAGE_KEY,
  eventName: VOICE_RUNTIME_MODE_EVENT_NAME,
  defaultValue: 'off',
  normalize: normalizeVoiceRuntimeMode,
  persistMode: 'runtime-preferred',
});

export function getVoiceRuntimeMode(): VoiceRuntimeMode {
  return voiceRuntimeModeModule.get();
}

export function setVoiceRuntimeMode(value: VoiceRuntimeMode): VoiceRuntimeMode {
  return voiceRuntimeModeModule.set(value);
}

export function subscribeVoiceRuntimeModeChanges(
  listener: (value: VoiceRuntimeMode) => void,
): () => void {
  return voiceRuntimeModeModule.subscribe(listener);
}
