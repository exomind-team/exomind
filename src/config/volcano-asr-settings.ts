import { createConfigModule } from './config-factory';
import {
  DEFAULT_VOLCANO_ASR_OPTIONS,
  DEFAULT_VOLCANO_RESOURCE_ID,
  VOLCANO_ENDPOINT_OPTIONS,
  VOLCANO_LANGUAGE_OPTIONS,
  VOLCANO_STORAGE_KEYS,
  findVolcanoResourcePreset,
  type VolcanoEndpoint,
} from '@/lib/asr/volcano-config';

const envMap = import.meta.env as Record<string, string | undefined>;

function normalizeTrimmedString(rawValue: string | null | undefined, fallback = ''): string {
  const normalized = rawValue?.trim();
  return normalized ? normalized : fallback;
}

function normalizeVolcanoEndpoint(rawValue: string | null | undefined): VolcanoEndpoint {
  const normalized = rawValue?.trim();
  return VOLCANO_ENDPOINT_OPTIONS.some((item) => item.value === normalized)
    ? (normalized as VolcanoEndpoint)
    : DEFAULT_VOLCANO_ASR_OPTIONS.endpoint;
}

function normalizeVolcanoResourceId(rawValue: string | null | undefined): string {
  const normalized = rawValue?.trim();
  return normalized ? (findVolcanoResourcePreset(normalized) || DEFAULT_VOLCANO_RESOURCE_ID) : DEFAULT_VOLCANO_RESOURCE_ID;
}

function normalizeVolcanoLanguage(rawValue: string | null | undefined): string {
  const normalized = rawValue?.trim();
  if (normalized && VOLCANO_LANGUAGE_OPTIONS.some((item) => item.value === normalized)) {
    return normalized;
  }
  return 'zh-CN';
}

const volcanoAppKeyModule = createConfigModule<string>({
  storageKey: VOLCANO_STORAGE_KEYS.appKey,
  eventName: 'exomind:volcano-asr-app-key-changed',
  defaultValue: envMap.VITE_VOLCANO_APP_KEY || '',
  normalize: (rawValue) => normalizeTrimmedString(rawValue, envMap.VITE_VOLCANO_APP_KEY || ''),
  persistMode: 'runtime-preferred',
});

const volcanoAccessKeyModule = createConfigModule<string>({
  storageKey: VOLCANO_STORAGE_KEYS.accessKey,
  eventName: 'exomind:volcano-asr-access-key-changed',
  defaultValue: envMap.VITE_VOLCANO_ACCESS_KEY || '',
  normalize: (rawValue) => normalizeTrimmedString(rawValue, envMap.VITE_VOLCANO_ACCESS_KEY || ''),
  persistMode: 'runtime-preferred',
});

const volcanoResourceIdModule = createConfigModule<string>({
  storageKey: VOLCANO_STORAGE_KEYS.resourceId,
  eventName: 'exomind:volcano-asr-resource-id-changed',
  defaultValue: envMap.VITE_VOLCANO_RESOURCE_ID || DEFAULT_VOLCANO_RESOURCE_ID,
  normalize: (rawValue) => normalizeVolcanoResourceId(rawValue ?? envMap.VITE_VOLCANO_RESOURCE_ID),
  persistMode: 'runtime-preferred',
});

const volcanoEndpointModule = createConfigModule<VolcanoEndpoint>({
  storageKey: VOLCANO_STORAGE_KEYS.endpoint,
  eventName: 'exomind:volcano-asr-endpoint-changed',
  defaultValue: DEFAULT_VOLCANO_ASR_OPTIONS.endpoint,
  normalize: normalizeVolcanoEndpoint,
  persistMode: 'runtime-preferred',
});

const volcanoLanguageModule = createConfigModule<string>({
  storageKey: VOLCANO_STORAGE_KEYS.language,
  eventName: 'exomind:volcano-asr-language-changed',
  defaultValue: 'zh-CN',
  normalize: normalizeVolcanoLanguage,
  persistMode: 'runtime-preferred',
});

export function getVolcanoAppKey(): string {
  return volcanoAppKeyModule.get();
}

export function setVolcanoAppKey(value: string): string {
  return volcanoAppKeyModule.set(value);
}

export function subscribeVolcanoAppKeyChanges(listener: (value: string) => void): () => void {
  return volcanoAppKeyModule.subscribe(listener);
}

export function getVolcanoAccessKey(): string {
  return volcanoAccessKeyModule.get();
}

export function setVolcanoAccessKey(value: string): string {
  return volcanoAccessKeyModule.set(value);
}

export function subscribeVolcanoAccessKeyChanges(listener: (value: string) => void): () => void {
  return volcanoAccessKeyModule.subscribe(listener);
}

export function getVolcanoResourceIdSetting(): string {
  return volcanoResourceIdModule.get();
}

export function setVolcanoResourceIdSetting(value: string): string {
  return volcanoResourceIdModule.set(value);
}

export function subscribeVolcanoResourceIdChanges(listener: (value: string) => void): () => void {
  return volcanoResourceIdModule.subscribe(listener);
}

export function getVolcanoEndpointSetting(): VolcanoEndpoint {
  return volcanoEndpointModule.get();
}

export function setVolcanoEndpointSetting(value: VolcanoEndpoint): VolcanoEndpoint {
  return volcanoEndpointModule.set(value);
}

export function subscribeVolcanoEndpointChanges(listener: (value: VolcanoEndpoint) => void): () => void {
  return volcanoEndpointModule.subscribe(listener);
}

export function getVolcanoLanguageSetting(): string {
  return volcanoLanguageModule.get();
}

export function setVolcanoLanguageSetting(value: string): string {
  return volcanoLanguageModule.set(value);
}

export function subscribeVolcanoLanguageChanges(listener: (value: string) => void): () => void {
  return volcanoLanguageModule.subscribe(listener);
}
