import { TimeBlockRtAdapter } from '@/lib/adapters/timeblock-rt-adapter';
import { getCurrentProfileOrLegacyId } from '@/lib/profile/profile-storage';
import type { TimeBlockData } from '@/lib/types/event';

export const TIMEBLOCK_REPLICATION_COMPLETED_TOPIC = 'timeblock.replication.completed';

export interface TimeBlockCompletedReplicationCursor {
  kind: 'timeblock_completed';
  blockId: string;
  completedAt: number;
  originHostId?: string;
}

export interface TimeBlockCompletedReplicationPayload {
  schemaVersion: 1;
  scopeKey?: string;
  cursor: TimeBlockCompletedReplicationCursor;
  block: TimeBlockData;
}

export type ProjectReplicatedTimeBlockResult = 'inserted' | 'ignored';

export async function projectTimeBlockCompletedReplication(
  payload: TimeBlockCompletedReplicationPayload,
  userId?: string,
): Promise<ProjectReplicatedTimeBlockResult> {
  const currentScopeKey = userId ?? getCurrentProfileOrLegacyId();
  if (typeof payload.scopeKey === 'string' && payload.scopeKey.length > 0 && payload.scopeKey !== currentScopeKey) {
    return 'ignored';
  }

  const adapter = new TimeBlockRtAdapter();
  return adapter.applyReplicationCompletedBlock(payload.block);
}
