import { isTauriWindow } from '@/config/runtime-target';

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
