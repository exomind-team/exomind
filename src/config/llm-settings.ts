import { subscribeAIRegistryChanges } from '@/lib/ai-registry/storage';
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHANNEL_NAME,
  DEFAULT_LLM_MODEL,
  getDefaultLLMRegistryDraft,
  saveDefaultLLMRegistryDraft,
} from '@/lib/ai-registry/compat';

const LEGACY_LLM_API_KEY_STORAGE_KEY = 'exomind:llmApiKey';
const LEGACY_LLM_BASE_URL_STORAGE_KEY = 'exomind:llmBaseUrl';
const LEGACY_LLM_MODEL_STORAGE_KEY = 'exomind:llmModel';

export interface LLMSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getStorage(): Pick<Storage, 'getItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem'>;
}

function readLegacyLLMSettings(): LLMSettings {
  const storage = getStorage();
  if (!storage) {
    return {
      apiKey: '',
      baseUrl: DEFAULT_LLM_BASE_URL,
      model: DEFAULT_LLM_MODEL,
    };
  }

  return {
    apiKey: storage.getItem(LEGACY_LLM_API_KEY_STORAGE_KEY)?.trim() ?? '',
    baseUrl: storage.getItem(LEGACY_LLM_BASE_URL_STORAGE_KEY)?.trim() || DEFAULT_LLM_BASE_URL,
    model: storage.getItem(LEGACY_LLM_MODEL_STORAGE_KEY)?.trim() || DEFAULT_LLM_MODEL,
  };
}

function ensureRegistryBootstrappedFromLegacy(): void {
  const registryDraft = getDefaultLLMRegistryDraft();
  if (registryDraft.apiKey.trim()) {
    return;
  }

  const legacy = readLegacyLLMSettings();
  if (!legacy.apiKey.trim()) {
    return;
  }

  saveDefaultLLMRegistryDraft({
    channelName: DEFAULT_LLM_CHANNEL_NAME,
    baseUrl: legacy.baseUrl,
    model: legacy.model,
    apiKey: legacy.apiKey,
  });
}

function getEffectiveLLMSettings(): LLMSettings {
  ensureRegistryBootstrappedFromLegacy();
  const registryDraft = getDefaultLLMRegistryDraft();
  if (registryDraft.apiKey.trim()) {
    return {
      apiKey: registryDraft.apiKey,
      baseUrl: registryDraft.baseUrl,
      model: registryDraft.model,
    };
  }

  return readLegacyLLMSettings();
}

function updateDefaultDraft(patch: Partial<RegistryDefaultDraft>): void {
  ensureRegistryBootstrappedFromLegacy();
  const current = getDefaultLLMRegistryDraft();
  saveDefaultLLMRegistryDraft({
    channelName: patch.channelName ?? current.channelName,
    baseUrl: patch.baseUrl ?? current.baseUrl,
    model: patch.model ?? current.model,
    apiKey: patch.apiKey ?? current.apiKey,
  });
}

interface RegistryDefaultDraft {
  channelName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export function getLLMApiKey(): string {
  return getEffectiveLLMSettings().apiKey;
}

export function setLLMApiKey(apiKey: string): void {
  updateDefaultDraft({ apiKey: apiKey.trim() });
}

export function getLLMBaseUrl(): string {
  return getEffectiveLLMSettings().baseUrl;
}

export function setLLMBaseUrl(baseUrl: string): void {
  updateDefaultDraft({ baseUrl: baseUrl.trim() || DEFAULT_LLM_BASE_URL });
}

export function getLLMModel(): string {
  return getEffectiveLLMSettings().model;
}

export function setLLMModel(model: string): void {
  updateDefaultDraft({ model: model.trim() || DEFAULT_LLM_MODEL });
}

export function getLLMSettings(): LLMSettings {
  return getEffectiveLLMSettings();
}

export function isLLMConfigured(): boolean {
  return getLLMApiKey().length > 0;
}

export function subscribeLLMSettingsChanges(listener: (settings: LLMSettings) => void): () => void {
  return subscribeAIRegistryChanges(() => {
    listener(getLLMSettings());
  });
}
