import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentProfileOrLegacyIdMock: vi.fn(),
  applyReplicationSnapshotMock: vi.fn(),
}));

vi.mock('@/lib/profile/profile-storage', () => ({
  getCurrentProfileOrLegacyId: mocks.getCurrentProfileOrLegacyIdMock,
}));

vi.mock('@/lib/adapters/reminder-rt-adapter', () => ({
  ReminderRtAdapter: class MockReminderRtAdapter {
    applyReplicationSnapshot = mocks.applyReplicationSnapshotMock;
  },
}));

import {
  projectReminderReplicationUpsert,
  type ReminderReplicationUpsertedPayload,
} from '@/lib/services/ecs-reminder-replication.service';

describe('ecs-reminder-replication.service', () => {
  beforeEach(() => {
    mocks.getCurrentProfileOrLegacyIdMock.mockReset().mockReturnValue('profile-local');
    mocks.applyReplicationSnapshotMock.mockReset().mockResolvedValue('inserted');
  });

  it('projects replicated reminder into local RT adapter（把远端提醒复制快照投影进本地 RT）', async () => {
    const payload: ReminderReplicationUpsertedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'reminder_snapshot',
        reminderId: 'reminder-1',
        updatedAt: 1_700_000_001_000,
        originHostId: 'desktop-host',
      },
      reminder: {
        id: 'reminder-1',
        title: 'Replicated reminder',
        content: 'from peer',
        dueAt: 1_700_000_100_000,
        status: 'pending',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
      },
    };

    await expect(projectReminderReplicationUpsert(payload)).resolves.toBe('inserted');
    expect(mocks.applyReplicationSnapshotMock).toHaveBeenCalledWith(payload.reminder, 'desktop-host');
  });

  it('ignores replicated reminder from another profile scope（不同档案作用域的提醒快照不应串档）', async () => {
    const payload: ReminderReplicationUpsertedPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-remote',
      cursor: {
        kind: 'reminder_snapshot',
        reminderId: 'reminder-1',
        updatedAt: 1_700_000_001_000,
        originHostId: 'desktop-host',
      },
      reminder: {
        id: 'reminder-1',
        title: 'Replicated reminder',
        content: 'from peer',
        dueAt: 1_700_000_100_000,
        status: 'pending',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
      },
    };

    await expect(projectReminderReplicationUpsert(payload)).resolves.toBe('ignored');
    expect(mocks.applyReplicationSnapshotMock).not.toHaveBeenCalled();
  });
});
