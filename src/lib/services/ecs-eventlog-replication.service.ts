import { getSelectedRuntimeTarget } from '@/config/runtime-target';
import {
  getEventStorage,
  type Event as StorageEvent,
  type ProjectReplicatedEventResult,
} from '@/lib/storage/event-storage';
import { SignalStreamService } from './signal-stream.service';

export const EVENTLOG_REPLICATION_APPENDED_TOPIC = 'eventlog.replication.appended';

export interface EventLogReplicationCursor {
  kind: 'replication_seq';
  value: number;
}

export interface EventLogReplicationAppendedPayload {
  schemaVersion: 1;
  replicationSeq: number;
  cursor: EventLogReplicationCursor;
  event: StorageEvent;
}

function buildRuntimeHostRecord() {
  const runtimeTarget = getSelectedRuntimeTarget();
  return {
    id: `runtime-${runtimeTarget.mode}-${runtimeTarget.host}-${runtimeTarget.port}`.replace(/[^\w-]/g, '-'),
    name: runtimeTarget.mode === 'embedded'
      ? 'Embedded Runtime（内嵌运行时）'
      : 'External Runtime（外部运行时）',
    host: runtimeTarget.host,
    port: runtimeTarget.port,
    status: 'unknown' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isLocal: runtimeTarget.mode === 'embedded',
  };
}

function buildReplicationPayload(event: StorageEvent): EventLogReplicationAppendedPayload {
  if (!Number.isInteger(event.replicationSeq) || (event.replicationSeq ?? 0) <= 0) {
    throw new Error(`eventlog replication requires replicationSeq（复制序号必填）: ${event.id}`);
  }

  return {
    schemaVersion: 1,
    replicationSeq: event.replicationSeq!,
    cursor: {
      kind: 'replication_seq',
      value: event.replicationSeq!,
    },
    event,
  };
}

export async function publishEventLogReplicationAppend(event: StorageEvent): Promise<void> {
  const signalPublisher = new SignalStreamService({
    host: buildRuntimeHostRecord(),
    agentId: 'ui',
  });

  await signalPublisher.publish({
    topic: EVENTLOG_REPLICATION_APPENDED_TOPIC,
    source: 'frontend:eventlog-ecs',
    payload: buildReplicationPayload(event),
  });
}

export async function appendEventWithEcsReplication(event: StorageEvent, userId?: string): Promise<StorageEvent> {
  const storage = getEventStorage(userId);
  await storage.addEvent(event);

  if (typeof (storage as { getEvent?: unknown }).getEvent !== 'function') {
    return event;
  }

  const persisted = await storage.getEvent(event.id);
  if (!persisted) {
    throw new Error(`eventlog append succeeded but reload failed（写入后重读失败）: ${event.id}`);
  }

  try {
    await publishEventLogReplicationAppend(persisted);
  } catch (error) {
    console.warn('[EventLog ECS] publish append failed:', error);
  }

  return persisted;
}

export async function projectEventLogReplicationAppend(
  payload: EventLogReplicationAppendedPayload,
  userId?: string,
): Promise<ProjectReplicatedEventResult> {
  return getEventStorage(userId).projectReplicatedEvent(payload.event);
}
