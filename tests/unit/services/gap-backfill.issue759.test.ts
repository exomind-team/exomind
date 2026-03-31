/**
 * #759 Phase 1: Historical gap backfill
 *
 * Given a list of completed TimeBlockData sorted by startTime,
 * generate gap blocks to fill the spaces between adjacent blocks.
 */
import { describe, test, expect } from 'vitest';
import type { TimeBlockData } from '@/lib/types/event';

// This function doesn't exist yet — it's what we're building
import { generateGapBlocks } from '@/lib/services/gap-backfill';

describe('#759 gap backfill', () => {
  test('generates a gap block between two adjacent active blocks', () => {
    const blocks: TimeBlockData[] = [
      {
        id: 'tb-1', name: 'Morning focus', startId: 's1', endId: 'e1',
        tags: [], startTime: 1000, endTime: 2000, blockType: 'active',
      },
      {
        id: 'tb-2', name: 'Afternoon focus', startId: 's2', endId: 'e2',
        tags: [], startTime: 3000, endTime: 4000, blockType: 'active',
      },
    ];

    const gaps = generateGapBlocks(blocks);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].blockType).toBe('gap');
    expect(gaps[0].startTime).toBe(2000); // end of first block
    expect(gaps[0].endTime).toBe(3000);   // start of second block
    expect(gaps[0].name).toBe('');
    expect(gaps[0].tags).toEqual([]);
  });

  test('generates no gap when blocks are contiguous (zero gap)', () => {
    const blocks: TimeBlockData[] = [
      {
        id: 'tb-1', name: 'A', startId: 's1', endId: 'e1',
        tags: [], startTime: 1000, endTime: 2000, blockType: 'active',
      },
      {
        id: 'tb-2', name: 'B', startId: 's2', endId: 'e2',
        tags: [], startTime: 2000, endTime: 3000, blockType: 'active',
      },
    ];

    const gaps = generateGapBlocks(blocks);

    // Zero-duration gaps are still created to maintain chain structure
    expect(gaps).toHaveLength(1);
    expect(gaps[0].startTime).toBe(2000);
    expect(gaps[0].endTime).toBe(2000);
  });

  test('generates multiple gaps for multiple blocks', () => {
    const blocks: TimeBlockData[] = [
      { id: 'tb-1', name: 'A', startId: 's1', endId: 'e1', tags: [], startTime: 1000, endTime: 2000, blockType: 'active' },
      { id: 'tb-2', name: 'B', startId: 's2', endId: 'e2', tags: [], startTime: 3000, endTime: 4000, blockType: 'active' },
      { id: 'tb-3', name: 'C', startId: 's3', endId: 'e3', tags: [], startTime: 6000, endTime: 7000, blockType: 'active' },
    ];

    const gaps = generateGapBlocks(blocks);

    expect(gaps).toHaveLength(2);
    expect(gaps[0].startTime).toBe(2000);
    expect(gaps[0].endTime).toBe(3000);
    expect(gaps[1].startTime).toBe(4000);
    expect(gaps[1].endTime).toBe(6000);
  });

  test('returns empty array for single block', () => {
    const blocks: TimeBlockData[] = [
      { id: 'tb-1', name: 'A', startId: 's1', endId: 'e1', tags: [], startTime: 1000, endTime: 2000, blockType: 'active' },
    ];

    const gaps = generateGapBlocks(blocks);
    expect(gaps).toHaveLength(0);
  });

  test('returns empty array for no blocks', () => {
    const gaps = generateGapBlocks([]);
    expect(gaps).toHaveLength(0);
  });

  test('gap blocks have unique IDs', () => {
    const blocks: TimeBlockData[] = [
      { id: 'tb-1', name: 'A', startId: 's1', endId: 'e1', tags: [], startTime: 1000, endTime: 2000, blockType: 'active' },
      { id: 'tb-2', name: 'B', startId: 's2', endId: 'e2', tags: [], startTime: 3000, endTime: 4000, blockType: 'active' },
      { id: 'tb-3', name: 'C', startId: 's3', endId: 'e3', tags: [], startTime: 5000, endTime: 6000, blockType: 'active' },
    ];

    const gaps = generateGapBlocks(blocks);

    const ids = gaps.map(g => g.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('skips blocks that already have blockType gap', () => {
    const blocks: TimeBlockData[] = [
      { id: 'tb-1', name: 'A', startId: 's1', endId: 'e1', tags: [], startTime: 1000, endTime: 2000, blockType: 'active' },
      { id: 'gap-existing', name: '', startId: 'sg', endId: 'eg', tags: [], startTime: 2000, endTime: 3000, blockType: 'gap' },
      { id: 'tb-2', name: 'B', startId: 's2', endId: 'e2', tags: [], startTime: 3000, endTime: 4000, blockType: 'active' },
    ];

    const gaps = generateGapBlocks(blocks);

    // No new gaps needed — existing gap already fills the space
    expect(gaps).toHaveLength(0);
  });

  test('treats blocks without blockType as active (migration compat)', () => {
    const blocks: TimeBlockData[] = [
      { id: 'tb-1', name: 'A', startId: 's1', endId: 'e1', tags: [], startTime: 1000, endTime: 2000 },
      { id: 'tb-2', name: 'B', startId: 's2', endId: 'e2', tags: [], startTime: 3000, endTime: 4000 },
    ];

    const gaps = generateGapBlocks(blocks);

    expect(gaps).toHaveLength(1);
    expect(gaps[0].blockType).toBe('gap');
  });
});
