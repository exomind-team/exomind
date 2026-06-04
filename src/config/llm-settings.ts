import { resolveOfferingForCapability } from '@/lib/ai-registry/resolution';
import { getAIRegistrySnapshot, subscribeAIRegistryChanges } from '@/lib/ai-registry/storage';
import { inferVendorFromBaseUrl } from '@/lib/ai-registry/vendor';
import {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_CHANNEL_NAME,
  DEFAULT_LLM_MODEL,
  getDefaultLLMRegistryDraft,
  saveDefaultLLMRegistryDraft,
} from '@/lib/ai-registry/compat';
import { setRuntimeConfigValue } from './runtime-config-cache';

const LEGACY_LLM_API_KEY_STORAGE_KEY = 'exomind:llmApiKey';
const LEGACY_LLM_BASE_URL_STORAGE_KEY = 'exomind:llmBaseUrl';
const LEGACY_LLM_MODEL_STORAGE_KEY = 'exomind:llmModel';
const LEGACY_LLM_BOOTSTRAP_COMPLETED_STORAGE_KEY = 'exomind:ai-registry:legacy-llm-bootstrap-completed';

export interface LLMSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
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

function hasResolvedRegistryLLMSettings(): boolean {
  return Boolean(resolveOfferingForCapability(getAIRegistrySnapshot(), 'llm.chat'));
}

function isLegacyLLMBootstrapCompleted(): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }
  return storage.getItem(LEGACY_LLM_BOOTSTRAP_COMPLETED_STORAGE_KEY) === 'true';
}

function markLegacyLLMBootstrapCompleted(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.setItem(LEGACY_LLM_BOOTSTRAP_COMPLETED_STORAGE_KEY, 'true');
}

function ensureRegistryBootstrappedFromLegacy(): void {
  if (hasResolvedRegistryLLMSettings()) {
    markLegacyLLMBootstrapCompleted();
    return;
  }

  if (isLegacyLLMBootstrapCompleted()) {
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
  markLegacyLLMBootstrapCompleted();
}

function getEffectiveLLMSettings(): LLMSettings {
  ensureRegistryBootstrappedFromLegacy();
  const registryDraft = getDefaultLLMRegistryDraft();
  if (hasResolvedRegistryLLMSettings()) {
    return {
      apiKey: registryDraft.apiKey,
      baseUrl: registryDraft.baseUrl,
      model: registryDraft.model,
    };
  }

  if (isLegacyLLMBootstrapCompleted()) {
    return {
      apiKey: '',
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

/**
 * Bridge: sync the resolved AI Registry LLM settings to the 4 flat config keys
 * that Runtime built-in agents read via `resolve_provider_profile_from_runtime()`.
 *
 * Called after every AI Registry write (save / set-default / delete) and during bootstrap.
 */
export function syncLLMSettingsToRuntimeFlatKeys(): void {
  const settings = getLLMSettings();
  const vendor = inferVendorFromBaseUrl(settings.baseUrl);

  setRuntimeConfigValue('exomind:agentApiProvider', vendor);
  setRuntimeConfigValue('exomind:agentApiModel', settings.model);
  setRuntimeConfigValue('exomind:agentApiBaseUrl', settings.baseUrl);
  setRuntimeConfigValue('exomind:agentApiApiKey', settings.apiKey, { sensitive: true });
}
