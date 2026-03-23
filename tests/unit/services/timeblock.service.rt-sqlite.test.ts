import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getEventStorageMock,
  addEventMock,
  getFeedbackPreferencesMock,
} = vi.hoisted(() => ({
  getEventStorageMock: vi.fn(),
  addEventMock: vi.fn(),
  getFeedbackPreferencesMock: vi.fn(),
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getEventStorage: getEventStorageMock,
}));

vi.mock('@/config/feedback-preferences', () => ({
  getFeedbackPreferences: getFeedbackPreferencesMock,
}));

vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: vi.fn(async (event) => event),
}));

vi.mock('@/lib/services/ecs-active-block-replication.service', () => ({
  publishActiveBlockReplicationSnapshot: vi.fn(async () => undefined),
  projectActiveBlockReplicationSnapshot: vi.fn(async () => undefined),
}));

vi.mock('@/config/runtime-target', () => ({
  getSelectedRuntimeTarget: vi.fn(() => ({ mode: 'embedded', host: '127.0.0.1', port: 9124 })),
}));

vi.mock('@/lib/services/signal-stream.service', () => ({
  SignalStreamService: class MockSignalStreamService {
    async publish() {
      return { accepted: true, event_id: 'mock-signal' };
    }
  },
}));

import type { ActiveBlockData, TimeBlockData } from '@/lib/types/event';
import { TimeBlockServiceImpl } from '@/lib/services/timeblock.service';

type MemoryEnv = {
  storage: {
    read: <T>(key: string) => Promise<T | null>;
    write: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };
};

type TimeBlockRtAdapterLike = {
  listCompletedBlocks: () => Promise<TimeBlockData[]>;
  replaceCompletedBlocks: (blocks: TimeBlockData[]) => Promise<void>;
  getActiveBlock: () => Promise<ActiveBlockData | null>;
  putActiveBlock: (block: ActiveBlockData) => Promise<void>;
  deleteActiveBlock: () => Promise<void>;
};

function createMemoryEnv(initial: Record<string, unknown> = {}): MemoryEnv {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    storage: {
      async read<T>(key: string) {
        return (data.has(key) ? data.get(key) : null) as T | null;
      },
      async write(key: string, value: unknown) {
        data.set(key, value);
      },
      async delete(key: string) {
        data.delete(key);
      },
    },
  };
}

function createRtAdapter(): TimeBlockRtAdapterLike {
  let completedBlocks: TimeBlockData[] = [];
  let activeBlock: ActiveBlockData | null = null;
  return {
    listCompletedBlocks: vi.fn(async () => completedBlocks),
    replaceCompletedBlocks: vi.fn(async (blocks: TimeBlockData[]) => {
      completedBlocks = blocks;
    }),
    getActiveBlock: vi.fn(async () => activeBlock),
    putActiveBlock: vi.fn(async (block: ActiveBlockData) => {
      activeBlock = block;
    }),
    deleteActiveBlock: vi.fn(async () => {
      activeBlock = null;
    }),
  };
}

describe('TimeBlockServiceImpl rt-sqlite backend', () => {
  beforeEach(() => {
    addEventMock.mockReset();
    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({
      addEvent: addEventMock,
      getEvents: vi.fn().mockResolvedValue([]),
    });
    getFeedbackPreferencesMock.mockReset();
    getFeedbackPreferencesMock.mockReturnValue({
      timingInfoEnabled: true,
      statisticsEnabled: true,
      quickFeedbackEnabled: true,
    });
  });

  it('returns empty list when RT adapter has no completed blocks (no lazy migration)', async () => {
    const legacyBlocks: TimeBlockData[] = [
      {
        id: 'tb-legacy',
        name: 'Legacy block',
        startId: 'start-legacy',
        endId: 'end-legacy',
        note: 'legacy',
        tags: ['block_feedback'],
        startTime: 1700000000000,
        endTime: 1700000060000,
      },
    ];
    // Legacy data exists in env.storage, but rt-sqlite backend should NOT read it
    const env = createMemoryEnv({ time_blocks: legacyBlocks });
    const rtAdapter = createRtAdapter();

    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });

    const blocks = await service.loadTimeBlocks();

    // Migration is now handled by MigrationDialog, not lazily by the service
    expect(rtAdapter.replaceCompletedBlocks).not.toHaveBeenCalled();
    expect(blocks).toEqual([]);
  });

  it('returns null when RT adapter has no active block (no lazy migration)', async () => {
    const legacyActive: ActiveBlockData = {
      startId: 'active-legacy',
      name: 'Legacy active',
      mode: 'countdown',
      targetMinutes: 25,
      elapsed: 120000,
      paused: false,
      startTime: 1700000000000,
    };
    // Legacy data exists in env.storage, but rt-sqlite backend should NOT read it
    const env = createMemoryEnv({ active_block: legacyActive });
    const rtAdapter = createRtAdapter();

    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });

    const block = await service.loadActiveBlock();

    // Migration is now handled by MigrationDialog, not lazily by the service
    expect(rtAdapter.putActiveBlock).not.toHaveBeenCalled();
    expect(block).toBeNull();
  });

  it('writes new active block and completed block to RT adapter when ending a block', async () => {
    const env = createMemoryEnv();
    const rtAdapter = createRtAdapter();
    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });

    await service.startBlock('Deep Work', { mode: 'countup' });
    await service.markEnding();
    await service.endBlock('done');

    expect(rtAdapter.putActiveBlock).toHaveBeenCalled();
    expect(rtAdapter.replaceCompletedBlocks).toHaveBeenCalled();
  });
});
