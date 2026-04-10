import { getTimeblockBackendMode } from '@/config/domain-backend-mode';
import { getSelectedRuntimeTarget } from '@/config/runtime-target';
import { getCurrentProfileOrLegacyId } from '@/lib/profile/profile-storage';
import { getActiveBlockStorage } from '@/lib/storage/active-block-storage';
import type { TimeBlockData } from '@/lib/types/event';
import { SignalStreamService } from './signal-stream.service';
import { getTimeBlockService } from './timeblock.service';

export const ACTIVE_BLOCK_REPLICATION_SNAPSHOT_TOPIC = 'active_block.replication.snapshot';
export const TIMEBLOCK_ACTIVE_REPLICATION_UPSERTED_TOPIC = 'timeblock.replication.active_upserted';

export interface ActiveBlockReplicationCursor {
  kind: 'active_block_snapshot' | 'timeblock_active';
  startId: string;
  version?: number;
  updatedAt?: number;
  lastTransitionAt?: number;
  actorId?: string;
  originHostId?: string;
}

export interface ActiveBlockReplicationSnapshotPayload {
  schemaVersion: 1;
  scopeKey?: string;
  block?: TimeBlockData;
  active?: TimeBlockData;
  cursor: ActiveBlockReplicationCursor;
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

function buildReplicationPayload(block: TimeBlockData): ActiveBlockReplicationSnapshotPayload {
  return {
    schemaVersion: 1,
    scopeKey: getCurrentProfileOrLegacyId(),
    block,
    cursor: {
      kind: 'active_block_snapshot',
      startId: block.startId,
      version: block.version ?? 0,
      lastTransitionAt: block.lastTransitionAt ?? block.startTime,
      actorId: block.actorId,
    },
  };
}

export async function publishActiveBlockReplicationSnapshot(block: TimeBlockData): Promise<void> {
  const signalPublisher = new SignalStreamService({
    host: buildRuntimeHostRecord(),
    agentId: 'ui',
  });

  await signalPublisher.publish({
    topic: ACTIVE_BLOCK_REPLICATION_SNAPSHOT_TOPIC,
    source: 'frontend:timeblock-ecs',
    payload: buildReplicationPayload(block),
  });
}

export function getReplicatedActiveBlock(
  payload: ActiveBlockReplicationSnapshotPayload,
): TimeBlockData | null {
  return payload.block ?? payload.active ?? null;
}

export async function projectActiveBlockReplicationSnapshot(
  payload: ActiveBlockReplicationSnapshotPayload,
  userId?: string,
): Promise<void> {
  const currentScopeKey = userId ?? getCurrentProfileOrLegacyId();
  if (typeof payload.scopeKey === 'string' && payload.scopeKey.length > 0 && payload.scopeKey !== currentScopeKey) {
    return;
  }

  const block = getReplicatedActiveBlock(payload);
  if (!block) {
    return;
  }

  if (getTimeblockBackendMode() === 'rt-sqlite') {
    await getTimeBlockService().applyReplicatedActiveBlock(block);
    return;
  }
  await getActiveBlockStorage(userId).projectReplicatedActiveBlock(block);
}
