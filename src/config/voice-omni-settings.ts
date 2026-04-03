import { createConfigModule } from './config-factory';

const VOICE_OMNI_PROFILE_ID_KEY = 'exomind:voiceOmniProfileId';
const VOICE_OMNI_MODEL_ID_KEY = 'exomind:voiceOmniModelId';
const VOICE_OMNI_OPTIMIZE_ENABLED_KEY = 'exomind:voiceOmniOptimizeEnabled';

function normalizeText(value: string | null | undefined): string {
  return value?.trim() || '';
}

function normalizeBoolean(value: string | null | undefined): boolean {
  return value === '1' || value === 'true';
}

const profileIdModule = createConfigModule<string>({
  storageKey: VOICE_OMNI_PROFILE_ID_KEY,
  eventName: 'exomind:voice-omni-profile-id-changed',
  defaultValue: '',
  normalize: normalizeText,
  persistMode: 'runtime-preferred',
});

const modelIdModule = createConfigModule<string>({
  storageKey: VOICE_OMNI_MODEL_ID_KEY,
  eventName: 'exomind:voice-omni-model-id-changed',
  defaultValue: 'qwen3-omni-flash',
  normalize: (raw) => normalizeText(raw) || 'qwen3-omni-flash',
  persistMode: 'runtime-preferred',
});

const optimizeEnabledModule = createConfigModule<boolean>({
  storageKey: VOICE_OMNI_OPTIMIZE_ENABLED_KEY,
  eventName: 'exomind:voice-omni-optimize-enabled-changed',
  defaultValue: false,
  normalize: normalizeBoolean,
  serialize: (value) => (value ? '1' : '0'),
  persistMode: 'runtime-preferred',
});

export function getVoiceOmniProfileId(): string {
  return profileIdModule.get();
}

export function setVoiceOmniProfileId(value: string): string {
  return profileIdModule.set(value);
}

export function subscribeVoiceOmniProfileIdChanges(listener: (value: string) => void): () => void {
  return profileIdModule.subscribe(listener);
}

export function getVoiceOmniModelId(): string {
  return modelIdModule.get();
}

export function setVoiceOmniModelId(value: string): string {
  return modelIdModule.set(value);
}

export function subscribeVoiceOmniModelIdChanges(listener: (value: string) => void): () => void {
  return modelIdModule.subscribe(listener);
}

export function getVoiceOmniOptimizeEnabled(): boolean {
  return optimizeEnabledModule.get();
}

export function setVoiceOmniOptimizeEnabled(value: boolean): boolean {
  return optimizeEnabledModule.set(value);
}

export function subscribeVoiceOmniOptimizeEnabledChanges(listener: (value: boolean) => void): () => void {
  return optimizeEnabledModule.subscribe(listener);
}
