import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event as StorageEvent } from '@/lib/storage/event-storage';

const replicationMocks = vi.hoisted(() => ({
  publishMock: vi.fn(),
  projectReplicatedEventMock: vi.fn(),
  getSelectedRuntimeTargetMock: vi.fn(),
  signalStreamConstructorMock: vi.fn(),
}));

vi.mock('@/config/runtime-target', () => ({
  getSelectedRuntimeTarget: replicationMocks.getSelectedRuntimeTargetMock,
}));

vi.mock('@/lib/services/signal-stream.service', () => ({
  SignalStreamService: class MockSignalStreamService {
    publish = replicationMocks.publishMock;

    constructor(options: unknown) {
      replicationMocks.signalStreamConstructorMock(options);
    }
  },
}));

vi.mock('@/lib/storage/event-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/event-storage')>('@/lib/storage/event-storage');
  return {
    ...actual,
    getEventStorage: vi.fn(() => ({
      projectReplicatedEvent: replicationMocks.projectReplicatedEventMock,
    })),
  };
});

import {
  EVENTLOG_REPLICATION_APPENDED_TOPIC,
  projectEventLogReplicationAppend,
  publishEventLogReplicationAppend,
  type EventLogReplicationPayload,
} from '@/lib/services/ecs-eventlog-replication.service';

describe('ecs-eventlog-replication.service', () => {
  const sampleEvent: StorageEvent = {
    id: 'evt-local-001',
    content: 'desktop -> mobile',
    createdAt: '2026-03-07T00:00:00.000Z',
    type: 'note',
    metadata: {
      source: {
        app: 'ExoMind',
        deviceId: 'device-1',
        deviceName: 'Desktop',
        platform: 'Windows',
      },
    },
    replicationSeq: 7,
  };

  beforeEach(() => {
    replicationMocks.publishMock.mockReset().mockResolvedValue({
      accepted: true,
      event_id: 'signal-evt-1',
    });
    replicationMocks.projectReplicatedEventMock.mockReset().mockResolvedValue('inserted');
    replicationMocks.getSelectedRuntimeTargetMock.mockReset().mockReturnValue({
      mode: 'embedded',
      host: '127.0.0.1',
      port: 1949,
    });
    replicationMocks.signalStreamConstructorMock.mockReset();
  });

  it('publishes replication append with replication_seq cursor（发布 replicationSeq 光标）', async () => {
    await publishEventLogReplicationAppend(sampleEvent);

    expect(replicationMocks.publishMock).toHaveBeenCalledTimes(1);
    const request = replicationMocks.publishMock.mock.calls[0]?.[0] as {
      topic: string;
      source: string;
      payload: EventLogReplicationPayload;
    };

    expect(request.topic).toBe(EVENTLOG_REPLICATION_APPENDED_TOPIC);
    expect(request.source).toBe('frontend:eventlog-ecs');
    expect(request.payload.replicationSeq).toBe(7);
    expect(request.payload.cursor).toEqual({
      kind: 'replication_seq',
      value: 7,
    });
    expect(request.payload.cursor).not.toHaveProperty('createdAt');
    expect(request.payload.cursor).not.toHaveProperty('id');
    expect(request.payload.event.id).toBe(sampleEvent.id);
  });

  it('projects remote replication payload into EventStorage（远端复制信号投影到 EventStorage）', async () => {
    const payload: EventLogReplicationPayload = {
      schemaVersion: 1,
      replicationSeq: 42,
      cursor: {
        kind: 'replication_seq',
        value: 42,
      },
      event: {
        ...sampleEvent,
        id: 'evt-remote-001',
        replicationSeq: 42,
      },
    };

    await expect(projectEventLogReplicationAppend(payload)).resolves.toBe('inserted');
    expect(replicationMocks.projectReplicatedEventMock).toHaveBeenCalledWith(payload.event);
  });
});
