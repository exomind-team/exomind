import { createUuidV4 } from '@/lib/utils/uuid';
import type {
  CreateProviderProfileInput,
  ProviderProfileMeta,
  ProviderProfileSecret,
  ProviderProfileSnapshot,
  UpdateProviderProfileInput,
} from './types';

const PROVIDER_PROFILE_INDEX_KEY = 'exomind:agent-provider-profiles:index';

function getProviderProfileMetaKey(profileId: string): string {
  return `exomind:agent-provider-profiles:${profileId}:meta`;
}

function getProviderProfileSecretKey(profileId: string): string {
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

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function getProfileIndex(): string[] {
  return readJson<string[]>(PROVIDER_PROFILE_INDEX_KEY, []);
}

function setProfileIndex(profileIds: string[]): void {
  writeJson(PROVIDER_PROFILE_INDEX_KEY, profileIds);
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

export function listProviderProfiles(): ProviderProfileMeta[] {
  return getProfileIndex()
    .map((profileId) => getProviderProfileMeta(profileId))
    .filter((profile): profile is ProviderProfileMeta => Boolean(profile));
}

export function getProviderProfileMeta(profileId: string): ProviderProfileMeta | null {
  return readJson<ProviderProfileMeta | null>(getProviderProfileMetaKey(profileId), null);
}

export function getProviderProfileSecret(profileId: string): ProviderProfileSecret | null {
  return readJson<ProviderProfileSecret | null>(getProviderProfileSecretKey(profileId), null);
}

export function resolveProviderProfile(profileId: string): ProviderProfileSnapshot | null {
  const meta = getProviderProfileMeta(profileId);
  const secret = getProviderProfileSecret(profileId);
  if (!meta || !secret?.apiKey) {
    return null;
  }

  return {
    ...meta,
    apiKey: secret.apiKey,
  };
}

export function createProviderProfile(input: CreateProviderProfileInput): ProviderProfileMeta {
  const now = new Date().toISOString();
  const profileId = `provider-profile-${createUuidV4()}`;
  const meta: ProviderProfileMeta = {
    profileId,
    name: normalizeRequiredText(input.name, 'name'),
    provider: input.provider,
    model: normalizeRequiredText(input.model, 'model'),
    baseUrl: normalizeOptionalText(input.baseUrl),
    createdAt: now,
    updatedAt: now,
  };
  const secret: ProviderProfileSecret = {
    profileId,
    apiKey: normalizeRequiredText(input.apiKey, 'apiKey'),
    updatedAt: now,
  };

  setProfileIndex([...getProfileIndex(), profileId]);
  writeJson(getProviderProfileMetaKey(profileId), meta);
  writeJson(getProviderProfileSecretKey(profileId), secret);

  return meta;
}

export function updateProviderProfile(
  profileId: string,
  input: UpdateProviderProfileInput,
): ProviderProfileMeta | null {
  const current = getProviderProfileMeta(profileId);
  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  const nextMeta: ProviderProfileMeta = {
    ...current,
    name: input.name ? normalizeRequiredText(input.name, 'name') : current.name,
    model: input.model ? normalizeRequiredText(input.model, 'model') : current.model,
    baseUrl: typeof input.baseUrl === 'string' ? normalizeOptionalText(input.baseUrl) : current.baseUrl,
    updatedAt: now,
  };
  writeJson(getProviderProfileMetaKey(profileId), nextMeta);

  if (typeof input.apiKey === 'string') {
    const currentSecret = getProviderProfileSecret(profileId);
    const nextSecret: ProviderProfileSecret = {
      profileId,
      apiKey: normalizeRequiredText(input.apiKey, 'apiKey'),
      updatedAt: now,
    };
    writeJson(getProviderProfileSecretKey(profileId), currentSecret ? nextSecret : nextSecret);
  }

  return nextMeta;
}

export function markProviderProfileUsed(profileId: string): ProviderProfileMeta | null {
  const current = getProviderProfileMeta(profileId);
  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  const nextMeta: ProviderProfileMeta = {
    ...current,
    lastUsedAt: now,
    updatedAt: now,
  };
  writeJson(getProviderProfileMetaKey(profileId), nextMeta);
  return nextMeta;
}
