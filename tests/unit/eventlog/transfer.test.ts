import { describe, it, expect } from 'vitest';
import type { EventData } from '@/lib/types/event';
import type { TaskNode } from '@/lib/types/task';
import {
  createTransferPayload,
  parseTransferPayload,
  mergeEventsById,
  mergeTasksById,
} from '@/lib/eventlog/transfer';

function createEvent(id: string, timestamp: number, content: string): EventData {
  return {
    id,
    timestamp,
    content,
    tags: ['note'],
  };
}

function createTask(id: string, createdAt: number, title: string): TaskNode {
  return {
    id,
    title,
    status: 'not_started',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt,
    updatedAt: createdAt,
  };
}

describe('eventlog transfer helpers', () => {
  it('creates transfer payload in v1 format', () => {
    const payload = createTransferPayload([createEvent('e1', 1000, 'hello')], [createTask('t1', 1000, 'task')]);
    expect(payload.version).toBe(1);
    expect(payload.events).toHaveLength(1);
    expect(payload.tasks).toHaveLength(1);
    expect(typeof payload.exportedAt).toBe('string');
  });

  it('parses transfer payload from json', () => {
    const raw = JSON.stringify(createTransferPayload([createEvent('e1', 1000, 'hello')]));
    const parsed = parseTransferPayload(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.events[0].id).toBe('e1');
  });

  it('throws for invalid transfer json', () => {
    expect(() => parseTransferPayload('{bad json')).toThrow();
  });

  it('keeps legacy backup compatible when tasks block is missing', () => {
    const raw = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      events: [createEvent('e1', 1000, 'hello')],
    });
    const parsed = parseTransferPayload(raw);
    expect(parsed.tasks).toBeUndefined();
  });

  it('merges imported events by id without duplication', () => {
    const existing = [createEvent('e1', 1000, 'old-1'), createEvent('e2', 2000, 'old-2')];
    const incoming = [createEvent('e2', 3000, 'new-2'), createEvent('e3', 4000, 'new-3')];
    const merged = mergeEventsById(existing, incoming);

    expect(merged).toHaveLength(3);
    expect(merged.find((e) => e.id === 'e2')?.content).toBe('new-2');
    expect(merged.find((e) => e.id === 'e3')).toBeDefined();
  });

  it('merges imported tasks by id without duplication', () => {
    const existing = [createTask('t1', 1000, 'old-1'), createTask('t2', 2000, 'old-2')];
    const incoming = [createTask('t2', 3000, 'new-2'), createTask('t3', 4000, 'new-3')];
    const merged = mergeTasksById(existing, incoming);

    expect(merged).toHaveLength(3);
    expect(merged.find((task) => task.id === 't2')?.title).toBe('new-2');
    expect(merged.find((task) => task.id === 't3')).toBeDefined();
  });
});
