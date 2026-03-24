import { describe, expect, it } from 'vitest'
import {
  calculateTaskAssociationDurationMs,
  normalizeActiveBlockTaskIds,
  normalizeTimeBlockTaskIds,
  resolveActiveBlockTaskIds,
  resolveTimeBlockRelatedTaskIds,
  type BlockTaskAssociationEvent,
} from '@/lib/types/event'

describe('BlockTaskAssociationEvent type', () => {
  it('can be constructed with required fields', () => {
    const event: BlockTaskAssociationEvent = {
      blockId: 'block-1',
      taskId: 'task-1',
      action: 'associated',
      timestamp: Date.now(),
      source: 'block_start',
    }

    expect(event.action).toBe('associated')
    expect(event.source).toBe('block_start')
  })
})

describe('normalizeActiveBlockTaskIds', () => {
  it('converts legacy taskId to taskIds', () => {
    const legacy = { taskId: 'task-1' } as const

    const result = normalizeActiveBlockTaskIds(legacy)

    expect(result.taskIds).toEqual(['task-1'])
    expect(result.taskId).toBeUndefined()
  })

  it('preserves existing taskIds', () => {
    const modern = { taskIds: ['task-1', 'task-2'] } as const

    const result = normalizeActiveBlockTaskIds(modern)

    expect(result.taskIds).toEqual(['task-1', 'task-2'])
  })

  it('defaults to empty array when no task fields', () => {
    const empty = {} as const

    const result = normalizeActiveBlockTaskIds(empty)

    expect(result.taskIds).toEqual([])
  })

  it('replays association log when taskIds are missing', () => {
    const legacy = {
      taskAssociationLog: [
        { blockId: 'block-1', taskId: 'task-1', action: 'associated', timestamp: 1, source: 'block_start' },
        { blockId: 'block-1', taskId: 'task-2', action: 'associated', timestamp: 2, source: 'manual' },
        { blockId: 'block-1', taskId: 'task-1', action: 'disassociated', timestamp: 3, source: 'manual' },
      ],
    } as const

    const result = normalizeActiveBlockTaskIds(legacy)

    expect(result.taskIds).toEqual(['task-2'])
  })
})

describe('resolveActiveBlockTaskIds', () => {
  it('prefers explicit taskIds when present', () => {
    expect(resolveActiveBlockTaskIds({
      taskIds: ['task-1', 'task-2'],
      taskAssociationLog: [
        { blockId: 'block-1', taskId: 'task-3', action: 'associated', timestamp: 1, source: 'manual' },
      ],
    })).toEqual(['task-1', 'task-2'])
  })

  it('falls back to legacy taskId when no array or log exists', () => {
    expect(resolveActiveBlockTaskIds({ taskId: 'task-legacy' })).toEqual(['task-legacy'])
  })
})

describe('resolveTimeBlockRelatedTaskIds', () => {
  it('keeps tasks that were ever associated even if later disassociated', () => {
    expect(resolveTimeBlockRelatedTaskIds({
      taskIds: ['task-1'],
      taskAssociationLog: [
        { blockId: 'block-1', taskId: 'task-1', action: 'associated', timestamp: 1, source: 'block_start' },
        { blockId: 'block-1', taskId: 'task-2', action: 'associated', timestamp: 2, source: 'manual' },
        { blockId: 'block-1', taskId: 'task-2', action: 'disassociated', timestamp: 3, source: 'manual' },
      ],
    })).toEqual(['task-1', 'task-2'])
  })

  it('falls back to taskIds snapshot when no association log exists', () => {
    expect(resolveTimeBlockRelatedTaskIds({ taskIds: ['task-1', 'task-2'] })).toEqual(['task-1', 'task-2'])
  })
})

describe('calculateTaskAssociationDurationMs', () => {
  it('returns only the intervals where the task was actually associated', () => {
    expect(calculateTaskAssociationDurationMs({
      startTime: 0,
      endTime: 60 * 60_000,
      taskAssociationLog: [
        { blockId: 'block-1', taskId: 'task-1', action: 'associated', timestamp: 0, source: 'block_start' },
        { blockId: 'block-1', taskId: 'task-1', action: 'disassociated', timestamp: 10 * 60_000, source: 'manual' },
        { blockId: 'block-1', taskId: 'task-1', action: 'associated', timestamp: 25 * 60_000, source: 'manual' },
        { blockId: 'block-1', taskId: 'task-1', action: 'disassociated', timestamp: 40 * 60_000, source: 'manual' },
      ],
    }, 'task-1')).toBe(25 * 60_000)
  })

  it('falls back to the whole block duration when only legacy related-task data exists', () => {
    expect(calculateTaskAssociationDurationMs({
      startTime: 0,
      endTime: 30 * 60_000,
      taskIds: ['task-1'],
      taskAssociationLog: [],
    }, 'task-1')).toBe(30 * 60_000)
  })
})

describe('normalizeTimeBlockTaskIds', () => {
  it('defaults to empty array when no taskIds', () => {
    const block = { id: 'b1', name: 'test' } as const

    const result = normalizeTimeBlockTaskIds(block)

    expect(result.taskIds).toEqual([])
  })

  it('preserves existing taskIds', () => {
    const block = { taskIds: ['t1', 't2'] } as const

    const result = normalizeTimeBlockTaskIds(block)

    expect(result.taskIds).toEqual(['t1', 't2'])
  })
})
