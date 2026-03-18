import type {
  CreateProviderProfileInput,
  ProviderProfileMeta,
  ProviderProfileSecret,
  ProviderProfileSnapshot,
  UpdateProviderProfileInput,
} from './types';
import {
  buildRegistryProfileIdFromSourceKey,
  createRegistryProviderProfile,
  getRegistryProviderProfileMeta,
  getRegistryProviderProfileSecret,
  importRegistryProviderProfile,
  listRegistryProviderProfiles,
  markRegistryProviderProfileUsed,
  resolveRegistryProviderProfile,
  updateRegistryProviderProfile,
} from '@/lib/ai-registry/compat';

const LEGACY_PROVIDER_PROFILE_INDEX_KEY = 'exomind:agent-provider-profiles:index';

function getLegacyProviderProfileMetaKey(profileId: string): string {
  return `exomind:agent-provider-profiles:${profileId}:meta`;
}

function getLegacyProviderProfileSecretKey(profileId: string): string {
  return `exomind:agent-provider-profiles:${profileId}:secret`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function getLegacyProviderProfiles(): ProviderProfileSnapshot[] {
  const profileIds = readJson<string[]>(LEGACY_PROVIDER_PROFILE_INDEX_KEY, []);
  const profiles: ProviderProfileSnapshot[] = [];

  for (const profileId of profileIds) {
    const meta = readJson<ProviderProfileMeta | null>(getLegacyProviderProfileMetaKey(profileId), null);
    const secret = readJson<ProviderProfileSecret | null>(getLegacyProviderProfileSecretKey(profileId), null);
    if (!meta || !secret?.apiKey) {
      continue;
    }

    profiles.push({
      ...meta,
      apiKey: secret.apiKey,
    });
  }

  return profiles;
}

function ensureRegistryImportedFromLegacyStorage(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  for (const profile of getLegacyProviderProfiles()) {
    const registryProfileId = buildRegistryProfileIdFromSourceKey(profile.profileId);
    if (resolveRegistryProviderProfile(registryProfileId)) {
      continue;
    }
    importRegistryProviderProfile(profile);
  }
}

export function listProviderProfiles(): ProviderProfileMeta[] {
  ensureRegistryImportedFromLegacyStorage();
  return listRegistryProviderProfiles();
}

export function getProviderProfileMeta(profileId: string): ProviderProfileMeta | null {
  ensureRegistryImportedFromLegacyStorage();
  return getRegistryProviderProfileMeta(profileId);
}

export function getProviderProfileSecret(profileId: string): ProviderProfileSecret | null {
  ensureRegistryImportedFromLegacyStorage();
  return getRegistryProviderProfileSecret(profileId);
}

export function resolveProviderProfile(profileId: string): ProviderProfileSnapshot | null {
  ensureRegistryImportedFromLegacyStorage();
  return resolveRegistryProviderProfile(profileId);
}

export function createProviderProfile(input: CreateProviderProfileInput): ProviderProfileMeta {
  ensureRegistryImportedFromLegacyStorage();
  return createRegistryProviderProfile(input);
}

export function updateProviderProfile(
  profileId: string,
  input: UpdateProviderProfileInput,
): ProviderProfileMeta | null {
  ensureRegistryImportedFromLegacyStorage();
  return updateRegistryProviderProfile(profileId, input);
}

export function markProviderProfileUsed(profileId: string): ProviderProfileMeta | null {
  ensureRegistryImportedFromLegacyStorage();
  return markRegistryProviderProfileUsed(profileId);
}
