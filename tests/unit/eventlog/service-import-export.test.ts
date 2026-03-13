import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { EventData } from '@/lib/types/event';
import { EventLogServiceImpl } from '@/lib/services/eventlog.service';

type EventLogPortShape = {
  listEvents: () => Promise<EventData[]>;
  appendEvent: (event: EventData) => Promise<void>;
  getEvent: (id: string) => Promise<EventData | null>;
  clearEvents: () => Promise<void>;
};

function createMockPort(initialEvents: EventData[] = []): EventLogPortShape {
  let current = initialEvents;
  return {
    listEvents: vi.fn(async () => [...current]),
    appendEvent: vi.fn(async (event: EventData) => {
      current = [event, ...current];
    }),
    getEvent: vi.fn(async (id: string) => current.find((event) => event.id === id) ?? null),
    clearEvents: vi.fn(async () => {
      current = [];
    }),
  };
}

describe('EventLogService import/export', () => {
  let port: EventLogPortShape;

  beforeEach(() => {
    port = createMockPort([
      { id: 'e1', timestamp: 1000, content: 'old', tags: ['note'] },
      { id: 'e2', timestamp: 2000, content: 'old-2', tags: ['note'] },
    ]);
  });

  it('exports eventlog as json backup', async () => {
    const service = new EventLogServiceImpl({ port });
    const json = await service.exportEventsAsJson();
    const parsed = JSON.parse(json) as { version: number; events: EventData[] };
    expect(parsed.version).toBe(1);
    expect(parsed.events).toHaveLength(2);
  });

  it('imports backup with merge strategy', async () => {
    const service = new EventLogServiceImpl({ port });
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      events: [
        { id: 'e2', timestamp: 3000, content: 'new-2', tags: ['note'] },
        { id: 'e3', timestamp: 4000, content: 'new-3', tags: ['note'] },
      ],
    });

    const result = await service.importEventsFromJson(backup, 'merge');
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.total).toBe(3);
  });

  it('appends raw event data without regenerating timestamp or tags', async () => {
    const service = new EventLogServiceImpl({ port });

    const appended = await service.appendEventData({
      id: 'evt-block-start',
      timestamp: 1700000000000,
      content: 'Deep Work started',
      tags: ['block_start'],
      metadata: {
        source: {
          deviceId: 'desktop-1',
          deviceName: 'Desktop',
          platform: 'windows',
          app: 'ExoMind',
        },
      },
    });

    expect(port.appendEvent).toHaveBeenCalledWith({
      id: 'evt-block-start',
      timestamp: 1700000000000,
      content: 'Deep Work started',
      tags: ['block_start'],
      metadata: {
        source: {
          deviceId: 'desktop-1',
          deviceName: 'Desktop',
          platform: 'windows',
          app: 'ExoMind',
        },
      },
    });
    expect(appended.tags.has('block_start')).toBe(true);
    expect(appended.timestamp).toBe(1700000000000);
  });
});
