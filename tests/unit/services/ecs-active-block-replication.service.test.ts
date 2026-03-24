import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTimeblockBackendMode: vi.fn(),
  projectReplicatedActiveBlock: vi.fn(),
  applyReplicatedActiveBlock: vi.fn(),
}));

vi.mock('@/config/domain-backend-mode', () => ({
  getTimeblockBackendMode: mocks.getTimeblockBackendMode,
}));

vi.mock('@/lib/storage/active-block-storage', () => ({
  getActiveBlockStorage: vi.fn(() => ({
    projectReplicatedActiveBlock: mocks.projectReplicatedActiveBlock,
  })),
}));

vi.mock('@/lib/services/timeblock.service', () => ({
  getTimeBlockService: () => ({
    applyReplicatedActiveBlock: mocks.applyReplicatedActiveBlock,
  }),
}));

vi.mock('@/config/runtime-target', () => ({
  getSelectedRuntimeTarget: vi.fn(() => ({ mode: 'embedded', host: '127.0.0.1', port: 1949 })),
}));

vi.mock('@/lib/services/signal-stream.service', () => ({
  SignalStreamService: class MockSignalStreamService {
    async publish() {
      return { accepted: true };
    }
  },
}));

import { projectActiveBlockReplicationSnapshot } from '@/lib/services/ecs-active-block-replication.service';

describe('ecs-active-block-replication.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects replicated active block into TimeBlockService in rt-sqlite mode', async () => {
    mocks.getTimeblockBackendMode.mockReturnValue('rt-sqlite');

    await projectActiveBlockReplicationSnapshot({
      schemaVersion: 1,
      block: {
        startId: 'active-1',
        name: 'RT block',
        mode: 'countup',
        elapsed: 1000,
        paused: false,
        startTime: 1700000000000,
      },
      cursor: {
        kind: 'active_block_snapshot',
        startId: 'active-1',
        version: 1,
        lastTransitionAt: 1700000000000,
      },
    });

    expect(mocks.applyReplicatedActiveBlock).toHaveBeenCalledWith(expect.objectContaining({ startId: 'active-1' }));
    expect(mocks.projectReplicatedActiveBlock).not.toHaveBeenCalled();
  });
});
