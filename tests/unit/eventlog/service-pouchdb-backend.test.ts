import { beforeEach, describe, expect, it, vi } from 'vitest';

const replicationMocks = vi.hoisted(() => ({
  appendEventWithEcsReplication: vi.fn(),
}));

const mocks = {
  getEvents: vi.fn(),
  addEvent: vi.fn(),
  getEvent: vi.fn(),
  clearAll: vi.fn(),
};

vi.mock('@/lib/storage/event-storage', () => ({
  getEventStorage: vi.fn(() => ({
    getEvents: mocks.getEvents,
    addEvent: mocks.addEvent,
    getEvent: mocks.getEvent,
    clearAll: mocks.clearAll,
  })),
}));

vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: replicationMocks.appendEventWithEcsReplication,
}));

import { EventLogServiceImpl } from '@/lib/services/eventlog.service';
import { WebEventLogStorageAdapter } from '@/lib/adapters/web-eventlog-storage';

describe('EventLogService PouchDB backend', () => {
  const createPouchPort = () => new WebEventLogStorageAdapter();

  beforeEach(() => {
    replicationMocks.appendEventWithEcsReplication.mockReset().mockImplementation(async (event) => {
      await mocks.addEvent(event);
      return event;
    });
    mocks.getEvents.mockReset();
    mocks.addEvent.mockReset();
    mocks.getEvent.mockReset();
    mocks.clearAll.mockReset();
  });

  it('exports events from EventStorage by default', async () => {
    mocks.getEvents.mockResolvedValue([
      {
        id: 'evt-1',
        content: 'from-pouchdb',
        createdAt: '2026-02-11T00:00:00.000Z',
        type: 'note',
        metadata: { tags: ['note'] },
      },
    ]);

    const service = new EventLogServiceImpl({ port: createPouchPort() });
    const raw = await service.exportEventsAsJson();
    const payload = JSON.parse(raw) as { events: Array<{ content: string }> };

    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]?.content).toBe('from-pouchdb');
  });

  it('overwrite import clears and rewrites EventStorage', async () => {
    mocks.getEvents.mockResolvedValue([]);
    mocks.getEvent.mockResolvedValue({
      id: 'evt-2',
      content: 'imported',
      createdAt: new Date(1739232000000).toISOString(),
      type: 'note',
      metadata: { tags: ['note'] },
      replicationSeq: 1,
    });

    const service = new EventLogServiceImpl({ port: createPouchPort() });
    const backup = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      events: [
        { id: 'evt-2', timestamp: 1739232000000, content: 'imported', tags: ['note'] },
      ],
    });

    const result = await service.importEventsFromJson(backup, 'overwrite');

    expect(mocks.clearAll).toHaveBeenCalledTimes(1);
    expect(mocks.addEvent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ imported: 1, skipped: 0, total: 1 });
  });
});
