import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveBlockData } from '@/lib/types/event';

const mocks = vi.hoisted(() => ({
  applyReplicatedActiveBlock: vi.fn(),
}));

vi.mock('@/lib/services/timeblock.service', () => ({
  getTimeBlockService: () => ({
    applyReplicatedActiveBlock: mocks.applyReplicatedActiveBlock,
  }),
}));

import { TodayPlannerServiceImpl } from '@/lib/services/today-planner.service';

describe('TodayPlannerServiceImpl（今日计划服务）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs runtime start results into local TimeBlockService after starting a work segment（开始工作片段后同步本地活跃块）', async () => {
    const activeBlock: ActiveBlockData = {
      startId: 'active-segment-1',
      name: 'Deep Work A',
      mode: 'countdown',
      elapsed: 0,
      startTime: 1_774_573_600_000,
      paused: false,
      phase: 'running',
      version: 1,
      lastTransitionAt: 1_774_573_600_000,
      taskIds: ['task-a'],
      taskAssociationLog: [],
      targetMinutes: 45,
      sourcePlannedBlockId: 'segment-1',
    };
    const rtAdapter = {
      startWorkSegment: vi.fn().mockResolvedValue(activeBlock),
    };
    const service = new TodayPlannerServiceImpl(rtAdapter as never);

    const result = await service.startWorkSegment('segment-1');

    expect(rtAdapter.startWorkSegment).toHaveBeenCalledWith('segment-1');
    expect(mocks.applyReplicatedActiveBlock).toHaveBeenCalledWith(activeBlock);
    expect(result).toEqual(activeBlock);
  });
});
