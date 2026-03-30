import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event as StorageEvent } from '@/lib/storage/event-storage';

const replicationMocks = vi.hoisted(() => ({
  publishMock: vi.fn(),
  projectReplicatedEventMock: vi.fn(),
  addEventStorageMock: vi.fn(),
  getEventStorageMock: vi.fn(),
  getEventlogBackendModeMock: vi.fn(),
  runtimeModeMock: vi.fn(),
  appendEventDataMock: vi.fn(),
  getEventPortMock: vi.fn(),
  getSelectedRuntimeTargetMock: vi.fn(),
  signalStreamConstructorMock: vi.fn(),
}));

vi.mock('@/config/runtime-target', () => ({
  getSelectedRuntimeTarget: replicationMocks.getSelectedRuntimeTargetMock,
}));

vi.mock('@/config/domain-backend-mode', () => ({
  getEventlogBackendMode: replicationMocks.getEventlogBackendModeMock,
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
    getEventStorage: replicationMocks.getEventStorageMock,
  };
});

vi.mock('@/lib/services/eventlog.service', () => ({
  getEventLogService: () => ({
    appendEventData: replicationMocks.appendEventDataMock,
  }),
}));

vi.mock('@/lib/environment/environment', () => ({
  ExoMindEnvironment: {
    getInstance: () => ({
      runtime: replicationMocks.runtimeModeMock(),
      eventlog: {
        getEvent: replicationMocks.getEventPortMock,
      },
    }),
  },
}));

import {
  EVENTLOG_REPLICATION_APPENDED_TOPIC,
  appendEventWithEcsReplication,
  projectEventLogReplicationAppend,
  publishEventLogReplicationAppend,
  type EventLogReplicationAppendedPayload,
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
    replicationMocks.addEventStorageMock.mockReset().mockResolvedValue(undefined);
    replicationMocks.projectReplicatedEventMock.mockReset().mockResolvedValue('inserted');
    replicationMocks.getEventPortMock.mockReset().mockResolvedValue(null);
    replicationMocks.appendEventDataMock.mockReset().mockResolvedValue({
      id: sampleEvent.id,
      timestamp: Date.parse(sampleEvent.createdAt),
      content: sampleEvent.content,
      tags: new Set(['note']),
      metadata: sampleEvent.metadata,
    });
    replicationMocks.getEventStorageMock.mockReset().mockReturnValue({
      addEvent: replicationMocks.addEventStorageMock,
      getEvent: vi.fn(async () => sampleEvent),
      projectReplicatedEvent: replicationMocks.projectReplicatedEventMock,
    });
    replicationMocks.getEventlogBackendModeMock.mockReset().mockReturnValue('legacy');
    replicationMocks.runtimeModeMock.mockReset().mockReturnValue('tauri');
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
      payload: EventLogReplicationAppendedPayload;
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
    const payload: EventLogReplicationAppendedPayload = {
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

  it('appends to RT eventlog instead of Pouch EventStorage in rt-sqlite mode', async () => {
    replicationMocks.getEventlogBackendModeMock.mockReturnValue('rt-sqlite');

    await appendEventWithEcsReplication({
      id: 'evt-block-start',
      content: 'Focus started',
      createdAt: '2026-03-12T08:00:00.000Z',
      type: 'block_start',
      metadata: {
        source: {
          app: 'ExoMind',
          deviceId: 'desktop-1',
          deviceName: 'Desktop',
          platform: 'Windows',
        },
      },
    });

    expect(replicationMocks.addEventStorageMock).not.toHaveBeenCalled();
    expect(replicationMocks.appendEventDataMock).toHaveBeenCalledWith({
      id: 'evt-block-start',
      timestamp: Date.parse('2026-03-12T08:00:00.000Z'),
      content: 'Focus started',
      tags: ['block_start'],
      metadata: {
        source: {
          app: 'ExoMind',
          deviceId: 'desktop-1',
          deviceName: 'Desktop',
          platform: 'Windows',
        },
      },
    });
  });

  it('appends to RT eventlog in web runtime when backend is rt-sqlite', async () => {
    replicationMocks.runtimeModeMock.mockReturnValue('web');
    replicationMocks.getEventlogBackendModeMock.mockReturnValue('rt-sqlite');

    await appendEventWithEcsReplication({
      id: 'evt-web-rt-001',
      content: 'web runtime rt append',
      createdAt: '2026-03-26T10:00:00.000Z',
      type: 'task_created',
    });

    expect(replicationMocks.addEventStorageMock).not.toHaveBeenCalled();
    expect(replicationMocks.appendEventDataMock).toHaveBeenCalledWith({
      id: 'evt-web-rt-001',
      timestamp: Date.parse('2026-03-26T10:00:00.000Z'),
      content: 'web runtime rt append',
      tags: ['task_created'],
      metadata: undefined,
    });
  });

  it('projects replicated payload into RT eventlog in web runtime when backend is rt-sqlite', async () => {
    replicationMocks.runtimeModeMock.mockReturnValue('web');
    replicationMocks.getEventlogBackendModeMock.mockReturnValue('rt-sqlite');
    replicationMocks.getEventPortMock.mockResolvedValue(null);
    const payload: EventLogReplicationAppendedPayload = {
      schemaVersion: 1,
      replicationSeq: 108,
      cursor: {
        kind: 'replication_seq',
        value: 108,
      },
      event: {
        ...sampleEvent,
        id: 'evt-web-rt-remote-001',
        createdAt: '2026-03-26T10:05:00.000Z',
        type: 'task_cancelled',
        replicationSeq: 108,
      },
    };

    await expect(projectEventLogReplicationAppend(payload)).resolves.toBe('inserted');

    expect(replicationMocks.projectReplicatedEventMock).not.toHaveBeenCalled();
    expect(replicationMocks.appendEventDataMock).toHaveBeenCalledWith({
      id: 'evt-web-rt-remote-001',
      timestamp: Date.parse('2026-03-26T10:05:00.000Z'),
      content: sampleEvent.content,
      tags: ['task_cancelled'],
      metadata: sampleEvent.metadata,
    });
  });
});
