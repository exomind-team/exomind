import { describe, expect, it } from 'vitest';
import type { EventData } from '@/lib/types/event';
import {
  createCheckpoint,
  getEventsAfterCheckpoint,
} from '@/lib/eventlog/mirror';

const events: EventData[] = [
  { id: 'evt-1', timestamp: 1000, content: 'first', tags: ['note'] },
  { id: 'evt-2', timestamp: 2000, content: 'second', tags: ['note'] },
  { id: 'evt-3', timestamp: 3000, content: 'third', tags: ['note'] },
];

describe('eventlog mirror checkpoint', () => {
  it('returns events after checkpoint id', () => {
    const checkpoint = createCheckpoint('evt-1', 3001);
    const pending = getEventsAfterCheckpoint(events, checkpoint);

    expect(pending.map((event) => event.id)).toEqual(['evt-2', 'evt-3']);
  });

  it('replays all events when checkpoint id is missing', () => {
    const checkpoint = createCheckpoint('missing-event', 3001);
    const pending = getEventsAfterCheckpoint(events, checkpoint);

    expect(pending.map((event) => event.id)).toEqual(['evt-1', 'evt-2', 'evt-3']);
  });
});
