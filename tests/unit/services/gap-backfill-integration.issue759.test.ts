/**
 * #759: gap backfill integration — backfillGapBlocks() reads completed blocks,
 * generates gaps, and writes them back.
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

vi.mock('@/lib/storage/event-storage', () => ({ getEventStorage: getEventStorageMock }));
vi.mock('@/config/feedback-preferences', () => ({ getFeedbackPreferences: getFeedbackPreferencesMock }));
vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({ appendEventWithEcsReplication: appendEventWithEcsReplicationMock }));
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
import { generateGapBlocks } from '@/lib/services/gap-backfill';
import { TimeBlockServiceImpl } from '@/lib/services/timeblock.service';

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

function createRtAdapter(initial?: {
  completedBlocks?: TimeBlockData[];
  activeBlock?: ActiveBlockData | null;
}): TimeBlockRtAdapterLike {
  let completedBlocks: TimeBlockData[] = initial?.completedBlocks ?? [];
  let activeBlock: ActiveBlockData | null = initial?.activeBlock ?? null;
  return {
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
      const nextActive: ActiveBlockData = {
        startId: `rt-start-${now}`,
        name: params.name,
        mode: params.mode as 'countdown' | 'countup',
        targetMinutes: params.targetMinutes,
        elapsed: 0,
        paused: false,
        startTime: now,
        phase: 'running',
        version: 1,
        lastTransitionAt: now,
        taskIds: params.taskIds ?? [],
        taskAssociationLog: [],
      };
      activeBlock = nextActive;
      return { completed: null, active: nextActive };
    }),
    rtStopBlock: vi.fn(async () => ({ status: 'ok' })),
    rtEndBlock: vi.fn(async () => ({ completed: null, active: activeBlock ?? {
      startId: 'rt-gap',
      name: '',
      mode: 'countup',
      elapsed: 0,
      paused: false,
      startTime: Date.now(),
      blockType: 'gap',
      phase: 'running',
      version: 1,
      lastTransitionAt: Date.now(),
      taskIds: [],
      taskAssociationLog: [],
    } })),
    rtPauseBlock: vi.fn(async () => ({ status: 'ok' })),
    rtResumeBlock: vi.fn(async () => ({ status: 'ok' })),
    rtPatchActiveBlockTasks: vi.fn(async (params: { taskIds: string[]; taskAssociationLog: unknown[] }) => {
      if (!activeBlock) {
        return null;
      }
      activeBlock = {
        ...activeBlock,
        taskIds: params.taskIds,
        taskAssociationLog: params.taskAssociationLog as ActiveBlockData['taskAssociationLog'],
      };
      return activeBlock;
    }),
  };
}

describe('#759 gap backfill integration', () => {
  beforeEach(() => {
    addEventMock.mockReset();
    getEventStorageMock.mockReset();
    getEventStorageMock.mockReturnValue({ addEvent: addEventMock, getEvents: vi.fn().mockResolvedValue([]) });
    appendEventWithEcsReplicationMock.mockReset();
    appendEventWithEcsReplicationMock.mockImplementation(async (event: unknown) => event);
    getFeedbackPreferencesMock.mockReset();
    getFeedbackPreferencesMock.mockReturnValue({ timingInfoEnabled: true, statisticsEnabled: true, quickFeedbackEnabled: true });
  });

  it('backfillGapBlocks inserts gaps between adjacent active blocks', async () => {
    const blocks: TimeBlockData[] = [
      { id: 'tb-1', name: 'A', startId: 's1', endId: 'e1', tags: [], startTime: 1000, endTime: 2000, blockType: 'active' },
      { id: 'tb-2', name: 'B', startId: 's2', endId: 'e2', tags: [], startTime: 3000, endTime: 4000, blockType: 'active' },
      { id: 'tb-3', name: 'C', startId: 's3', endId: 'e3', tags: [], startTime: 6000, endTime: 7000, blockType: 'active' },
    ];
    const rtAdapter = createRtAdapter({ completedBlocks: blocks });
    const env = { storage: { async read() { return null; }, async write() {}, async delete() {} } };
    const service = new TimeBlockServiceImpl(env as never, { backendMode: 'rt-sqlite', rtAdapter });

    const count = await service.backfillGapBlocks();

    expect(count).toBe(2);
    expect(rtAdapter.rtBackfillGapBlocks).toHaveBeenCalledTimes(1);

    const updated = await rtAdapter.listCompletedBlocks();
    expect(updated).toHaveLength(5); // 3 active + 2 gaps
    const gaps = updated.filter(b => b.blockType === 'gap');
    expect(gaps).toHaveLength(2);
    expect(gaps[0].startTime).toBe(2000);
    expect(gaps[0].endTime).toBe(3000);
    expect(gaps[1].startTime).toBe(4000);
    expect(gaps[1].endTime).toBe(6000);
  });

  it('backfillGapBlocks returns 0 when no gaps needed', async () => {
    const blocks: TimeBlockData[] = [
      { id: 'tb-1', name: 'A', startId: 's1', endId: 'e1', tags: [], startTime: 1000, endTime: 2000, blockType: 'active' },
      { id: 'gap-1', name: '', startId: 'sg', endId: 'eg', tags: [], startTime: 2000, endTime: 3000, blockType: 'gap' },
      { id: 'tb-2', name: 'B', startId: 's2', endId: 'e2', tags: [], startTime: 3000, endTime: 4000, blockType: 'active' },
    ];
    const rtAdapter = createRtAdapter({ completedBlocks: blocks });
    const env = { storage: { async read() { return null; }, async write() {}, async delete() {} } };
    const service = new TimeBlockServiceImpl(env as never, { backendMode: 'rt-sqlite', rtAdapter });

    const count = await service.backfillGapBlocks();

    expect(count).toBe(0);
    expect(rtAdapter.rtBackfillGapBlocks).toHaveBeenCalledTimes(1);
    const updated = await rtAdapter.listCompletedBlocks();
    expect(updated).toHaveLength(3); // unchanged
  });

  it('backfillGapBlocks treats blocks without blockType as active', async () => {
    const blocks: TimeBlockData[] = [
      { id: 'tb-1', name: 'A', startId: 's1', endId: 'e1', tags: [], startTime: 1000, endTime: 2000 },
      { id: 'tb-2', name: 'B', startId: 's2', endId: 'e2', tags: [], startTime: 3000, endTime: 4000 },
    ];
    const rtAdapter = createRtAdapter({ completedBlocks: blocks });
    const env = { storage: { async read() { return null; }, async write() {}, async delete() {} } };
    const service = new TimeBlockServiceImpl(env as never, { backendMode: 'rt-sqlite', rtAdapter });

    const count = await service.backfillGapBlocks();

    expect(count).toBe(1);
    expect(rtAdapter.rtBackfillGapBlocks).toHaveBeenCalledTimes(1);
    const updated = await rtAdapter.listCompletedBlocks();
    const gaps = updated.filter(b => b.blockType === 'gap');
    expect(gaps).toHaveLength(1);
  });
});
