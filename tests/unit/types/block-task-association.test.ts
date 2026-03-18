import { describe, expect, it } from 'vitest'
import {
  normalizeActiveBlockTaskIds,
  normalizeTimeBlockTaskIds,
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
