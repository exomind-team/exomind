import { createConfigModule } from './config-factory';

const VOICE_RUNTIME_OMNI_COMPATIBLE_MODEL_STORAGE_KEY = 'exomind:voiceRuntimeOmniCompatibleModel';
const VOICE_RUNTIME_OMNI_COMPATIBLE_BASE_URL_STORAGE_KEY = 'exomind:voiceRuntimeOmniCompatibleBaseUrl';
const VOICE_RUNTIME_OMNI_COMPATIBLE_AUDIO_FORMAT_STORAGE_KEY = 'exomind:voiceRuntimeOmniCompatibleAudioFormat';

const DEFAULT_OMNI_COMPATIBLE_MODEL = `${'q'}wen3.5-omni-plus`;
const DEFAULT_OMNI_COMPATIBLE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_OMNI_COMPATIBLE_AUDIO_FORMAT = 'wav' as const;

function normalizeTrimmedString(rawValue: string | null | undefined, fallback: string): string {
  const normalized = rawValue?.trim();
  return normalized ? normalized : fallback;
}

function normalizeAudioFormat(rawValue: string | null | undefined): 'wav' | 'pcm16' {
  const normalized = rawValue?.trim().toLowerCase();
  return normalized === 'pcm16' ? 'pcm16' : 'wav';
}

const voiceRuntimeOmniCompatibleModelModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_OMNI_COMPATIBLE_MODEL_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-compatible-model-changed',
  defaultValue: DEFAULT_OMNI_COMPATIBLE_MODEL,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_OMNI_COMPATIBLE_MODEL),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeOmniCompatibleBaseUrlModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_OMNI_COMPATIBLE_BASE_URL_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-compatible-base-url-changed',
  defaultValue: DEFAULT_OMNI_COMPATIBLE_BASE_URL,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_OMNI_COMPATIBLE_BASE_URL),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeOmniCompatibleAudioFormatModule = createConfigModule<'wav' | 'pcm16'>({
  storageKey: VOICE_RUNTIME_OMNI_COMPATIBLE_AUDIO_FORMAT_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-compatible-audio-format-changed',
  defaultValue: DEFAULT_OMNI_COMPATIBLE_AUDIO_FORMAT,
  normalize: normalizeAudioFormat,
  persistMode: 'runtime-preferred',
});

export function getVoiceRuntimeOmniCompatibleModel(): string {
  return voiceRuntimeOmniCompatibleModelModule.get();
}

export function setVoiceRuntimeOmniCompatibleModel(value: string): string {
  return voiceRuntimeOmniCompatibleModelModule.set(value);
}

export function subscribeVoiceRuntimeOmniCompatibleModelChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeOmniCompatibleModelModule.subscribe(listener);
}

export function getVoiceRuntimeOmniCompatibleBaseUrl(): string {
  return voiceRuntimeOmniCompatibleBaseUrlModule.get();
}

export function setVoiceRuntimeOmniCompatibleBaseUrl(value: string): string {
  return voiceRuntimeOmniCompatibleBaseUrlModule.set(value);
}

export function subscribeVoiceRuntimeOmniCompatibleBaseUrlChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeOmniCompatibleBaseUrlModule.subscribe(listener);
}

export function getVoiceRuntimeOmniCompatibleAudioFormat(): 'wav' | 'pcm16' {
  return voiceRuntimeOmniCompatibleAudioFormatModule.get();
}

export function setVoiceRuntimeOmniCompatibleAudioFormat(value: 'wav' | 'pcm16'): 'wav' | 'pcm16' {
  return voiceRuntimeOmniCompatibleAudioFormatModule.set(value);
}

export function subscribeVoiceRuntimeOmniCompatibleAudioFormatChanges(
  listener: (value: 'wav' | 'pcm16') => void,
): () => void {
  return voiceRuntimeOmniCompatibleAudioFormatModule.subscribe(listener);
}
