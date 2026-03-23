import { describe, it, expect } from 'vitest';
import type { Event as StorageEvent } from '@/lib/storage/event-storage';
import type { Event as UiEvent } from '@/lib/types/event';
import {
  normalizeStorageEventsAscending,
  prependOlderEventsAscending,
  mergeLatestEventsAscending,
} from '@/components/Chat/chat-event-pagination';

function createStorageEvent(id: string, createdAt: string, content?: string): StorageEvent {
  return {
    id,
    createdAt,
    content: content ?? id,
  };
}

function createUiEvent(id: string, timestamp: number, content?: string): UiEvent {
  return {
    id,
    timestamp,
    content: content ?? id,
    tags: new Set<string>(),
  };
}

describe('chat-event-pagination', () => {
  it('should normalize storage events from desc to asc order', () => {
    const descEvents: StorageEvent[] = [
      createStorageEvent('3', '2024-01-01T10:00:02.000Z'),
      createStorageEvent('2', '2024-01-01T10:00:01.000Z'),
      createStorageEvent('1', '2024-01-01T10:00:00.000Z'),
    ];

    const ascEvents = normalizeStorageEventsAscending(descEvents);
    expect(ascEvents.map((event) => event.id)).toEqual(['1', '2', '3']);
  });

  it('should prepend older events and remove duplicates by id', () => {
    const older: UiEvent[] = [
      createUiEvent('1', 1_000),
      createUiEvent('2', 2_000),
      createUiEvent('3', 3_000),
    ];
    const existing: UiEvent[] = [
      createUiEvent('3', 3_000),
      createUiEvent('4', 4_000),
    ];

    const merged = prependOlderEventsAscending(existing, older);
    expect(merged.map((event) => event.id)).toEqual(['1', '2', '3', '4']);
  });

  it('should merge latest events and keep ascending order', () => {
    const existing: UiEvent[] = [
      createUiEvent('1', 1_000, 'old-1'),
      createUiEvent('2', 2_000, 'old-2'),
    ];
    const latest: UiEvent[] = [
      createUiEvent('2', 2_000, 'new-2'),
      createUiEvent('3', 3_000, 'new-3'),
    ];

    const merged = mergeLatestEventsAscending(existing, latest);
    expect(merged.map((event) => event.id)).toEqual(['1', '2', '3']);
    expect(merged.find((event) => event.id === '2')?.content).toBe('new-2');
  });
});
