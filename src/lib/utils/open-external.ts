import { isTauriWindow } from '@/config/runtime-target';
import { resolveLocalServiceHost } from '@/config/local-service-host';
import { buildEventRecordPath, parseEventPermalink } from '@/lib/eventlog/event-refs';

export type MarkdownLinkTarget =
  | { kind: 'external'; url: URL }
  | { kind: 'internal'; url: URL }
  | { kind: 'unsupported'; url: null };

function resolveUrl(input: string): URL | null {
  try {
    const base = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';
    return new URL(input, base);
  } catch {
    return null;
  }
}

function resolveCurrentOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'http://localhost';
}

function normalizeHostName(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function isTrustedLocalEventlogHost(hostname: string): boolean {
  const normalized = normalizeHostName(hostname);
  return normalized === 'app.local' || resolveLocalServiceHost(normalized) === '127.0.0.1';
}

function resolveInternalEventLogTarget(url: URL): URL | null {
  const currentOrigin = resolveCurrentOrigin();
  const currentHost = (() => {
    try {
      return new URL(currentOrigin).hostname;
    } catch {
      return '';
    }
  })();

  if (!isTrustedLocalEventlogHost(currentHost) || !isTrustedLocalEventlogHost(url.hostname)) {
    return null;
  }

  const eventId = parseEventPermalink(url.toString(), currentOrigin);
  if (!eventId) {
    return null;
  }

  return new URL(buildEventRecordPath(eventId), currentOrigin);
}

export function resolveMarkdownLinkTarget(href: string): MarkdownLinkTarget {
  const resolved = resolveUrl(href);
  if (!resolved) {
    return { kind: 'unsupported', url: null };
  }

  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return { kind: 'unsupported', url: null };
  }

  if (typeof window !== 'undefined' && resolved.origin === window.location.origin) {
    return { kind: 'internal', url: resolved };
  }

  const internalEventLogTarget = resolveInternalEventLogTarget(resolved);
  if (internalEventLogTarget) {
    return { kind: 'internal', url: internalEventLogTarget };
  }

  return { kind: 'external', url: resolved };
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriWindow()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
