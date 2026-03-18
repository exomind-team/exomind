export interface AIEnergySecretRecord {
  apiKey: string;
  updatedAt: string;
}

const AI_REGISTRY_CHANGED_EVENT = 'exomind:ai-registry:changed';
const AI_ENERGY_SECRET_KEY_PREFIX = 'exomind:ai-registry:energy-secret:';

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
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(getEnergySecretStorageKey(energySourceId));
    return raw ? (JSON.parse(raw) as AIEnergySecretRecord) : null;
  } catch {
    return null;
  }
}

export function saveAIEnergySecret(
  energySourceId: string,
  secret: AIEnergySecretRecord,
): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(getEnergySecretStorageKey(energySourceId), JSON.stringify(secret));
  emitRegistryChanged();
}
