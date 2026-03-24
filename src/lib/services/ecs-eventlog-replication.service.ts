import { getEventlogBackendMode } from '@/config/domain-backend-mode';
import { getSelectedRuntimeTarget } from '@/config/runtime-target';
import { ExoMindEnvironment } from '@/lib/environment/environment';
import {
  getEventStorage,
  type Event as StorageEvent,
  type ProjectReplicatedEventResult,
} from '@/lib/storage/event-storage';
import type { Event as EventLogEvent, EventData } from '@/lib/types/event';
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

export type AppendableStorageEvent = Omit<StorageEvent, 'id'> & { id?: string };

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

function ensureStorageEventId(event: AppendableStorageEvent): StorageEvent {
  if (typeof event.id === 'string' && event.id.length > 0) {
    return {
      ...event,
      id: event.id,
    };
  }

  return {
    ...event,
    id: crypto.randomUUID(),
  };
}

function storageEventToEventData(event: AppendableStorageEvent): EventData {
  const normalized = ensureStorageEventId(event);
  const parsedTimestamp = Date.parse(normalized.createdAt);
  return {
    id: normalized.id,
    timestamp: Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp,
    content: normalized.content,
    tags: typeof normalized.type === 'string' && normalized.type.length > 0 ? [normalized.type] : ['note'],
    metadata: normalized.metadata,
  };
}

function eventLogEventToStorageEvent(event: EventLogEvent): StorageEvent {
  const firstTag = Array.from(event.tags)[0];
  return {
    id: event.id,
    content: event.content,
    createdAt: new Date(event.timestamp).toISOString(),
    type: typeof firstTag === 'string' && firstTag.length > 0 ? firstTag : 'note',
    metadata: event.metadata as Record<string, unknown> | undefined,
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

export async function appendEventWithEcsReplication(event: AppendableStorageEvent, userId?: string): Promise<StorageEvent> {
  const environment = ExoMindEnvironment.getInstance();
  if (environment.runtime === 'tauri' && getEventlogBackendMode() === 'rt-sqlite') {
    const persisted = await getEventLogService().appendEventData(storageEventToEventData(event));
    return eventLogEventToStorageEvent(persisted);
  }

  const normalized = ensureStorageEventId(event);
  const storage = getEventStorage(userId);
  await storage.addEvent(normalized);

  if (typeof (storage as { getEvent?: unknown }).getEvent !== 'function') {
    return normalized;
  }

  const persisted = await storage.getEvent(normalized.id);
  if (!persisted) {
    throw new Error(`eventlog append succeeded but reload failed（写入后重读失败）: ${normalized.id}`);
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
