import {
  getRuntimeConfigValueSync,
  removeRuntimeConfigValue,
  setRuntimeConfigValue,
} from './runtime-config-cache';

export const MOSS_API_KEY_STORAGE_KEY = 'moss_api_key';

function normalizeMossApiKey(value: string): string {
  if (!value) {
    return '';
  }

  let normalized = value.trim();
  normalized = normalized.replace(/^['"]|['"]$/g, '');
  normalized = normalized.replace(/^Bearer\s+/i, '');
  return normalized.trim();
}

export function getMossApiKey(): string {
  return normalizeMossApiKey(getRuntimeConfigValueSync(MOSS_API_KEY_STORAGE_KEY) || '');
}

export function setMossApiKey(value: string): string {
  const normalized = normalizeMossApiKey(value);
  if (!normalized) {
    removeRuntimeConfigValue(MOSS_API_KEY_STORAGE_KEY);
    return '';
  }

  setRuntimeConfigValue(MOSS_API_KEY_STORAGE_KEY, normalized, {
    sensitive: true,
    source: 'settings-registry',
    sourceOrigin: typeof window !== 'undefined' ? window.location?.origin : undefined,
  });
  return normalized;
}
