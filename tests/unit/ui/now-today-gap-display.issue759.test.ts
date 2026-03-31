/**
 * #759 Phase 3: gap blocks in today view
 */
import { describe, it, expect } from 'vitest';
import { buildNowTodayBlocksView } from '@/ui/app/pages/now-today-blocks-view';
import type { TimeBlock } from '@/lib/types/event';

const TODAY = new Date('2026-03-30T12:00:00');
const DAY_START = new Date('2026-03-30T00:00:00').getTime();

function makeBlock(overrides: Partial<TimeBlock> & { id: string; startTime: number; endTime: number }): TimeBlock {
  return {
    name: '',
    startId: overrides.id,
    endId: `end-${overrides.id}`,
    tags: new Set(),
    ...overrides,
  };
}

describe('#759 Phase 3: gap blocks in today view', () => {
  it('includes gap blocks in view items', () => {
    const blocks: TimeBlock[] = [
      makeBlock({ id: 'active-1', name: 'Focus', startTime: DAY_START + 3600000, endTime: DAY_START + 7200000, blockType: 'active' }),
      makeBlock({ id: 'gap-1', name: '', startTime: DAY_START + 7200000, endTime: DAY_START + 10800000, blockType: 'gap' }),
      makeBlock({ id: 'active-2', name: 'Work', startTime: DAY_START + 10800000, endTime: DAY_START + 14400000, blockType: 'active' }),
    ];

    const view = buildNowTodayBlocksView({ blocks, tasksById: new Map(), now: TODAY });

    expect(view.items).toHaveLength(3);
    const gapItem = view.items.find(item => item.blockType === 'gap');
    expect(gapItem).toBeDefined();
    expect(gapItem?.blockType).toBe('gap');
  });

  it('gap items have empty title and no linked tasks', () => {
    const blocks: TimeBlock[] = [
      makeBlock({ id: 'gap-1', name: '', startTime: DAY_START + 3600000, endTime: DAY_START + 7200000, blockType: 'gap' }),
    ];

    const view = buildNowTodayBlocksView({ blocks, tasksById: new Map(), now: TODAY });

    expect(view.items[0].blockType).toBe('gap');
    expect(view.items[0].title).toBe('');
    expect(view.items[0].linkedTasks).toEqual([]);
  });

  it('active items have blockType "active"', () => {
    const blocks: TimeBlock[] = [
      makeBlock({ id: 'active-1', name: 'Focus', startTime: DAY_START + 3600000, endTime: DAY_START + 7200000, blockType: 'active' }),
    ];

    const view = buildNowTodayBlocksView({ blocks, tasksById: new Map(), now: TODAY });

    expect(view.items[0].blockType).toBe('active');
  });

  it('blocks without blockType default to "active"', () => {
    const blocks: TimeBlock[] = [
      makeBlock({ id: 'old-1', name: 'Legacy', startTime: DAY_START + 3600000, endTime: DAY_START + 7200000 }),
    ];

    const view = buildNowTodayBlocksView({ blocks, tasksById: new Map(), now: TODAY });

    expect(view.items[0].blockType).toBe('active');
  });
});
