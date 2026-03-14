import { describe, expect, it } from 'vitest';
import {
  detectLegacyData,
  detectRtIsEmpty,
  type LegacyDataReaders,
  type RtDataReaders,
} from '@/lib/migration/legacy-migration-detector';

// --- helpers ---

function makeLegacyReaders(overrides: Partial<LegacyDataReaders> = {}): LegacyDataReaders {
  return {
    readLegacyEvents: async () => [],
    readLegacyTasks: async () => [],
    readLegacyCompletedBlocks: async () => [],
    readLegacyActiveBlock: async () => null,
    ...overrides,
  };
}

function makeRtReaders(overrides: Partial<RtDataReaders> = {}): RtDataReaders {
  return {
    readRtEvents: async () => [],
    readRtTasks: async () => [],
    readRtCompletedBlocks: async () => [],
    readRtActiveBlock: async () => null,
    ...overrides,
  };
}

// --- detectLegacyData ---

describe('detectLegacyData（检测旧数据）', () => {
  it('no legacy data → returns all zero counts and hasAnyData false（没有旧数据返回全零）', async () => {
    const summary = await detectLegacyData(makeLegacyReaders());

    expect(summary.eventlogCount).toBe(0);
    expect(summary.taskCount).toBe(0);
    expect(summary.timeblockCount).toBe(0);
    expect(summary.hasActiveBlock).toBe(false);
    expect(summary.hasAnyData).toBe(false);
  });

  it('legacy events present → correct eventlogCount（检测到旧事件日志）', async () => {
    const readers = makeLegacyReaders({
      readLegacyEvents: async () => [{ id: '1' }, { id: '2' }, { id: '3' }],
    });

    const summary = await detectLegacyData(readers);

    expect(summary.eventlogCount).toBe(3);
    expect(summary.hasAnyData).toBe(true);
  });

  it('legacy tasks present → correct taskCount（检测到旧任务）', async () => {
    const readers = makeLegacyReaders({
      readLegacyTasks: async () => [{ id: 'task-1' }, { id: 'task-2' }],
    });

    const summary = await detectLegacyData(readers);

    expect(summary.taskCount).toBe(2);
    expect(summary.hasAnyData).toBe(true);
  });

  it('legacy completed blocks present → correct timeblockCount（检测到已完成时间块）', async () => {
    const readers = makeLegacyReaders({
      readLegacyCompletedBlocks: async () => [{ id: 'block-1' }],
    });

    const summary = await detectLegacyData(readers);

    expect(summary.timeblockCount).toBe(1);
    expect(summary.hasAnyData).toBe(true);
  });

  it('active block present → hasActiveBlock true（检测到活跃时间块）', async () => {
    const readers = makeLegacyReaders({
      readLegacyActiveBlock: async () => ({ id: 'active-block' }),
    });

    const summary = await detectLegacyData(readers);

    expect(summary.hasActiveBlock).toBe(true);
    expect(summary.hasAnyData).toBe(true);
  });

  it('all legacy data present → all counts correct（全部旧数据都存在）', async () => {
    const readers = makeLegacyReaders({
      readLegacyEvents: async () => [{ id: 'e1' }, { id: 'e2' }],
      readLegacyTasks: async () => [{ id: 't1' }],
      readLegacyCompletedBlocks: async () => [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }],
      readLegacyActiveBlock: async () => ({ id: 'active' }),
    });

    const summary = await detectLegacyData(readers);

    expect(summary.eventlogCount).toBe(2);
    expect(summary.taskCount).toBe(1);
    expect(summary.timeblockCount).toBe(3);
    expect(summary.hasActiveBlock).toBe(true);
    expect(summary.hasAnyData).toBe(true);
  });

  it('reader throws error → returns 0 for that source, does not throw（读取失败优雅降级为0）', async () => {
    const readers = makeLegacyReaders({
      readLegacyEvents: async () => { throw new Error('IndexedDB unavailable'); },
      readLegacyTasks: async () => [{ id: 't1' }],
    });

    const summary = await detectLegacyData(readers);

    expect(summary.eventlogCount).toBe(0);
    expect(summary.taskCount).toBe(1);
    expect(summary.hasAnyData).toBe(true);
  });

  it('all readers throw → returns zero summary and hasAnyData false（所有读取失败返回全零）', async () => {
    const fail = async (): Promise<unknown[]> => { throw new Error('storage error'); };
    const readers = makeLegacyReaders({
      readLegacyEvents: fail,
      readLegacyTasks: fail,
      readLegacyCompletedBlocks: fail,
      readLegacyActiveBlock: async () => { throw new Error('storage error'); },
    });

    const summary = await detectLegacyData(readers);

    expect(summary.eventlogCount).toBe(0);
    expect(summary.taskCount).toBe(0);
    expect(summary.timeblockCount).toBe(0);
    expect(summary.hasActiveBlock).toBe(false);
    expect(summary.hasAnyData).toBe(false);
  });
});

// --- detectRtIsEmpty ---

describe('detectRtIsEmpty（检测 RT 是否为空）', () => {
  it('all RT sources empty → returns true（RT 全空返回 true）', async () => {
    const isEmpty = await detectRtIsEmpty(makeRtReaders());
    expect(isEmpty).toBe(true);
  });

  it('RT has events → returns false（RT 有事件返回 false）', async () => {
    const readers = makeRtReaders({
      readRtEvents: async () => [{ id: 'rt-event-1' }],
    });

    const isEmpty = await detectRtIsEmpty(readers);
    expect(isEmpty).toBe(false);
  });

  it('RT has tasks → returns false（RT 有任务返回 false）', async () => {
    const readers = makeRtReaders({
      readRtTasks: async () => [{ id: 'rt-task-1' }],
    });

    const isEmpty = await detectRtIsEmpty(readers);
    expect(isEmpty).toBe(false);
  });

  it('RT has completed blocks → returns false（RT 有已完成时间块返回 false）', async () => {
    const readers = makeRtReaders({
      readRtCompletedBlocks: async () => [{ id: 'rt-block-1' }],
    });

    const isEmpty = await detectRtIsEmpty(readers);
    expect(isEmpty).toBe(false);
  });

  it('RT has active block → returns false（RT 有活跃时间块返回 false）', async () => {
    const readers = makeRtReaders({
      readRtActiveBlock: async () => ({ id: 'rt-active' }),
    });

    const isEmpty = await detectRtIsEmpty(readers);
    expect(isEmpty).toBe(false);
  });

  it('RT has data in multiple sources → returns false（RT 多个数据源有数据返回 false）', async () => {
    const readers = makeRtReaders({
      readRtEvents: async () => [{ id: 'e1' }],
      readRtTasks: async () => [{ id: 't1' }],
    });

    const isEmpty = await detectRtIsEmpty(readers);
    expect(isEmpty).toBe(false);
  });

  it('RT reader throws → treats as empty (conservative failure)（RT 读取失败视为空）', async () => {
    const readers = makeRtReaders({
      readRtEvents: async () => { throw new Error('network error'); },
    });

    const isEmpty = await detectRtIsEmpty(readers);
    expect(isEmpty).toBe(true);
  });

  it('all RT readers throw → returns true（RT 全部读取失败视为空）', async () => {
    const fail = async (): Promise<unknown[]> => { throw new Error('RT unavailable'); };
    const readers = makeRtReaders({
      readRtEvents: fail,
      readRtTasks: fail,
      readRtCompletedBlocks: fail,
      readRtActiveBlock: async () => { throw new Error('RT unavailable'); },
    });

    const isEmpty = await detectRtIsEmpty(readers);
    expect(isEmpty).toBe(true);
  });
});
