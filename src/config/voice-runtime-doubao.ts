import { createConfigModule } from './config-factory';

const VOICE_RUNTIME_DOUBAO_APP_ID_STORAGE_KEY = 'exomind:voiceRuntimeDoubaoAppId';
const VOICE_RUNTIME_DOUBAO_ACCESS_TOKEN_STORAGE_KEY = 'exomind:voiceRuntimeDoubaoAccessToken';
const VOICE_RUNTIME_DOUBAO_SECRET_KEY_STORAGE_KEY = 'exomind:voiceRuntimeDoubaoSecretKey';
const VOICE_RUNTIME_DOUBAO_MODEL_VERSION_STORAGE_KEY = 'exomind:voiceRuntimeDoubaoModelVersion';
const VOICE_RUNTIME_DOUBAO_SPEAKER_STORAGE_KEY = 'exomind:voiceRuntimeDoubaoSpeaker';
const VOICE_RUNTIME_DOUBAO_CONNECT_ID_STORAGE_KEY = 'exomind:voiceRuntimeDoubaoConnectId';
const VOICE_RUNTIME_DOUBAO_WEBSOCKET_URL_STORAGE_KEY = 'exomind:voiceRuntimeDoubaoWebsocketUrl';

const DEFAULT_DOUBAO_MODEL_VERSION = '1.2.1.1';
const DEFAULT_DOUBAO_SPEAKER = 'zh_female_vv_jupiter_bigtts';
const DEFAULT_DOUBAO_WEBSOCKET_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';

function normalizeTrimmedString(rawValue: string | null | undefined, fallback = ''): string {
  const normalized = rawValue?.trim();
  return normalized ? normalized : fallback;
}

const voiceRuntimeDoubaoAppIdModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_DOUBAO_APP_ID_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-doubao-app-id-changed',
  defaultValue: '',
  normalize: normalizeTrimmedString,
  persistMode: 'runtime-preferred',
  runtimeWriteOptions: { sensitive: true },
});

const voiceRuntimeDoubaoAccessTokenModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_DOUBAO_ACCESS_TOKEN_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-doubao-access-token-changed',
  defaultValue: '',
  normalize: normalizeTrimmedString,
  persistMode: 'runtime-preferred',
  runtimeWriteOptions: { sensitive: true },
});

const voiceRuntimeDoubaoSecretKeyModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_DOUBAO_SECRET_KEY_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-doubao-secret-key-changed',
  defaultValue: '',
  normalize: normalizeTrimmedString,
  persistMode: 'runtime-preferred',
  runtimeWriteOptions: { sensitive: true },
});

const voiceRuntimeDoubaoModelVersionModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_DOUBAO_MODEL_VERSION_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-doubao-model-version-changed',
  defaultValue: DEFAULT_DOUBAO_MODEL_VERSION,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_DOUBAO_MODEL_VERSION),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeDoubaoSpeakerModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_DOUBAO_SPEAKER_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-doubao-speaker-changed',
  defaultValue: DEFAULT_DOUBAO_SPEAKER,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_DOUBAO_SPEAKER),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeDoubaoConnectIdModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_DOUBAO_CONNECT_ID_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-doubao-connect-id-changed',
  defaultValue: '',
  normalize: normalizeTrimmedString,
  persistMode: 'runtime-preferred',
});

const voiceRuntimeDoubaoWebsocketUrlModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_DOUBAO_WEBSOCKET_URL_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-doubao-websocket-url-changed',
  defaultValue: DEFAULT_DOUBAO_WEBSOCKET_URL,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_DOUBAO_WEBSOCKET_URL),
  persistMode: 'runtime-preferred',
});

export function getVoiceRuntimeDoubaoAppId(): string {
  return voiceRuntimeDoubaoAppIdModule.get();
}

export function setVoiceRuntimeDoubaoAppId(value: string): string {
  return voiceRuntimeDoubaoAppIdModule.set(value);
}

export function subscribeVoiceRuntimeDoubaoAppIdChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeDoubaoAppIdModule.subscribe(listener);
}

export function getVoiceRuntimeDoubaoAccessToken(): string {
  return voiceRuntimeDoubaoAccessTokenModule.get();
}

export function setVoiceRuntimeDoubaoAccessToken(value: string): string {
  return voiceRuntimeDoubaoAccessTokenModule.set(value);
}

export function subscribeVoiceRuntimeDoubaoAccessTokenChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeDoubaoAccessTokenModule.subscribe(listener);
}

export function getVoiceRuntimeDoubaoSecretKey(): string {
  return voiceRuntimeDoubaoSecretKeyModule.get();
}

export function setVoiceRuntimeDoubaoSecretKey(value: string): string {
  return voiceRuntimeDoubaoSecretKeyModule.set(value);
}

export function subscribeVoiceRuntimeDoubaoSecretKeyChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeDoubaoSecretKeyModule.subscribe(listener);
}

export function getVoiceRuntimeDoubaoModelVersion(): string {
  return voiceRuntimeDoubaoModelVersionModule.get();
}

export function setVoiceRuntimeDoubaoModelVersion(value: string): string {
  return voiceRuntimeDoubaoModelVersionModule.set(value);
}

export function subscribeVoiceRuntimeDoubaoModelVersionChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeDoubaoModelVersionModule.subscribe(listener);
}

export function getVoiceRuntimeDoubaoSpeaker(): string {
  return voiceRuntimeDoubaoSpeakerModule.get();
}

export function setVoiceRuntimeDoubaoSpeaker(value: string): string {
  return voiceRuntimeDoubaoSpeakerModule.set(value);
}

export function subscribeVoiceRuntimeDoubaoSpeakerChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeDoubaoSpeakerModule.subscribe(listener);
}

export function getVoiceRuntimeDoubaoConnectId(): string {
  return voiceRuntimeDoubaoConnectIdModule.get();
}

export function setVoiceRuntimeDoubaoConnectId(value: string): string {
  return voiceRuntimeDoubaoConnectIdModule.set(value);
}

export function subscribeVoiceRuntimeDoubaoConnectIdChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeDoubaoConnectIdModule.subscribe(listener);
}

export function getVoiceRuntimeDoubaoWebsocketUrl(): string {
  return voiceRuntimeDoubaoWebsocketUrlModule.get();
}

export function setVoiceRuntimeDoubaoWebsocketUrl(value: string): string {
  return voiceRuntimeDoubaoWebsocketUrlModule.set(value);
}

export function subscribeVoiceRuntimeDoubaoWebsocketUrlChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeDoubaoWebsocketUrlModule.subscribe(listener);
}
