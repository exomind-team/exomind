import type { EventMetadata, EventRef } from '../types/event';

export const EVENT_REFS_METADATA_KEY = 'eventRefs';
export const EVENTLOG_RECORD_PATH = '/eventlog/record';
export const EVENTLOG_RECORD_EVENT_QUERY_KEY = 'event';
export const EVENTLOG_RECORD_LOCATE_QUERY_KEY = 'locate';
const DEFAULT_EVENT_REF_SUMMARY = '事件引用';
const EVENT_REF_SUMMARY_MAX_LENGTH = 48;
const MARKDOWN_LINK_PATTERN = /\[([^\]]*?)\]\(([^)\s]+)\)/g;
const APP_URL_PATTERN = /(?:https?:\/\/[^\s<>()]+|\/eventlog\/record\?[^\s<>()]+)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveBaseOrigin(origin?: string): string {
  if (typeof origin === 'string' && origin.trim().length > 0) {
    return origin;
  }

  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string' && window.location.origin.length > 0) {
    return window.location.origin;
  }

  return 'http://localhost';
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/([\\[\]])/g, '\\$1');
}

function normalizeEventId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isEventRef(value: unknown): value is EventRef {
  if (!isRecord(value)) {
    return false;
  }

  return value.kind === 'event' && typeof value.eventId === 'string' && value.eventId.trim().length > 0;
}

export function normalizeEventRefs(refs: readonly EventRef[] | null | undefined): EventRef[] {
  if (!Array.isArray(refs) || refs.length === 0) {
    return [];
  }

  const ordered = new Map<string, EventRef>();

  for (const ref of refs) {
    if (!isEventRef(ref)) {
      continue;
    }

    const eventId = ref.eventId.trim();
    const dedupeKey = `${ref.kind}:${eventId}`;
    if (ordered.has(dedupeKey)) {
      continue;
    }

    ordered.set(dedupeKey, {
      kind: 'event',
      eventId,
      ...(normalizeSummary(ref.summary) ? { summary: normalizeSummary(ref.summary) } : {}),
    });
  }

  return Array.from(ordered.values());
}

export function summarizeEventRefContent(content: string, maxLength = EVENT_REF_SUMMARY_MAX_LENGTH): string {
  const firstLine = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const summary = firstLine ?? DEFAULT_EVENT_REF_SUMMARY;
  return summary.length > maxLength
    ? `${summary.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
    : summary;
}

export function buildEventRecordPath(eventId: string, locate = true): string {
  const params = new URLSearchParams();
  params.set(EVENTLOG_RECORD_EVENT_QUERY_KEY, eventId);
  if (locate) {
    params.set(EVENTLOG_RECORD_LOCATE_QUERY_KEY, '1');
  }
  return `${EVENTLOG_RECORD_PATH}?${params.toString()}`;
}

export function buildEventPermalink(eventId: string, origin?: string): string {
  return new URL(buildEventRecordPath(eventId), resolveBaseOrigin(origin)).toString();
}

export function parseEventPermalink(input: string, origin?: string): string | null {
  try {
    const url = new URL(input, resolveBaseOrigin(origin));
    if (url.pathname !== EVENTLOG_RECORD_PATH) {
      return null;
    }

    return normalizeEventId(url.searchParams.get(EVENTLOG_RECORD_EVENT_QUERY_KEY));
  } catch {
    return null;
  }
}

export function buildEventRefQuoteLine(ref: EventRef, origin?: string): string {
  const summary = ref.summary ?? DEFAULT_EVENT_REF_SUMMARY;
  return `> 引用：[${escapeMarkdownLinkLabel(summary)}](${buildEventPermalink(ref.eventId, origin)})`;
}

export function extractEventPermalinksFromContent(
  content: string,
  origin?: string,
): Array<{ eventId: string; href: string; label?: string }> {
  const matches = new Map<string, { eventId: string; href: string; label?: string }>();

  for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
    const href = match[2]?.trim();
    const eventId = href ? parseEventPermalink(href, origin) : null;
    if (!eventId || matches.has(eventId)) {
      continue;
    }

    const label = normalizeSummary(match[1]);
    matches.set(eventId, { eventId, href, ...(label ? { label } : {}) });
  }

  for (const match of content.matchAll(APP_URL_PATTERN)) {
    const href = match[0]?.trim();
    const eventId = href ? parseEventPermalink(href, origin) : null;
    if (!eventId || matches.has(eventId)) {
      continue;
    }

    matches.set(eventId, { eventId, href });
  }

  return Array.from(matches.values());
}

export function readEventRefsFromMetadata(metadata: Record<string, unknown> | null | undefined): EventRef[] {
  if (!metadata) {
    return [];
  }

  const rawRefs = metadata[EVENT_REFS_METADATA_KEY];
  return normalizeEventRefs(Array.isArray(rawRefs) ? rawRefs as EventRef[] : []);
}

export function mergeMetadataWithEventRefs(
  metadata: EventMetadata | undefined,
  refs: readonly EventRef[] | null | undefined,
): Record<string, unknown> {
  const base = isRecord(metadata) ? { ...metadata } : {};
  const normalizedRefs = normalizeEventRefs(refs);

  if (normalizedRefs.length > 0) {
    base[EVENT_REFS_METADATA_KEY] = normalizedRefs;
  } else {
    delete base[EVENT_REFS_METADATA_KEY];
  }

  return base;
}

export function stripEventRefsFromMetadata(metadata: Record<string, unknown> | null): EventMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const nextMetadata = { ...metadata };
  delete nextMetadata[EVENT_REFS_METADATA_KEY];
  return Object.keys(nextMetadata).length > 0 ? nextMetadata as EventMetadata : undefined;
}
