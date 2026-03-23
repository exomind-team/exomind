import type { EventData } from '../types/event';

export interface MirrorCheckpoint {
  lastEventId: string | null;
  updatedAtMs: number;
}

export interface MirrorRebuildResult {
  markdown: string;
  checkpoint: MirrorCheckpoint;
}

function sortEventsByTime(events: EventData[]): EventData[] {
  return [...events].sort((left, right) => {
    if (left.timestamp === right.timestamp) {
      return left.id.localeCompare(right.id);
    }
    return left.timestamp - right.timestamp;
  });
}

function toEventIso(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return new Date(0).toISOString();
  }
  return date.toISOString();
}

function formatTags(tags: string[]): string {
  return JSON.stringify(tags);
}

export function formatEventMarkdown(event: EventData): string {
  return [
    '---',
    `event_id: ${event.id}`,
    `event_time_ms: ${event.timestamp}`,
    `event_time_iso: ${toEventIso(event.timestamp)}`,
    `tags: ${formatTags(event.tags)}`,
    '---',
    event.content,
    '',
  ].join('\n');
}

export function createCheckpoint(lastEventId: string | null, updatedAtMs: number = Date.now()): MirrorCheckpoint {
  return {
    lastEventId,
    updatedAtMs,
  };
}

export function getEventsAfterCheckpoint(
  events: EventData[],
  checkpoint: MirrorCheckpoint | null
): EventData[] {
  const sorted = sortEventsByTime(events);
  if (!checkpoint?.lastEventId) {
    return sorted;
  }

  const checkpointIndex = sorted.findIndex((event) => event.id === checkpoint.lastEventId);
  if (checkpointIndex === -1) {
    return sorted;
  }

  return sorted.slice(checkpointIndex + 1);
}

export function appendEventsToMarkdown(
  existingMarkdown: string,
  events: EventData[],
  updatedAtMs: number = Date.now()
): MirrorRebuildResult {
  const sorted = sortEventsByTime(events);
  const appended = sorted.map((event) => formatEventMarkdown(event)).join('');
  const markdown = `${existingMarkdown}${appended}`;
  const lastEventId = sorted.length > 0 ? sorted[sorted.length - 1].id : null;

  return {
    markdown,
    checkpoint: createCheckpoint(lastEventId, updatedAtMs),
  };
}

export function rebuildMirrorMarkdown(
  events: EventData[],
  updatedAtMs: number = Date.now()
): MirrorRebuildResult {
  const sorted = sortEventsByTime(events);
  const markdown = sorted.map((event) => formatEventMarkdown(event)).join('');
  const lastEventId = sorted.length > 0 ? sorted[sorted.length - 1].id : null;

  return {
    markdown,
    checkpoint: createCheckpoint(lastEventId, updatedAtMs),
  };
}
