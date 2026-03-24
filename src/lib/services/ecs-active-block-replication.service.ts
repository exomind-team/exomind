import { getTimeblockBackendMode } from '@/config/domain-backend-mode';
import { getSelectedRuntimeTarget } from '@/config/runtime-target';
import { getActiveBlockStorage } from '@/lib/storage/active-block-storage';
import type { ActiveBlockData } from '@/lib/types/event';
import { SignalStreamService } from './signal-stream.service';
import { getTimeBlockService } from './timeblock.service';

export const ACTIVE_BLOCK_REPLICATION_SNAPSHOT_TOPIC = 'active_block.replication.snapshot';

export interface ActiveBlockReplicationCursor {
  kind: 'active_block_snapshot';
  startId: string;
  version: number;
  lastTransitionAt: number;
  actorId?: string;
}

export interface ActiveBlockReplicationSnapshotPayload {
  schemaVersion: 1;
  block: ActiveBlockData;
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

function buildReplicationPayload(block: ActiveBlockData): ActiveBlockReplicationSnapshotPayload {
  return {
    schemaVersion: 1,
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

export async function publishActiveBlockReplicationSnapshot(block: ActiveBlockData): Promise<void> {
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

export async function projectActiveBlockReplicationSnapshot(
  payload: ActiveBlockReplicationSnapshotPayload,
  userId?: string,
): Promise<void> {
  if (getTimeblockBackendMode() === 'rt-sqlite') {
    await getTimeBlockService().applyReplicatedActiveBlock(payload.block);
    return;
  }
  await getActiveBlockStorage(userId).projectReplicatedActiveBlock(payload.block);
}
