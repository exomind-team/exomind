import { createConfigModule } from './config-factory';

const VOICE_RUNTIME_OMNI_API_KEY_STORAGE_KEY = 'exomind:voiceRuntimeOmniApiKey';
const VOICE_RUNTIME_OMNI_MODEL_STORAGE_KEY = 'exomind:voiceRuntimeOmniModel';
const VOICE_RUNTIME_OMNI_VOICE_STORAGE_KEY = 'exomind:voiceRuntimeOmniVoice';
const VOICE_RUNTIME_OMNI_INSTRUCTIONS_STORAGE_KEY = 'exomind:voiceRuntimeOmniInstructions';
const VOICE_RUNTIME_OMNI_WEBSOCKET_URL_STORAGE_KEY = 'exomind:voiceRuntimeOmniWebsocketUrl';
const VOICE_RUNTIME_OMNI_SEARCH_ENABLED_STORAGE_KEY = 'exomind:voiceRuntimeOmniSearchEnabled';
const VOICE_RUNTIME_OMNI_FUNCTION_CALLING_ENABLED_STORAGE_KEY = 'exomind:voiceRuntimeOmniFunctionCallingEnabled';
const VOICE_RUNTIME_OMNI_TOOL_CHOICE_STORAGE_KEY = 'exomind:voiceRuntimeOmniToolChoice';
const VOICE_RUNTIME_OMNI_TOOLS_JSON_STORAGE_KEY = 'exomind:voiceRuntimeOmniToolsJson';

const DEFAULT_OMNI_MODEL = `${'q'}wen3.5-omni-plus-realtime`;
const DEFAULT_OMNI_VOICE = 'Ethan';
const DEFAULT_OMNI_WEBSOCKET_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
const DEFAULT_OMNI_INSTRUCTIONS =
  '你是 ExoMind 的实时语音助手，请准确、简洁地回答用户问题。';
const DEFAULT_OMNI_SEARCH_ENABLED = true;
const DEFAULT_OMNI_FUNCTION_CALLING_ENABLED = false;
const DEFAULT_OMNI_TOOL_CHOICE = 'auto';
const DEFAULT_OMNI_TOOLS_JSON = JSON.stringify(
  [
    {
      type: 'function',
      name: 'get_weather',
      description: 'Get weather by city（按城市获取天气）',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'City name（城市名）',
          },
        },
        required: ['city'],
      },
    },
  ],
  null,
  2,
);

function normalizeTrimmedString(rawValue: string | null | undefined, fallback = ''): string {
  const normalized = rawValue?.trim();
  return normalized ? normalized : fallback;
}

function normalizeBoolean(rawValue: string | null | undefined, fallback: boolean): boolean {
  if (rawValue == null) {
    return fallback;
  }
  return rawValue === '1' || rawValue.toLowerCase() === 'true';
}

const voiceRuntimeOmniApiKeyModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_OMNI_API_KEY_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-api-key-changed',
  defaultValue: '',
  normalize: normalizeTrimmedString,
  persistMode: 'runtime-preferred',
  runtimeWriteOptions: { sensitive: true },
});

const voiceRuntimeOmniModelModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_OMNI_MODEL_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-model-changed',
  defaultValue: DEFAULT_OMNI_MODEL,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_OMNI_MODEL),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeOmniVoiceModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_OMNI_VOICE_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-voice-changed',
  defaultValue: DEFAULT_OMNI_VOICE,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_OMNI_VOICE),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeOmniInstructionsModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_OMNI_INSTRUCTIONS_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-instructions-changed',
  defaultValue: DEFAULT_OMNI_INSTRUCTIONS,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_OMNI_INSTRUCTIONS),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeOmniWebsocketUrlModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_OMNI_WEBSOCKET_URL_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-websocket-url-changed',
  defaultValue: DEFAULT_OMNI_WEBSOCKET_URL,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_OMNI_WEBSOCKET_URL),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeOmniSearchEnabledModule = createConfigModule<boolean>({
  storageKey: VOICE_RUNTIME_OMNI_SEARCH_ENABLED_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-search-enabled-changed',
  defaultValue: DEFAULT_OMNI_SEARCH_ENABLED,
  normalize: (rawValue) => normalizeBoolean(rawValue, DEFAULT_OMNI_SEARCH_ENABLED),
  serialize: (value) => (value ? '1' : '0'),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeOmniFunctionCallingEnabledModule = createConfigModule<boolean>({
  storageKey: VOICE_RUNTIME_OMNI_FUNCTION_CALLING_ENABLED_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-function-calling-enabled-changed',
  defaultValue: DEFAULT_OMNI_FUNCTION_CALLING_ENABLED,
  normalize: (rawValue) => normalizeBoolean(rawValue, DEFAULT_OMNI_FUNCTION_CALLING_ENABLED),
  serialize: (value) => (value ? '1' : '0'),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeOmniToolChoiceModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_OMNI_TOOL_CHOICE_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-tool-choice-changed',
  defaultValue: DEFAULT_OMNI_TOOL_CHOICE,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_OMNI_TOOL_CHOICE),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeOmniToolsJsonModule = createConfigModule<string>({
  storageKey: VOICE_RUNTIME_OMNI_TOOLS_JSON_STORAGE_KEY,
  eventName: 'exomind:voice-runtime-omni-tools-json-changed',
  defaultValue: DEFAULT_OMNI_TOOLS_JSON,
  normalize: (rawValue) => normalizeTrimmedString(rawValue, DEFAULT_OMNI_TOOLS_JSON),
  persistMode: 'runtime-preferred',
});

export function getVoiceRuntimeOmniApiKey(): string {
  return voiceRuntimeOmniApiKeyModule.get();
}

export function setVoiceRuntimeOmniApiKey(value: string): string {
  return voiceRuntimeOmniApiKeyModule.set(value);
}

export function subscribeVoiceRuntimeOmniApiKeyChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeOmniApiKeyModule.subscribe(listener);
}

export function getVoiceRuntimeOmniModel(): string {
  return voiceRuntimeOmniModelModule.get();
}

export function setVoiceRuntimeOmniModel(value: string): string {
  return voiceRuntimeOmniModelModule.set(value);
}

export function subscribeVoiceRuntimeOmniModelChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeOmniModelModule.subscribe(listener);
}

export function getVoiceRuntimeOmniVoice(): string {
  return voiceRuntimeOmniVoiceModule.get();
}

export function setVoiceRuntimeOmniVoice(value: string): string {
  return voiceRuntimeOmniVoiceModule.set(value);
}

export function subscribeVoiceRuntimeOmniVoiceChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeOmniVoiceModule.subscribe(listener);
}

export function getVoiceRuntimeOmniInstructions(): string {
  return voiceRuntimeOmniInstructionsModule.get();
}

export function setVoiceRuntimeOmniInstructions(value: string): string {
  return voiceRuntimeOmniInstructionsModule.set(value);
}

export function subscribeVoiceRuntimeOmniInstructionsChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeOmniInstructionsModule.subscribe(listener);
}

export function getVoiceRuntimeOmniWebsocketUrl(): string {
  return voiceRuntimeOmniWebsocketUrlModule.get();
}

export function setVoiceRuntimeOmniWebsocketUrl(value: string): string {
  return voiceRuntimeOmniWebsocketUrlModule.set(value);
}

export function subscribeVoiceRuntimeOmniWebsocketUrlChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeOmniWebsocketUrlModule.subscribe(listener);
}

export function getVoiceRuntimeOmniSearchEnabled(): boolean {
  return voiceRuntimeOmniSearchEnabledModule.get();
}

export function setVoiceRuntimeOmniSearchEnabled(value: boolean): boolean {
  return voiceRuntimeOmniSearchEnabledModule.set(value);
}

export function subscribeVoiceRuntimeOmniSearchEnabledChanges(
  listener: (value: boolean) => void,
): () => void {
  return voiceRuntimeOmniSearchEnabledModule.subscribe(listener);
}

export function getVoiceRuntimeOmniFunctionCallingEnabled(): boolean {
  return voiceRuntimeOmniFunctionCallingEnabledModule.get();
}

export function setVoiceRuntimeOmniFunctionCallingEnabled(value: boolean): boolean {
  return voiceRuntimeOmniFunctionCallingEnabledModule.set(value);
}

export function subscribeVoiceRuntimeOmniFunctionCallingEnabledChanges(
  listener: (value: boolean) => void,
): () => void {
  return voiceRuntimeOmniFunctionCallingEnabledModule.subscribe(listener);
}

export function getVoiceRuntimeOmniToolChoice(): string {
  return voiceRuntimeOmniToolChoiceModule.get();
}

export function setVoiceRuntimeOmniToolChoice(value: string): string {
  return voiceRuntimeOmniToolChoiceModule.set(value);
}

export function subscribeVoiceRuntimeOmniToolChoiceChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeOmniToolChoiceModule.subscribe(listener);
}

export function getVoiceRuntimeOmniToolsJson(): string {
  return voiceRuntimeOmniToolsJsonModule.get();
}

export function setVoiceRuntimeOmniToolsJson(value: string): string {
  return voiceRuntimeOmniToolsJsonModule.set(value);
}

export function subscribeVoiceRuntimeOmniToolsJsonChanges(
  listener: (value: string) => void,
): () => void {
  return voiceRuntimeOmniToolsJsonModule.subscribe(listener);
}
