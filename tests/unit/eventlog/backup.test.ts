import { describe, it, expect } from 'vitest';
import type { EventData } from '@/lib/types/event';
import {
  createBackupPayload,
  parseBackupPayload,
  mergeEventsById,
} from '@/lib/eventlog/backup';

function createEvent(id: string, timestamp: number, content: string): EventData {
  return {
    id,
    timestamp,
    content,
    tags: ['note'],
  };
}

describe('eventlog backup helpers', () => {
  it('creates backup payload in v1 format', () => {
    const payload = createBackupPayload([createEvent('e1', 1000, 'hello')]);
    expect(payload.version).toBe(1);
    expect(payload.events).toHaveLength(1);
    expect(typeof payload.exportedAt).toBe('string');
  });

  it('parses backup payload from json', () => {
    const raw = JSON.stringify(createBackupPayload([createEvent('e1', 1000, 'hello')]));
    const parsed = parseBackupPayload(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.events[0].id).toBe('e1');
  });

  it('throws for invalid backup json', () => {
    expect(() => parseBackupPayload('{bad json')).toThrow();
  });

  it('merges imported events by id without duplication', () => {
    const existing = [createEvent('e1', 1000, 'old-1'), createEvent('e2', 2000, 'old-2')];
    const incoming = [createEvent('e2', 3000, 'new-2'), createEvent('e3', 4000, 'new-3')];
    const merged = mergeEventsById(existing, incoming);

    expect(merged).toHaveLength(3);
    expect(merged.find((e) => e.id === 'e2')?.content).toBe('new-2');
    expect(merged.find((e) => e.id === 'e3')).toBeDefined();
  });
});
