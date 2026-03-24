import type { Event as StorageEvent } from '@/lib/storage/event-storage';
import type { Event as UiEvent, EventMetadata, Tag } from '@/lib/types/event';

const TAGS_METADATA_KEY = 'tags';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTimestamp(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function sortByTimeAsc(events: UiEvent[]): UiEvent[] {
  return [...events].sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.id.localeCompare(b.id);
  });
}

function normalizeTags(rawTags: unknown, fallbackType?: string): Tag[] {
  if (Array.isArray(rawTags)) {
    const tags = rawTags.filter((tag): tag is Tag => typeof tag === 'string' && tag.length > 0);
    if (tags.length > 0) {
      return tags;
    }
  }

  if (typeof fallbackType === 'string' && fallbackType.length > 0) {
    return [fallbackType];
  }

  return [];
}

function toEventMetadata(rawMetadata: unknown): EventMetadata | undefined {
  if (!isRecord(rawMetadata)) {
    return undefined;
  }

  const metadata = { ...rawMetadata };
  delete metadata[TAGS_METADATA_KEY];

  return Object.keys(metadata).length > 0 ? (metadata as EventMetadata) : undefined;
}

export function toUiEvent(event: StorageEvent): UiEvent {
  const tags = normalizeTags(isRecord(event.metadata) ? event.metadata[TAGS_METADATA_KEY] : undefined, event.type);
  return {
    id: event.id,
    timestamp: parseTimestamp(event.createdAt),
    content: event.content,
    tags: new Set<string>(tags),
    metadata: toEventMetadata(event.metadata),
  };
}

/**
 * Storage 层按时间倒序返回，UI 层统一使用升序（旧 -> 新）。
 */
export function normalizeStorageEventsAscending(events: StorageEvent[]): UiEvent[] {
  return events.map((event) => toUiEvent(event)).reverse();
}

/**
 * 将更早历史 prepend 到已加载列表，按 ID 去重并保持升序。
 */
export function prependOlderEventsAscending(existing: UiEvent[], older: UiEvent[]): UiEvent[] {
  const byId = new Map<string, UiEvent>();
  for (const event of older) {
    byId.set(event.id, event);
  }
  for (const event of existing) {
    byId.set(event.id, byId.get(event.id) ?? event);
  }
  return sortByTimeAsc(Array.from(byId.values()));
}

/**
 * 将最新事件批次并入已加载列表，按 ID 去重并保持升序。
 */
export function mergeLatestEventsAscending(existing: UiEvent[], latest: UiEvent[]): UiEvent[] {
  const byId = new Map<string, UiEvent>();
  for (const event of existing) {
    byId.set(event.id, event);
  }
  for (const event of latest) {
    byId.set(event.id, event);
  }
  return sortByTimeAsc(Array.from(byId.values()));
}
