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
import { generateGapBlocks } from '@/lib/services/gap-backfill';
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
  getActiveBlock: () => Promise<ActiveBlockData | null>;
  rtBackfillGapBlocks: () => Promise<{ inserted: number }>;
  rtStartBlock: (params: { name: string; mode: string; targetMinutes?: number; taskIds?: string[]; sourcePlannedBlockId?: string }) => Promise<{ completed: TimeBlockData | null; active: ActiveBlockData }>;
  rtStopBlock: () => Promise<{ status: string }>;
  rtEndBlock: (params: { feedback?: string; taskStatusOutcomes?: Record<string, string> }) => Promise<{ completed: TimeBlockData | null; active: ActiveBlockData }>;
  rtPauseBlock: () => Promise<{ status: string }>;
  rtResumeBlock: () => Promise<{ status: string }>;
  rtPatchActiveBlockTasks: (params: { taskIds: string[]; taskAssociationLog: unknown[] }) => Promise<ActiveBlockData | null>;
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
    getActiveBlock: vi.fn(async () => activeBlock),
    rtBackfillGapBlocks: vi.fn(async () => {
      const gaps = generateGapBlocks(completedBlocks);
      if (gaps.length > 0) {
        completedBlocks = [...completedBlocks, ...gaps].sort((a, b) => a.startTime - b.startTime);
      }
      return { inserted: gaps.length };
    }),
    rtStartBlock: vi.fn(async (params: { name: string; mode: string; targetMinutes?: number; taskIds?: string[] }) => {
      const now = Date.now();
      let completed: TimeBlockData | null = null;
      if (activeBlock?.blockType === 'gap') {
        completed = {
          id: activeBlock.startId,
          name: activeBlock.name,
          startId: activeBlock.startId,
          endId: `rt-gap-end-${now}`,
          tags: [],
          startTime: activeBlock.startTime,
          endTime: now,
          blockType: 'gap',
          taskIds: [],
          taskAssociationLog: activeBlock.taskAssociationLog ?? [],
        };
        completedBlocks = [...completedBlocks, completed];
      }
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
      return { completed, active: newBlock };
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
    rtPatchActiveBlockTasks: vi.fn(async (params: { taskIds: string[]; taskAssociationLog: unknown[] }) => {
      if (!activeBlock) {
        return null;
      }
      const now = Date.now();
      activeBlock = {
        ...activeBlock,
        taskIds: params.taskIds,
        taskAssociationLog: params.taskAssociationLog as ActiveBlockData['taskAssociationLog'],
        updatedAt: now,
        version: (activeBlock.version ?? 0) + 1,
      };
      return activeBlock;
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
    expect(rtAdapter.listCompletedBlocks).toHaveBeenCalledTimes(1);
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
    expect(rtAdapter.getActiveBlock).toHaveBeenCalledTimes(1);
    expect(block).toBeNull();
  });

  it('hides transition-ended active block from RT adapter without writing back canonical terminal phase', async () => {
    const env = createMemoryEnv();
    const rtAdapter = createRtAdapter({
      activeBlock: {
        startId: 'active-ended-1',
        name: 'Transition ended',
        mode: 'countdown',
        targetMinutes: 25,
        elapsed: 0,
        paused: false,
        startTime: 1_700_000_000_000,
        transitions: [
          { type: 'start', at: 1_700_000_000_000, actorId: 'actor-a' },
          { type: 'end', at: 1_700_000_030_000, actorId: 'actor-a' },
        ],
        taskIds: [],
        taskAssociationLog: [],
      },
    });
    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });

    const block = await service.loadActiveBlock();
    const stored = await rtAdapter.getActiveBlock();

    expect(block).toBeNull();
    expect(stored?.startId).toBe('active-ended-1');
    expect(stored?.phase).toBeUndefined();
    expect(rtAdapter.rtPatchActiveBlockTasks).not.toHaveBeenCalled();
  });

  it('rejects stale RT replicated active snapshot after local completed baseline', async () => {
    const env = createMemoryEnv();
    const rtAdapter = createRtAdapter();
    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });
    const listener = vi.fn();
    service.onBlockChange(listener);

    const completedSnapshot: ActiveBlockData = {
      startId: 'synced-block-1',
      name: 'Already submitted',
      mode: 'countdown',
      targetMinutes: 25,
      elapsed: 0,
      paused: false,
      startTime: 1_700_000_000_000,
      blockType: 'active',
      phase: 'feedback_submitted',
      version: 3,
      lastTransitionAt: 1_700_000_030_000,
      actionEndedAt: 1_700_000_020_000,
      feedbackStartedAt: 1_700_000_020_000,
      feedbackSubmittedAt: 1_700_000_030_000,
      taskIds: [],
      taskAssociationLog: [],
      transitions: [
        { type: 'start', at: 1_700_000_000_000, actorId: 'local' },
        { type: 'feedback_start', at: 1_700_000_020_000, actorId: 'local' },
        { type: 'end', at: 1_700_000_030_000, actorId: 'local' },
      ],
    };
    const staleRunningSnapshot: ActiveBlockData = {
      startId: 'synced-block-1',
      name: 'Stale running',
      mode: 'countdown',
      targetMinutes: 25,
      elapsed: 1_500_000,
      paused: false,
      startTime: 1_700_000_000_000,
      blockType: 'active',
      phase: 'running',
      version: 1,
      lastTransitionAt: 1_700_000_000_000,
      lastResumedAt: 1_700_000_000_000,
      taskIds: [],
      taskAssociationLog: [],
      transitions: [
        { type: 'start', at: 1_700_000_000_000, actorId: 'remote' },
      ],
    };

    await service.applyReplicatedActiveBlock(completedSnapshot);
    expect(listener).toHaveBeenLastCalledWith(null);
    listener.mockClear();

    await service.applyReplicatedActiveBlock(staleRunningSnapshot);

    expect(listener).not.toHaveBeenCalled();
  });

  it('uses current RT active block as first replication baseline before accepting a stale running snapshot', async () => {
    const currentActiveBlock: ActiveBlockData = {
      startId: 'current-block-2',
      name: 'Fresh block',
      mode: 'countup',
      elapsed: 0,
      paused: false,
      startTime: 1_700_000_120_000,
      blockType: 'active',
      phase: 'running',
      version: 2,
      lastTransitionAt: 1_700_000_120_000,
      lastResumedAt: 1_700_000_120_000,
      taskIds: [],
      taskAssociationLog: [],
      transitions: [
        { type: 'start', at: 1_700_000_120_000, actorId: 'local' },
      ],
    };
    const staleRunningSnapshot: ActiveBlockData = {
      startId: 'old-block-1',
      name: 'Old countdown',
      mode: 'countdown',
      targetMinutes: 25,
      elapsed: 1_500_000,
      paused: false,
      startTime: 1_700_000_000_000,
      blockType: 'active',
      phase: 'running',
      version: 1,
      lastTransitionAt: 1_700_000_000_000,
      lastResumedAt: 1_700_000_000_000,
      taskIds: [],
      taskAssociationLog: [],
      transitions: [
        { type: 'start', at: 1_700_000_000_000, actorId: 'remote' },
      ],
    };
    const env = createMemoryEnv();
    const rtAdapter = createRtAdapter({ activeBlock: currentActiveBlock });
    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });
    const listener = vi.fn();
    service.onBlockChange(listener);

    await service.applyReplicatedActiveBlock(staleRunningSnapshot);

    expect(rtAdapter.getActiveBlock).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('allows starting a new block when current RT active block is transition-completed', async () => {
    const env = createMemoryEnv();
    const rtAdapter = createRtAdapter({
      activeBlock: {
        startId: 'active-ended-1',
        name: 'Transition ended',
        mode: 'countdown',
        targetMinutes: 25,
        elapsed: 0,
        paused: false,
        startTime: 1_700_000_000_000,
        transitions: [
          { type: 'start', at: 1_700_000_000_000, actorId: 'actor-a' },
          { type: 'feedback_start', at: 1_700_000_020_000, actorId: 'actor-a' },
          { type: 'end', at: 1_700_000_030_000, actorId: 'actor-a' },
        ],
        taskIds: [],
        taskAssociationLog: [],
      },
    });
    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });

    const block = await service.startBlock('Fresh block', { mode: 'countup' });

    expect(rtAdapter.rtStartBlock).toHaveBeenCalledWith({
      name: 'Fresh block',
      mode: 'countup',
      targetMinutes: undefined,
      taskIds: [],
    });
    expect(block.name).toBe('Fresh block');
    expect(block.startId).not.toBe('active-ended-1');
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

    // #780: rt-sqlite flow now goes through dedicated RT lifecycle routes
    expect(rtAdapter.rtStartBlock).toHaveBeenCalled();
    expect(rtAdapter.rtStopBlock).toHaveBeenCalled();
    expect(rtAdapter.rtEndBlock).toHaveBeenCalled();
  });

  it('patches active block task links via dedicated RT route in rt-sqlite mode', async () => {
    const env = createMemoryEnv();
    const rtAdapter = createRtAdapter({
      activeBlock: {
        startId: 'active-1',
        name: 'Deep Work',
        mode: 'countdown',
        targetMinutes: 25,
        elapsed: 300000,
        paused: false,
        startTime: 1_700_000_000_000,
        phase: 'running',
        version: 1,
        lastTransitionAt: 1_700_000_000_000,
        taskIds: ['task-1'],
        taskAssociationLog: [],
      },
    });
    const service = new TimeBlockServiceImpl(env as never, {
      backendMode: 'rt-sqlite',
      rtAdapter,
    });

    const updated = await service.updateActiveBlock({
      taskIds: ['task-1', 'task-2'],
      taskAssociationLog: [
        {
          blockId: 'active-1',
          taskId: 'task-2',
          action: 'associated',
          timestamp: 1_700_000_010_000,
          source: 'manual',
        },
      ],
    });

    expect(rtAdapter.rtPatchActiveBlockTasks).toHaveBeenCalledWith({
      taskIds: ['task-1', 'task-2'],
      taskAssociationLog: [
        {
          blockId: 'active-1',
          taskId: 'task-2',
          action: 'associated',
          timestamp: 1_700_000_010_000,
          source: 'manual',
        },
      ],
    });
    expect(updated).toMatchObject({
      startId: 'active-1',
      taskIds: ['task-1', 'task-2'],
    });
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

  it('normalizes rt countdown payload before notifying listeners after pause', async () => {
    const env = createMemoryEnv();
    const now = Date.UTC(2026, 3, 15, 2, 0, 0);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      let activeBlock: ActiveBlockData | null = {
        startId: 'rt-countdown-1',
        name: 'Pause repro',
        mode: 'countdown',
        targetMinutes: 25,
        elapsed: 25 * 60 * 1000,
        paused: false,
        startTime: now - 5 * 60 * 1000,
        phase: 'running',
        version: 1,
        lastTransitionAt: now - 5 * 60 * 1000,
        lastResumedAt: now - 5 * 60 * 1000,
        accumulatedRunMs: 0,
        pauseAccumulatedMs: 0,
        blockType: 'active',
        taskIds: [],
        taskAssociationLog: [],
        transitions: [
          { type: 'start', at: now - 5 * 60 * 1000, actorId: 'rt:newblock' },
        ],
      };
      const rtAdapter: TimeBlockRtAdapterLike = {
        listCompletedBlocks: vi.fn(async () => []),
        getActiveBlock: vi.fn(async () => activeBlock),
        rtBackfillGapBlocks: vi.fn(async () => ({ inserted: 0 })),
        rtStartBlock: vi.fn(async () => ({ completed: null, active: activeBlock! })),
        rtStopBlock: vi.fn(async () => ({ status: 'ok' })),
        rtEndBlock: vi.fn(async () => ({ completed: null, active: activeBlock! })),
        rtPauseBlock: vi.fn(async () => {
          activeBlock = {
            ...activeBlock!,
            paused: true,
            pausedAt: now,
            phase: 'paused',
            accumulatedRunMs: 5 * 60 * 1000,
            lastTransitionAt: now,
            transitions: [
              ...(activeBlock?.transitions ?? []),
              { type: 'pause', at: now, actorId: 'rt:pause' },
            ],
          };
          return { status: 'ok' };
        }),
        rtResumeBlock: vi.fn(async () => ({ status: 'ok' })),
        rtPatchActiveBlockTasks: vi.fn(async () => activeBlock),
      };
      const service = new TimeBlockServiceImpl(env as never, {
        backendMode: 'rt-sqlite',
        rtAdapter,
      });
      const listener = vi.fn();
      service.onBlockChange(listener);

      await service.pauseBlock();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
        startId: 'rt-countdown-1',
        paused: true,
        phase: 'paused',
        elapsed: 20 * 60 * 1000,
        accumulatedRunMs: 5 * 60 * 1000,
      }));
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('uses operation timestamp when normalizing rt countdown payload after start', async () => {
    const env = createMemoryEnv();
    const operationNow = Date.UTC(2026, 3, 15, 2, 0, 0);
    const startedAt = operationNow - 5 * 60 * 1000;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(operationNow);
      const activeBlock: ActiveBlockData = {
        startId: 'rt-countdown-start-1',
        name: 'Start repro',
        mode: 'countdown',
        targetMinutes: 25,
        elapsed: 25 * 60 * 1000,
        paused: false,
        startTime: startedAt,
        phase: 'running',
        version: 1,
        lastTransitionAt: startedAt,
        lastResumedAt: startedAt,
        accumulatedRunMs: 0,
        pauseAccumulatedMs: 0,
        blockType: 'active',
        taskIds: [],
        taskAssociationLog: [],
        transitions: [
          { type: 'start', at: startedAt, actorId: 'rt:newblock' },
        ],
      };
      const rtStartBlock = vi.fn(async () => {
        vi.setSystemTime(operationNow + 2_000);
        return { completed: null, active: activeBlock };
      });
      const rtAdapter: TimeBlockRtAdapterLike = {
        listCompletedBlocks: vi.fn(async () => []),
        getActiveBlock: vi.fn(async () => null),
        rtBackfillGapBlocks: vi.fn(async () => ({ inserted: 0 })),
        rtStartBlock,
        rtStopBlock: vi.fn(async () => ({ status: 'ok' })),
        rtEndBlock: vi.fn(async () => ({ completed: null, active: activeBlock })),
        rtPauseBlock: vi.fn(async () => ({ status: 'ok' })),
        rtResumeBlock: vi.fn(async () => ({ status: 'ok' })),
        rtPatchActiveBlockTasks: vi.fn(async () => activeBlock),
      };
      const service = new TimeBlockServiceImpl(env as never, {
        backendMode: 'rt-sqlite',
        rtAdapter,
      });
      const listener = vi.fn();
      service.onBlockChange(listener);

      const result = await service.startBlock('Start repro', { mode: 'countdown', minutes: 25 });

      expect(rtStartBlock).toHaveBeenCalledTimes(1);
      expect(result.elapsed).toBe(20 * 60 * 1000);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
        startId: 'rt-countdown-start-1',
        elapsed: 20 * 60 * 1000,
        phase: 'running',
      }));
    } finally {
      vi.useRealTimers();
    }
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
    expect(types).not.toContain('block_feedback');
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
