/**
 * #759 Phase 2: newBlock primitive — endBlock creates gap, startBlock truncates gap
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  getEventStorageMock,
  addEventMock,
  getFeedbackPreferencesMock,
  appendEventWithEcsReplicationMock,
} = vi.hoisted(() => ({
  getEventStorageMock: vi.fn(),
  addEventMock: vi.fn(),
  getFeedbackPreferencesMock: vi.fn(),
  appendEventWithEcsReplicationMock: vi.fn(async (event: unknown) => event),
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
  SignalStreamService: class { async publish() { return { accepted: true, event_id: 'mock' }; } },
}));

import type { ActiveBlockData, TimeBlockData } from '@/lib/types/event';
import { TimeBlockServiceImpl } from '@/lib/services/timeblock.service';

type TimeBlockRtAdapterLike = {
  listCompletedBlocks: () => Promise<TimeBlockData[]>;
  replaceCompletedBlocks: (blocks: TimeBlockData[]) => Promise<void>;
  getActiveBlock: () => Promise<ActiveBlockData | null>;
  putActiveBlock: (block: ActiveBlockData) => Promise<void>;
  deleteActiveBlock: () => Promise<void>;
};

function createMemoryEnv() {
  const data = new Map<string, unknown>();
  return {
    storage: {
      async read<T>(key: string) { return (data.has(key) ? data.get(key) : null) as T | null; },
      async write(key: string, value: unknown) { data.set(key, value); },
      async delete(key: string) { data.delete(key); },
    },
  };
}

function createRtAdapter(initial?: {
  completedBlocks?: TimeBlockData[];
  activeBlock?: ActiveBlockData | null;
}): TimeBlockRtAdapterLike {
  let completedBlocks: TimeBlockData[] = initial?.completedBlocks ?? [];
  let activeBlock: ActiveBlockData | null = initial?.activeBlock ?? null;
  return {
    listCompletedBlocks: vi.fn(async () => completedBlocks),
    replaceCompletedBlocks: vi.fn(async (blocks: TimeBlockData[]) => { completedBlocks = blocks; }),
    getActiveBlock: vi.fn(async () => activeBlock),
    putActiveBlock: vi.fn(async (block: ActiveBlockData) => { activeBlock = block; }),
    deleteActiveBlock: vi.fn(async () => { activeBlock = null; }),
  };
}

function createService(rtAdapter: TimeBlockRtAdapterLike) {
  const env = createMemoryEnv();
  return new TimeBlockServiceImpl(env as never, {
    backendMode: 'rt-sqlite',
    rtAdapter,
  });
}

describe('#759 Phase 2: newBlock primitive', () => {
  beforeEach(() => {
    addEventMock.mockReset();
    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({
      addEvent: addEventMock,
      getEvents: vi.fn().mockResolvedValue([]),
    });
    appendEventWithEcsReplicationMock.mockReset();
    appendEventWithEcsReplicationMock.mockImplementation(async (event: unknown) => event);
    getFeedbackPreferencesMock.mockReset();
    getFeedbackPreferencesMock.mockReturnValue({
      timingInfoEnabled: true,
      statisticsEnabled: true,
      quickFeedbackEnabled: true,
    });
  });

  it('endBlock creates a gap block as new activeBlock instead of null', async () => {
    const now = 1700000000000;
    const activeBlock: ActiveBlockData = {
      startId: 'active-1',
      name: 'Focus session',
      mode: 'countup',
      elapsed: 0,
      startTime: now,
      paused: false,
      taskIds: [],
      taskAssociationLog: [],
      blockType: 'active',
      phase: 'running',
      version: 1,
    };
    const rtAdapter = createRtAdapter({ activeBlock });
    const service = createService(rtAdapter);

    // End the block with feedback
    await service.endBlock('done');

    // KEY ASSERTION: After endBlock, the RT adapter should hold a gap block
    const currentActive = await rtAdapter.getActiveBlock();
    expect(currentActive).not.toBeNull();
    expect(currentActive?.blockType).toBe('gap');
    expect(currentActive?.mode).toBe('countup');
    expect(currentActive?.name).toBe('');
    expect(currentActive?.taskIds).toEqual([]);
  });

  it('startBlock during gap truncates gap and saves it as completed', async () => {
    const gapStart = 1700003600000;
    const gapBlock: ActiveBlockData = {
      startId: 'gap-1',
      name: '',
      mode: 'countup',
      elapsed: 0,
      startTime: gapStart,
      paused: false,
      taskIds: [],
      taskAssociationLog: [],
      blockType: 'gap',
    };
    const rtAdapter = createRtAdapter({ activeBlock: gapBlock });
    const service = createService(rtAdapter);

    // Start a new active block while in a gap
    const newActive = await service.startBlock(
      'New focus',
      { mode: 'countup' },
    );

    // The new block should be active
    expect(newActive.blockType).toBe('active');
    expect(newActive.name).toBe('New focus');

    // The gap should have been saved as a completed block
    const completed = await rtAdapter.listCompletedBlocks();
    const completedGap = completed.find(b => b.blockType === 'gap');
    expect(completedGap).toBeDefined();
    expect(completedGap?.startTime).toBe(gapStart);
  });

  it('startBlock guard allows starting during gap', async () => {
    const gapBlock: ActiveBlockData = {
      startId: 'gap-1',
      name: '',
      mode: 'countup',
      elapsed: 0,
      startTime: 1700000000000,
      paused: false,
      taskIds: [],
      taskAssociationLog: [],
      blockType: 'gap',
    };
    const rtAdapter = createRtAdapter({ activeBlock: gapBlock });
    const service = createService(rtAdapter);

    // Should NOT return the existing gap block (which would mean "rejected")
    const result = await service.startBlock('New work', { mode: 'countup' });
    expect(result.name).toBe('New work');
    expect(result.startId).not.toBe('gap-1');
  });
});
