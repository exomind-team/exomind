const LLM_API_KEY_STORAGE_KEY = 'exomind:llmApiKey';
const LLM_BASE_URL_STORAGE_KEY = 'exomind:llmBaseUrl';
const LLM_MODEL_STORAGE_KEY = 'exomind:llmModel';
const LLM_SETTINGS_CHANGED_EVENT = 'exomind:llm-settings-changed';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';

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

export function getLLMApiKey(): string {
  const storage = getStorage();
  if (!storage) return '';
  return storage.getItem(LLM_API_KEY_STORAGE_KEY) ?? '';
}

export function setLLMApiKey(apiKey: string): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(LLM_API_KEY_STORAGE_KEY, apiKey.trim());
  emitChanged();
}

export function getLLMBaseUrl(): string {
  const storage = getStorage();
  if (!storage) return DEFAULT_BASE_URL;
  return storage.getItem(LLM_BASE_URL_STORAGE_KEY) || DEFAULT_BASE_URL;
}

export function setLLMBaseUrl(baseUrl: string): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(LLM_BASE_URL_STORAGE_KEY, baseUrl.trim());
  emitChanged();
}

export function getLLMModel(): string {
  const storage = getStorage();
  if (!storage) return DEFAULT_MODEL;
  return storage.getItem(LLM_MODEL_STORAGE_KEY) || DEFAULT_MODEL;
}

export function setLLMModel(model: string): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(LLM_MODEL_STORAGE_KEY, model.trim());
  emitChanged();
}

export function getLLMSettings(): LLMSettings {
  return {
    apiKey: getLLMApiKey(),
    baseUrl: getLLMBaseUrl(),
    model: getLLMModel(),
  };
}

export function isLLMConfigured(): boolean {
  return getLLMApiKey().length > 0;
}

function emitChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<LLMSettings>(LLM_SETTINGS_CHANGED_EVENT, {
      detail: getLLMSettings(),
    }),
  );
}

export function subscribeLLMSettingsChanges(listener: (settings: LLMSettings) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== LLM_API_KEY_STORAGE_KEY
      && event.key !== LLM_BASE_URL_STORAGE_KEY
      && event.key !== LLM_MODEL_STORAGE_KEY
    ) {
      return;
    }
    listener(getLLMSettings());
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<LLMSettings>;
    if (customEvent.detail) {
      listener(customEvent.detail);
      return;
    }
    listener(getLLMSettings());
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(LLM_SETTINGS_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(LLM_SETTINGS_CHANGED_EVENT, handleCustomEvent);
  };
}
