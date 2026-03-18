import type { AIRegistrySnapshot } from './types';

const AI_REGISTRY_SNAPSHOT_KEY = 'exomind:ai-registry:snapshot';
export const AI_REGISTRY_CHANGED_EVENT = 'exomind:ai-registry:changed';

const EMPTY_AI_REGISTRY_SNAPSHOT: AIRegistrySnapshot = {
  version: 1,
  channels: [],
  models: [],
  capabilities: [],
  offerings: [],
  energySources: [],
  resolutionRules: [],
  updatedAt: '',
};

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof globalThis.localStorage === 'undefined') {
    return null;
  }

  const localStorageLike = globalThis.localStorage as Partial<Storage>;
  if (typeof localStorageLike.getItem !== 'function' || typeof localStorageLike.setItem !== 'function') {
    return null;
  }

  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

function emitRegistryChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AI_REGISTRY_CHANGED_EVENT));
}

export function getDefaultAIRegistrySnapshot(): AIRegistrySnapshot {
  return {
    ...EMPTY_AI_REGISTRY_SNAPSHOT,
    channels: [],
    models: [],
    capabilities: [],
    offerings: [],
    energySources: [],
    resolutionRules: [],
  };
}

export function getAIRegistrySnapshot(): AIRegistrySnapshot {
  const storage = getStorage();
  if (!storage) {
    return getDefaultAIRegistrySnapshot();
  }

  try {
    const raw = storage.getItem(AI_REGISTRY_SNAPSHOT_KEY);
    if (!raw) {
      return getDefaultAIRegistrySnapshot();
    }

    const parsed = JSON.parse(raw) as Partial<AIRegistrySnapshot>;
    return {
      version: 1,
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : [],
      offerings: Array.isArray(parsed.offerings) ? parsed.offerings : [],
      energySources: Array.isArray(parsed.energySources) ? parsed.energySources : [],
      resolutionRules: Array.isArray(parsed.resolutionRules) ? parsed.resolutionRules : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return getDefaultAIRegistrySnapshot();
  }
}

export function saveAIRegistrySnapshot(snapshot: AIRegistrySnapshot): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(AI_REGISTRY_SNAPSHOT_KEY, JSON.stringify(snapshot));
  emitRegistryChanged();
}

export function subscribeAIRegistryChanges(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleChange = () => listener();
  window.addEventListener(AI_REGISTRY_CHANGED_EVENT, handleChange);

  return () => {
    window.removeEventListener(AI_REGISTRY_CHANGED_EVENT, handleChange);
  };
}
