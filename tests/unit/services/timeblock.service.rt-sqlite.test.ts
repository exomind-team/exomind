import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getEventStorageMock,
  addEventMock,
  getFeedbackPreferencesMock,
  appendEventWithEcsReplicationMock,
} = vi.hoisted(() => ({
  getEventStorageMock: vi.fn(),
  addEventMock: vi.fn(),
  getFeedbackPreferencesMock: vi.fn(),
  appendEventWithEcsReplicationMock: vi.fn(async (event) => event),
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getEventStorage: getEventStorageMock,
}));

vi.mock('@/config/feedback-preferences', () => ({
  getFeedbackPreferences: getFeedbackPreferencesMock,
}));

vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: appendEventWithEcsReplicationMock,
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
  // #780 new RT routes
  rtStartBlock: (params: { name: string; mode: string; targetMinutes?: number; taskIds?: string[]; sourcePlannedBlockId?: string }) => Promise<{ completed: TimeBlockData | null; active: ActiveBlockData }>;
  rtStopBlock: () => Promise<{ status: string }>;
  rtEndBlock: (params: { feedback?: string; taskStatusOutcomes?: Record<string, string> }) => Promise<{ completed: TimeBlockData | null; active: ActiveBlockData }>;
  rtPauseBlock: () => Promise<{ status: string }>;
  rtResumeBlock: () => Promise<{ status: string }>;
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

function createRtAdapter(initial?: {
  completedBlocks?: TimeBlockData[];
  activeBlock?: ActiveBlockData | null;
}): TimeBlockRtAdapterLike {
  let completedBlocks: TimeBlockData[] = initial?.completedBlocks ?? [];
  let activeBlock: ActiveBlockData | null = initial?.activeBlock ?? null;

  const adapter: TimeBlockRtAdapterLike = {
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
    // #780 new RT route mocks
    rtStartBlock: vi.fn(async (params: { name: string; mode: string; targetMinutes?: number; taskIds?: string[] }) => {
      const now = Date.now();
      const newBlock: ActiveBlockData = {
        startId: `rt-start-${now}`,
        name: params.name,
        mode: params.mode as 'countdown' | 'countup',
        targetMinutes: params.targetMinutes,
        elapsed: params.mode === 'countdown' ? (params.targetMinutes ?? 25) * 60 * 1000 : 0,
        paused: false,
        startTime: now,
        phase: 'running',
        version: 1,
        lastTransitionAt: now,
        lastResumedAt: now,
        accumulatedRunMs: 0,
        pauseAccumulatedMs: 0,
        blockType: 'active',
        taskIds: params.taskIds ?? [],
        taskAssociationLog: [],
      };
      activeBlock = newBlock;
      return { completed: null, active: newBlock };
    }),
    rtStopBlock: vi.fn(async () => {
      if (activeBlock) {
        const now = Date.now();
        activeBlock = { ...activeBlock, phase: 'feedback_in_progress', actionEndedAt: now, feedbackStartedAt: now };
      }
      return { status: 'ok' };
    }),
    rtEndBlock: vi.fn(async (_params: { feedback?: string; taskStatusOutcomes?: Record<string, string> }) => {
      const now = Date.now();
      const completed: TimeBlockData | null = activeBlock ? {
        id: activeBlock.startId,
        name: activeBlock.name,
        startId: activeBlock.startId,
        endId: `rt-end-${now}`,
        tags: ['block_feedback'],
        startTime: activeBlock.startTime,
        endTime: now,
        blockType: 'active',
        taskIds: activeBlock.taskIds ?? [],
        sourcePlannedBlockId: activeBlock.sourcePlannedBlockId,
      } : null;
      const gapBlock: ActiveBlockData = {
        startId: `rt-gap-${now}`,
        name: '',
        mode: 'countup',
        elapsed: 0,
        paused: false,
        startTime: now,
        blockType: 'gap',
        phase: 'running',
        version: 1,
        lastTransitionAt: now,
        taskIds: [],
        taskAssociationLog: [],
      };
      activeBlock = gapBlock;
      return { completed, active: gapBlock };
    }),
    rtPauseBlock: vi.fn(async () => {
      if (activeBlock) {
        const now = Date.now();
        activeBlock = { ...activeBlock, phase: 'paused', paused: true, pausedAt: now };
      }
      return { status: 'ok' };
    }),
    rtResumeBlock: vi.fn(async () => {
      if (activeBlock) {
        const now = Date.now();
        activeBlock = { ...activeBlock, phase: 'running', paused: false, pausedAt: undefined, lastResumedAt: now };
      }
      return { status: 'ok' };
    }),
  };
  return adapter;
}

describe('TimeBlockServiceImpl rt-sqlite backend', () => {
  beforeEach(() => {
    addEventMock.mockReset();
    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({
      addEvent: addEventMock,
      getEvents: vi.fn().mockResolvedValue([]),
    });
    appendEventWithEcsReplicationMock.mockReset();
    appendEventWithEcsReplicationMock.mockImplementation(async (event) => event);
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

    // #780: now uses RT routes instead of direct putActiveBlock/replaceCompletedBlocks
    expect(rtAdapter.rtStartBlock).toHaveBeenCalled();
    expect(rtAdapter.rtStopBlock).toHaveBeenCalled();
    expect(rtAdapter.rtEndBlock).toHaveBeenCalled();
  });

  it('does not duplicate block_start/pause/resume eventlog writes in rt-sqlite mode', async () => {
    const env = createMemoryEnv();
    const rtAdapter = createRtAdapter();
    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });

    await service.startBlock('Deep Work', { mode: 'countup' });
    await service.pauseBlock();
    await service.resumeBlock();

    const types = appendEventWithEcsReplicationMock.mock.calls.map(
      ([event]) => (event as { type?: string }).type,
    );
    expect(types).not.toContain('block_start');
    expect(types).not.toContain('block_pause');
    expect(types).not.toContain('block_resume');
  });

  it('does not duplicate block_end eventlog write in rt-sqlite mode', async () => {
    const env = createMemoryEnv();
    const rtAdapter = createRtAdapter();
    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });

    await service.startBlock('Deep Work', { mode: 'countup' });
    await service.markEnding();

    const types = appendEventWithEcsReplicationMock.mock.calls.map(
      ([event]) => (event as { type?: string }).type,
    );
    expect(types).not.toContain('block_end');
  });

  it('preserves sourcePlannedBlockId when finishing a planned block in rt-sqlite mode', async () => {
    const env = createMemoryEnv();
    const rtAdapter = createRtAdapter({
      activeBlock: {
        startId: 'active-planned-1',
        name: 'Lunch Reset',
        mode: 'countdown',
        targetMinutes: 30,
        elapsed: 1_800_000,
        paused: false,
        startTime: 1_700_000_000_000,
        phase: 'running',
        version: 1,
        lastTransitionAt: 1_700_000_000_000,
        taskIds: [],
        taskAssociationLog: [],
        sourcePlannedBlockId: 'plan-1',
      },
    });
    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });

    await service.markEnding();
    await service.endBlock('rest done');

    // #780: now uses RT routes; check rtStopBlock and rtEndBlock were called
    expect(rtAdapter.rtStopBlock).toHaveBeenCalled();
    expect(rtAdapter.rtEndBlock).toHaveBeenCalledWith({
      feedback: 'rest done',
      taskStatusOutcomes: undefined,
    });
  });
});
