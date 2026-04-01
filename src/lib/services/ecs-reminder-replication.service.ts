import { ReminderRtAdapter } from '@/lib/adapters/reminder-rt-adapter';
import { getCurrentProfileOrLegacyId } from '@/lib/profile/profile-storage';
import type { Reminder } from '@/lib/types/reminder';

export const REMINDER_REPLICATION_UPSERTED_TOPIC = 'reminder.replication.upserted';

export interface ReminderReplicationCursor {
  kind: 'reminder_snapshot';
  reminderId: string;
  updatedAt: number;
  originHostId?: string;
}

export interface ReminderReplicationUpsertedPayload {
  schemaVersion: 1;
  scopeKey?: string;
  cursor: ReminderReplicationCursor;
  reminder: Reminder;
}

export type ProjectReplicatedReminderResult = 'inserted' | 'updated' | 'ignored';

export async function projectReminderReplicationUpsert(
  payload: ReminderReplicationUpsertedPayload,
  userId?: string,
): Promise<ProjectReplicatedReminderResult> {
  const currentScopeKey = userId ?? getCurrentProfileOrLegacyId();
  if (typeof payload.scopeKey === 'string' && payload.scopeKey.length > 0 && payload.scopeKey !== currentScopeKey) {
    return 'ignored';
  }

  const adapter = new ReminderRtAdapter();
  return adapter.applyReplicationSnapshot(payload.reminder, payload.cursor.originHostId);
}
