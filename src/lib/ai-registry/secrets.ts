export interface AIEnergySecretRecord {
  apiKey: string;
  updatedAt: string;
}

import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from '@/config/runtime-config-cache';

const AI_REGISTRY_CHANGED_EVENT = 'exomind:ai-registry:changed';
const AI_ENERGY_SECRET_KEY_PREFIX = 'exomind:ai-registry:energy-secret:';

function getEnergySecretStorageKey(energySourceId: string): string {
  return `${AI_ENERGY_SECRET_KEY_PREFIX}${energySourceId}`;
}

function emitRegistryChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AI_REGISTRY_CHANGED_EVENT));
}

export function getAIEnergySecret(energySourceId: string): AIEnergySecretRecord | null {
  try {
    const raw = getRuntimeConfigValueSync(getEnergySecretStorageKey(energySourceId));
    return raw ? (JSON.parse(raw) as AIEnergySecretRecord) : null;
  } catch {
    return null;
  }
}

export function saveAIEnergySecret(
  energySourceId: string,
  secret: AIEnergySecretRecord,
): void {
  setRuntimeConfigValue(getEnergySecretStorageKey(energySourceId), JSON.stringify(secret), {
    sensitive: true,
    source: AI_REGISTRY_CHANGED_EVENT,
    sourceOrigin: typeof window !== 'undefined' ? window.location?.origin : undefined,
  });
  emitRegistryChanged();
}
