import { getEventlogBackendMode } from '@/config/domain-backend-mode';
import { getSelectedRuntimeTarget } from '@/config/runtime-target';
import { ExoMindEnvironment } from '@/lib/environment/environment';
import {
  getEventStorage,
  type Event as StorageEvent,
  type ProjectReplicatedEventResult,
} from '@/lib/storage/event-storage';
import type { EventData } from '@/lib/types/event';
import { getEventLogService } from './eventlog.service';
import { SignalStreamService } from './signal-stream.service';
import { log } from '@/lib/logger';

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
    authToken: runtimeTarget.authToken,
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

function storageEventToEventData(event: StorageEvent): EventData {
  const parsedTimestamp = Date.parse(event.createdAt);
  return {
    id: event.id,
    timestamp: Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp,
    content: event.content,
    tags: typeof event.type === 'string' && event.type.length > 0 ? [event.type] : ['note'],
    metadata: event.metadata,
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
  const environment = ExoMindEnvironment.getInstance();
  if (environment.runtime === 'tauri' && getEventlogBackendMode() === 'rt-sqlite') {
    await getEventLogService().appendEventData(storageEventToEventData(event));
    return event;
  }

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
    log.warn(`[EventLog ECS] publish append failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return persisted;
}

export async function projectEventLogReplicationAppend(
  payload: EventLogReplicationAppendedPayload,
  userId?: string,
): Promise<ProjectReplicatedEventResult> {
  const environment = ExoMindEnvironment.getInstance();
  if (environment.runtime === 'tauri' && getEventlogBackendMode() === 'rt-sqlite') {
    const existing = await environment.eventlog.getEvent(payload.event.id);
    if (existing) {
      return 'duplicate';
    }
    await getEventLogService().appendEventData(storageEventToEventData(payload.event));
    return 'inserted';
  }
  return getEventStorage(userId).projectReplicatedEvent(payload.event);
}
