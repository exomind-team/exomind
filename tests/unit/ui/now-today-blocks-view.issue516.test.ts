import { describe, expect, it } from 'vitest'
import type { TaskNode } from '@/lib/types/task'
import type { TimeBlock } from '@/lib/types/event'

function createTask(input: Partial<TaskNode> & Pick<TaskNode, 'id' | 'title' | 'status'>): TaskNode {
  const now = Date.UTC(2026, 2, 18, 9, 0, 0)
  return {
    id: input.id,
    title: input.title,
    status: input.status,
    priority: input.priority ?? 'medium',
    dependsOn: input.dependsOn ?? [],
    tags: input.tags ?? [],
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    timeBlockIds: input.timeBlockIds,
    description: input.description,
    estimatedMinutes: input.estimatedMinutes,
    completedAt: input.completedAt,
    dueAt: input.dueAt,
    source: input.source,
    parentId: input.parentId,
    doneCondition: input.doneCondition,
  }
}

function createBlock(input: Partial<TimeBlock> & Pick<TimeBlock, 'id' | 'name' | 'startId' | 'endId' | 'startTime' | 'endTime'>): TimeBlock {
  return {
    id: input.id,
    name: input.name,
    startId: input.startId,
    endId: input.endId,
    startTime: input.startTime,
    endTime: input.endTime,
    tags: input.tags ?? new Set(['block_feedback']),
    note: input.note,
    taskIds: input.taskIds,
    taskStatusOutcomes: input.taskStatusOutcomes,
    taskAssociationLog: input.taskAssociationLog,
  }
}

describe('buildNowTodayBlocksView（今日 Tab 时间块视图模型）', () => {
  it('sorts today blocks by startTime desc and uses block title as primary text（按开始时间倒序且以时间块为主标题）', async () => {
    const module = await import('@/ui/app/pages/now-today-blocks-view')
    const view = module.buildNowTodayBlocksView({
      now: new Date('2026-03-18T20:00:00+08:00'),
      blocks: [
        createBlock({
          id: 'block-1',
          startId: 'block-1',
          endId: 'end-1',
          name: '上午深度开发',
          startTime: new Date('2026-03-18T09:00:00+08:00').getTime(),
          endTime: new Date('2026-03-18T10:00:00+08:00').getTime(),
          taskIds: ['task-1'],
        }),
        createBlock({
          id: 'block-2',
          startId: 'block-2',
          endId: 'end-2',
          name: '下午联调',
          startTime: new Date('2026-03-18T15:00:00+08:00').getTime(),
          endTime: new Date('2026-03-18T16:00:00+08:00').getTime(),
          taskIds: ['task-2', 'task-3'],
        }),
      ],
      tasksById: new Map([
        ['task-1', createTask({ id: 'task-1', title: '任务一', status: 'completed' })],
        ['task-2', createTask({ id: 'task-2', title: '任务二', status: 'in_progress' })],
        ['task-3', createTask({ id: 'task-3', title: '任务三', status: 'pending' })],
      ]),
    })

    expect(view.items.map((item: { blockId: string }) => item.blockId)).toEqual(['block-2', 'block-1'])
    expect(view.items[0]?.title).toBe('下午联调')
    expect(view.items[0]?.href).toBe('/eventlog/timeblocks/block-2')
  })

  it('only includes blocks started today and exposes linked task outcomes（仅保留今日时间块并展开关联任务结果）', async () => {
    const module = await import('@/ui/app/pages/now-today-blocks-view')
    const view = module.buildNowTodayBlocksView({
      now: new Date('2026-03-18T20:00:00+08:00'),
      blocks: [
        createBlock({
          id: 'block-old',
          startId: 'block-old',
          endId: 'end-old',
          name: '昨天的块',
          startTime: new Date('2026-03-17T23:00:00+08:00').getTime(),
          endTime: new Date('2026-03-18T00:00:00+08:00').getTime(),
          taskIds: ['task-old'],
        }),
        createBlock({
          id: 'block-today',
          startId: 'block-today',
          endId: 'end-today',
          name: '今天的块',
          startTime: new Date('2026-03-18T11:00:00+08:00').getTime(),
          endTime: new Date('2026-03-18T12:00:00+08:00').getTime(),
          taskIds: ['task-a', 'task-b'],
          taskStatusOutcomes: {
            'task-a': 'completed',
          },
        }),
      ],
      tasksById: new Map([
        ['task-a', createTask({ id: 'task-a', title: '任务甲', status: 'completed' })],
        ['task-b', createTask({ id: 'task-b', title: '任务乙', status: 'in_progress' })],
      ]),
    })

    expect(view.items).toHaveLength(1)
    expect(view.items[0]?.linkedTasks).toEqual([
      { taskId: 'task-a', title: '任务甲', outcome: 'completed' },
      { taskId: 'task-b', title: '任务乙', outcome: undefined },
    ])
  })

  it('replays linked tasks from association log when taskIds are absent（缺少 taskIds 时回放关联日志）', async () => {
    const module = await import('@/ui/app/pages/now-today-blocks-view')
    const view = module.buildNowTodayBlocksView({
      now: new Date('2026-03-18T20:00:00+08:00'),
      blocks: [
        createBlock({
          id: 'block-log',
          startId: 'block-log',
          endId: 'end-log',
          name: '日志回放块',
          startTime: new Date('2026-03-18T14:00:00+08:00').getTime(),
          endTime: new Date('2026-03-18T15:00:00+08:00').getTime(),
          taskIds: [],
          taskAssociationLog: [
            { blockId: 'block-log', taskId: 'task-a', action: 'associated', timestamp: 1, source: 'block_start' },
            { blockId: 'block-log', taskId: 'task-b', action: 'associated', timestamp: 2, source: 'manual' },
          ],
        }),
      ],
      tasksById: new Map([
        ['task-a', createTask({ id: 'task-a', title: '任务甲', status: 'completed' })],
        ['task-b', createTask({ id: 'task-b', title: '任务乙', status: 'in_progress' })],
      ]),
    })

    expect(view.items).toHaveLength(1)
    expect(view.items[0]?.linkedTasks).toEqual([
      { taskId: 'task-a', title: '任务甲', outcome: undefined },
      { taskId: 'task-b', title: '任务乙', outcome: undefined },
    ])
  })
})
