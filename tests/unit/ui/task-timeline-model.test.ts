import { afterEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_TAGS, type Event, type TimeBlock } from '@/lib/types/event'
import type { TaskNode } from '@/lib/types/task'
import { buildTaskTimelineModel, resolveTimeRange } from '@/ui/app/pages/task-timeline-model'

function makeTask(overrides: Partial<TaskNode> & Pick<TaskNode, 'id' | 'title' | 'status'>): TaskNode {
  const baseTime = new Date('2026-03-19T09:00:00.000+08:00').getTime()
  return {
    id: overrides.id,
    title: overrides.title,
    status: overrides.status,
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  }
}

function makeEvent(input: {
  id: string
  timestamp: number
  tags: string[]
  taskId?: string
  taskTitle?: string
  fromStatus?: string
  toStatus?: string
}): Event {
  return {
    id: input.id,
    timestamp: input.timestamp,
    content: input.id,
    tags: new Set(input.tags),
    metadata: {
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
    },
  }
}

function makeBlock(overrides: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'startId' | 'endId' | 'name' | 'startTime' | 'endTime'>): TimeBlock {
  return {
    id: overrides.id,
    startId: overrides.startId,
    endId: overrides.endId,
    name: overrides.name,
    startTime: overrides.startTime,
    endTime: overrides.endTime,
    tags: new Set(['block_feedback']),
    ...overrides,
  }
}

describe('task-timeline-model', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('resolveTimeRange', () => {
    it('resolves today from local midnight to now', () => {
      const now = new Date('2026-03-19T14:30:00.000+08:00').getTime()
      expect(resolveTimeRange('today', now)).toEqual({
        start: new Date('2026-03-19T00:00:00.000+08:00').getTime(),
        end: now,
      })
    })

    it('resolves 3d starting two days before today', () => {
      const now = new Date('2026-03-19T14:30:00.000+08:00').getTime()
      expect(resolveTimeRange('3d', now)).toEqual({
        start: new Date('2026-03-17T00:00:00.000+08:00').getTime(),
        end: now,
      })
    })

    it('keeps custom range unchanged', () => {
      const range = {
        start: new Date('2026-03-10T00:00:00.000+08:00').getTime(),
        end: new Date('2026-03-12T23:59:59.999+08:00').getTime(),
      }
      expect(resolveTimeRange(range, Date.now())).toEqual(range)
    })
  })

  describe('buildTaskTimelineModel', () => {
    it('builds exact segments from task.* events', () => {
      const now = new Date('2026-03-19T20:00:00.000+08:00').getTime()
      vi.spyOn(Date, 'now').mockReturnValue(now)

      const task = makeTask({
        id: 'task-1',
        title: '精确事件任务',
        status: 'completed',
        createdAt: new Date('2026-03-19T09:00:00.000+08:00').getTime(),
        updatedAt: new Date('2026-03-19T12:00:00.000+08:00').getTime(),
      })

      const events = [
        makeEvent({
          id: 'created',
          timestamp: new Date('2026-03-19T09:00:00.000+08:00').getTime(),
          tags: [SYSTEM_TAGS.TASK_CREATED],
          taskId: 'task-1',
          taskTitle: '精确事件任务',
        }),
        makeEvent({
          id: 'started',
          timestamp: new Date('2026-03-19T09:30:00.000+08:00').getTime(),
          tags: [SYSTEM_TAGS.TASK_STARTED],
          taskId: 'task-1',
          taskTitle: '精确事件任务',
          fromStatus: 'pending',
          toStatus: 'in_progress',
        }),
        makeEvent({
          id: 'suspended',
          timestamp: new Date('2026-03-19T10:30:00.000+08:00').getTime(),
          tags: [SYSTEM_TAGS.TASK_SUSPENDED],
          taskId: 'task-1',
          taskTitle: '精确事件任务',
          fromStatus: 'in_progress',
          toStatus: 'suspended',
        }),
        makeEvent({
          id: 'completed',
          timestamp: new Date('2026-03-19T11:00:00.000+08:00').getTime(),
          tags: [SYSTEM_TAGS.TASK_COMPLETED],
          taskId: 'task-1',
          taskTitle: '精确事件任务',
          fromStatus: 'suspended',
          toStatus: 'completed',
        }),
      ]

      const model = buildTaskTimelineModel([task], events, [], 'today', { showPending: true })

      expect(model.entries).toHaveLength(1)
      expect(model.entries[0]?.segments).toEqual([
        expect.objectContaining({
          status: 'pending',
          inferred: false,
          startTime: new Date('2026-03-19T09:00:00.000+08:00').getTime(),
          endTime: new Date('2026-03-19T09:30:00.000+08:00').getTime(),
        }),
        expect.objectContaining({
          status: 'in_progress',
          inferred: false,
          startTime: new Date('2026-03-19T09:30:00.000+08:00').getTime(),
          endTime: new Date('2026-03-19T10:30:00.000+08:00').getTime(),
        }),
        expect.objectContaining({
          status: 'suspended',
          inferred: false,
          startTime: new Date('2026-03-19T10:30:00.000+08:00').getTime(),
          endTime: new Date('2026-03-19T11:00:00.000+08:00').getTime(),
        }),
      ])
      expect(model.entries[0]?.terminalMarker).toEqual(expect.objectContaining({
        status: 'completed',
        inferred: false,
        timestamp: new Date('2026-03-19T11:00:00.000+08:00').getTime(),
      }))
    })

    it('falls back to inferred segments from time blocks when task events are absent', () => {
      const now = new Date('2026-03-19T20:00:00.000+08:00').getTime()
      vi.spyOn(Date, 'now').mockReturnValue(now)

      const task = makeTask({
        id: 'task-2',
        title: '老任务',
        status: 'completed',
        createdAt: new Date('2026-03-19T08:00:00.000+08:00').getTime(),
        updatedAt: new Date('2026-03-19T11:05:00.000+08:00').getTime(),
        timeBlockIds: ['block-1'],
      })

      const blocks = [
        makeBlock({
          id: 'block-1',
          startId: 'block-1',
          endId: 'block-1-end',
          name: '老任务时间块',
          startTime: new Date('2026-03-19T09:00:00.000+08:00').getTime(),
          endTime: new Date('2026-03-19T10:00:00.000+08:00').getTime(),
        }),
      ]

      const model = buildTaskTimelineModel([task], [], blocks, 'today', { showPending: true })

      expect(model.entries[0]?.segments).toEqual([
        expect.objectContaining({
          status: 'pending',
          inferred: true,
          startTime: new Date('2026-03-19T08:00:00.000+08:00').getTime(),
          endTime: new Date('2026-03-19T09:00:00.000+08:00').getTime(),
        }),
        expect.objectContaining({
          status: 'in_progress',
          inferred: true,
          startTime: new Date('2026-03-19T09:00:00.000+08:00').getTime(),
          endTime: new Date('2026-03-19T10:00:00.000+08:00').getTime(),
        }),
      ])
      expect(model.entries[0]?.terminalMarker).toEqual(expect.objectContaining({
        status: 'completed',
        inferred: true,
        timestamp: new Date('2026-03-19T10:00:00.000+08:00').getTime(),
      }))
    })

    it('hides pending segments by default', () => {
      const now = new Date('2026-03-19T20:00:00.000+08:00').getTime()
      vi.spyOn(Date, 'now').mockReturnValue(now)

      const task = makeTask({
        id: 'task-3',
        title: '隐藏待办任务',
        status: 'in_progress',
        createdAt: new Date('2026-03-19T08:00:00.000+08:00').getTime(),
        timeBlockIds: ['block-2'],
      })

      const blocks = [
        makeBlock({
          id: 'block-2',
          startId: 'block-2',
          endId: 'block-2-end',
          name: '开始推进',
          startTime: new Date('2026-03-19T09:00:00.000+08:00').getTime(),
          endTime: new Date('2026-03-19T10:00:00.000+08:00').getTime(),
        }),
      ]

      const model = buildTaskTimelineModel([task], [], blocks, 'today')

      expect(model.entries[0]?.segments).toHaveLength(1)
      expect(model.entries[0]?.segments[0]?.status).toBe('in_progress')
    })
  })
})
