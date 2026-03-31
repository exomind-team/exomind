/**
 * #759 Phase 1: blockType field on TimeBlockData and ActiveBlockData
 *
 * blockType: 'active' | 'gap'
 * - 'active' = user-initiated (work or break)
 * - 'gap' = auto-created between active blocks
 */
import { describe, test, expect } from 'vitest';
import type { TimeBlockData, ActiveBlockData } from '@/lib/types/event';

describe('#759 Phase 1: blockType field', () => {
  test('TimeBlockData accepts blockType "active"', () => {
    const block: TimeBlockData = {
      id: 'tb-1',
      name: 'Focus session',
      startId: 'start-1',
      endId: 'end-1',
      tags: ['block_feedback'],
      startTime: 1700000000000,
      endTime: 1700003600000,
      blockType: 'active',
    };
    expect(block.blockType).toBe('active');
  });

  test('TimeBlockData accepts blockType "gap"', () => {
    const block: TimeBlockData = {
      id: 'gap-1',
      name: '',
      startId: 'start-gap',
      endId: 'end-gap',
      tags: [],
      startTime: 1700003600000,
      endTime: 1700007200000,
      blockType: 'gap',
    };
    expect(block.blockType).toBe('gap');
  });

  test('TimeBlockData blockType is optional (backward compat)', () => {
    const block: TimeBlockData = {
      id: 'old-1',
      name: 'Legacy block',
      startId: 'start-old',
      endId: 'end-old',
      tags: [],
      startTime: 1700000000000,
      endTime: 1700003600000,
    };
    expect(block.blockType).toBeUndefined();
  });

  test('ActiveBlockData accepts blockType "active"', () => {
    const active: ActiveBlockData = {
      startId: 'active-1',
      name: 'Working',
      mode: 'countup',
      elapsed: 0,
      startTime: 1700000000000,
      paused: false,
      taskIds: [],
      taskAssociationLog: [],
      blockType: 'active',
    };
    expect(active.blockType).toBe('active');
  });

  test('ActiveBlockData accepts blockType "gap"', () => {
    const active: ActiveBlockData = {
      startId: 'gap-active-1',
      name: '',
      mode: 'countup',
      elapsed: 0,
      startTime: 1700000000000,
      paused: false,
      taskIds: [],
      taskAssociationLog: [],
      blockType: 'gap',
    };
    expect(active.blockType).toBe('gap');
  });

  test('gap block has constrained fields', () => {
    const gap: ActiveBlockData = {
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
    // gap blocks: mode is always countup, no targetMinutes, no taskIds content
    expect(gap.mode).toBe('countup');
    expect(gap.targetMinutes).toBeUndefined();
    expect(gap.taskIds).toEqual([]);
    expect(gap.name).toBe('');
  });
});
