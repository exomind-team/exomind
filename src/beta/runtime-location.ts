import { invoke } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';

export interface BetaRuntimeLocationInfo {
  http_address: string | null;
  listener_state: 'starting' | 'listening' | 'unavailable' | 'stopped';
  data_directory: string;
  device_id: string;
  runtime_id: string;
}

/** Only credential-free HTTP origins are displayable as service addresses. */
export function betaDisplayEndpoint(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const endpoint = new URL(value);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.href.includes('@') || endpoint.search || endpoint.hash) return null;
    if (!['/', '/beta/v1', '/beta/v1/'].includes(endpoint.pathname)) return null;
    return endpoint.origin;
  } catch { return null; }
}

export async function readBetaRuntimeLocation(): Promise<BetaRuntimeLocationInfo> {
  const value = await invoke<unknown>('beta_runtime_location');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidLocation();
  const item = value as Record<string, unknown>;
  if (!['starting', 'listening', 'unavailable', 'stopped'].includes(String(item.listener_state))
    || typeof item.data_directory !== 'string' || !item.data_directory
    || typeof item.device_id !== 'string' || !item.device_id
    || typeof item.runtime_id !== 'string' || !item.runtime_id
    || (item.http_address !== null && (typeof item.http_address !== 'string' || betaDisplayEndpoint(item.http_address) !== item.http_address))
    || (item.listener_state === 'listening') !== (item.http_address !== null)) throw invalidLocation();
  return item as unknown as BetaRuntimeLocationInfo;
}

function invalidLocation(): BetaApiError {
  return new BetaApiError('invalid_runtime_location', '当前运行位置尚未确认，请重新读取');
}
