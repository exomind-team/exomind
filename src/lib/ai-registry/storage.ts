import type { AIRegistrySnapshot } from './types';
import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from '@/config/runtime-config-cache';

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
  try {
    const raw = getRuntimeConfigValueSync(AI_REGISTRY_SNAPSHOT_KEY);
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
  setRuntimeConfigValue(AI_REGISTRY_SNAPSHOT_KEY, JSON.stringify(snapshot), {
    source: AI_REGISTRY_CHANGED_EVENT,
    sourceOrigin: typeof window !== 'undefined' ? window.location?.origin : undefined,
  });
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
