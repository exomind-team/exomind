import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeBlockData } from '@/lib/types/event';

const mocks = vi.hoisted(() => ({
  getCurrentProfileOrLegacyIdMock: vi.fn(),
  applyReplicationCompletedBlockMock: vi.fn(),
}));

vi.mock('@/lib/profile/profile-storage', () => ({
  getCurrentProfileOrLegacyId: mocks.getCurrentProfileOrLegacyIdMock,
}));

vi.mock('@/lib/adapters/timeblock-rt-adapter', () => ({
  TimeBlockRtAdapter: class MockTimeBlockRtAdapter {
    applyReplicationCompletedBlock = mocks.applyReplicationCompletedBlockMock;
  },
}));

import {
  projectTimeBlockCompletedReplication,
  type TimeBlockCompletedReplicationPayload,
} from '@/lib/services/ecs-timeblock-completed-replication.service';

describe('ecs-timeblock-completed-replication.service', () => {
  const sampleBlock: TimeBlockData = {
    id: 'tb-rep-1',
    name: 'Replicated block',
    startId: 'tb-rep-1',
    endId: 'end-rep-1',
    note: 'done',
    tags: ['block_feedback'],
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_060_000,
    blockType: 'active',
    taskIds: [],
    taskAssociationLog: [],
    transitions: [],
  };

  beforeEach(() => {
    mocks.getCurrentProfileOrLegacyIdMock.mockReset().mockReturnValue('profile-local');
    mocks.applyReplicationCompletedBlockMock.mockReset().mockResolvedValue('inserted');
  });

  it('projects completed timeblock into local RT adapter（把已完成时间块复制快照投影进本地 RT）', async () => {
    const payload: TimeBlockCompletedReplicationPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-local',
      cursor: {
        kind: 'timeblock_completed',
        blockId: sampleBlock.startId,
        completedAt: sampleBlock.endTime,
        originHostId: 'desktop-host',
      },
      block: sampleBlock,
    };

    await expect(projectTimeBlockCompletedReplication(payload)).resolves.toBe('inserted');
    expect(mocks.applyReplicationCompletedBlockMock).toHaveBeenCalledWith(sampleBlock);
  });

  it('ignores completed timeblock from another profile scope（不同档案作用域的已完成时间块不应串档）', async () => {
    const payload: TimeBlockCompletedReplicationPayload = {
      schemaVersion: 1,
      scopeKey: 'profile-remote',
      cursor: {
        kind: 'timeblock_completed',
        blockId: sampleBlock.startId,
        completedAt: sampleBlock.endTime,
        originHostId: 'desktop-host',
      },
      block: sampleBlock,
    };

    await expect(projectTimeBlockCompletedReplication(payload)).resolves.toBe('ignored');
    expect(mocks.applyReplicationCompletedBlockMock).not.toHaveBeenCalled();
  });
});
