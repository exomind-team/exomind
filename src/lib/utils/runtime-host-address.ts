import {
  formatRuntimeTargetAddress,
  parseRuntimeAddress,
  toRuntimeBaseUrl,
} from '@/config/runtime-target';
import { resolveLocalServiceHost } from '@/config/local-service-host';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function hasRuntimeControlAuth(host: Pick<RuntimeHostRecord, 'authToken'>): boolean {
  return Boolean(normalizeOptionalText(host.authToken));
}

export function isMeshOnlyConfirmedPeer(
  host: Pick<RuntimeHostRecord, 'trustState' | 'authToken'>,
): boolean {
  return host.trustState === 'confirmed_peer' && !hasRuntimeControlAuth(host);
}

export function resolveRuntimeHostAdvertisedAddress(
  host: Pick<RuntimeHostRecord, 'host' | 'port' | 'advertisedListenAddress'>,
): string {
  return normalizeOptionalText(host.advertisedListenAddress)
    ?? formatRuntimeTargetAddress({ host: host.host, port: host.port });
}

export function resolveRuntimeHostDialAddress(
  host: Pick<RuntimeHostRecord, 'host' | 'port' | 'lastSuccessfulDialAddress' | 'manualOverride'>,
): string {
  const candidate = normalizeOptionalText(host.lastSuccessfulDialAddress)
    ?? normalizeOptionalText(host.manualOverride)
    ?? formatRuntimeTargetAddress({ host: host.host, port: host.port });

  const parsed = parseRuntimeAddress(candidate);
  const normalizedHost = parsed.host === 'localhost'
    ? '127.0.0.1'
    : resolveLocalServiceHost(parsed.host);

  return formatRuntimeTargetAddress({
    host: normalizedHost,
    port: parsed.port,
  });
}

export function resolveRuntimeHostBaseUrl(
  host: Pick<RuntimeHostRecord, 'host' | 'port' | 'lastSuccessfulDialAddress' | 'manualOverride'>,
): string {
  const resolved = parseRuntimeAddress(resolveRuntimeHostDialAddress(host));
  return toRuntimeBaseUrl(resolved);
}

export function buildRuntimeAuthHeaders(
  authToken: string | undefined,
  headers?: HeadersInit,
): Headers {
  const nextHeaders = new Headers(headers);
  const normalizedToken = normalizeOptionalText(authToken);
  if (normalizedToken) {
    nextHeaders.set('Authorization', `Bearer ${normalizedToken}`);
  }
  return nextHeaders;
}

export function appendRuntimeAuthTokenToUrl(url: string, authToken: string | undefined): string {
  const normalizedToken = normalizeOptionalText(authToken);
  if (!normalizedToken) {
    return url;
  }

  const nextUrl = new URL(url);
  nextUrl.searchParams.set('token', normalizedToken);
  return nextUrl.toString();
}
