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

function createBlock(): TimeBlock {
  return {
    id: 'block-1',
    name: '多任务专注块',
    startId: 'block-1',
    endId: 'end-1',
    note: '完成了核心联调',
    tags: new Set(['block_feedback']),
    startTime: Date.UTC(2026, 2, 18, 9, 0, 0),
    endTime: Date.UTC(2026, 2, 18, 10, 30, 0),
    taskIds: ['task-1', 'task-2'],
    taskStatusOutcomes: {
      'task-1': 'completed',
      'task-2': 'continue',
    },
    taskAssociationLog: [
      {
        blockId: 'block-1',
        taskId: 'task-1',
        action: 'associated',
        timestamp: Date.UTC(2026, 2, 18, 9, 0, 0),
        source: 'block_start',
      },
      {
        blockId: 'block-1',
        taskId: 'task-2',
        action: 'associated',
        timestamp: Date.UTC(2026, 2, 18, 9, 10, 0),
        source: 'manual',
      },
      {
        blockId: 'block-1',
        taskId: 'task-2',
        action: 'disassociated',
        timestamp: Date.UTC(2026, 2, 18, 10, 0, 0),
        source: 'manual',
      },
    ],
  }
}

describe('buildTimeBlockDetailView（时间块详情视图模型）', () => {
  it('expands summary, linked tasks and association timeline（展开概览、关联任务和关联日志）', async () => {
    const module = await import('@/ui/app/pages/timeblock-detail-view')
    const view = module.buildTimeBlockDetailView({
      block: createBlock(),
      tasksById: new Map([
        ['task-1', createTask({ id: 'task-1', title: '任务一', status: 'completed' })],
        ['task-2', createTask({ id: 'task-2', title: '任务二', status: 'in_progress' })],
      ]),
    })

    expect(view.summary.title).toBe('多任务专注块')
    expect(view.summary.feedback).toBe('完成了核心联调')
    expect(view.linkedTasks).toEqual([
      { taskId: 'task-1', title: '任务一', outcome: 'completed' },
      { taskId: 'task-2', title: '任务二', outcome: 'continue' },
    ])
    expect(view.associationTimeline.map((item: { action: string }) => item.action)).toEqual([
      'associated',
      'associated',
      'disassociated',
    ])
    expect(view.associationTimeline.map((item: { description: string }) => item.description)).toEqual([
      '关联任务 · 时间块启动',
      '关联任务 · 手动调整',
      '移除关联任务 · 手动调整',
    ])
  })

  it('falls back to task id when task title is missing（缺少任务标题时回退到 taskId）', async () => {
    const module = await import('@/ui/app/pages/timeblock-detail-view')
    const view = module.buildTimeBlockDetailView({
      block: createBlock(),
      tasksById: new Map(),
    })

    expect(view.linkedTasks[0]).toEqual({
      taskId: 'task-1',
      title: 'task-1',
      outcome: 'completed',
    })
  })

  it('replays linked tasks from association log when taskIds are empty（taskIds 为空时从关联日志恢复多任务）', async () => {
    const module = await import('@/ui/app/pages/timeblock-detail-view')
    const view = module.buildTimeBlockDetailView({
      block: {
        ...createBlock(),
        taskIds: [],
        taskAssociationLog: [
          {
            blockId: 'block-1',
            taskId: 'task-1',
            action: 'associated',
            timestamp: Date.UTC(2026, 2, 18, 9, 0, 0),
            source: 'block_start',
          },
          {
            blockId: 'block-1',
            taskId: 'task-2',
            action: 'associated',
            timestamp: Date.UTC(2026, 2, 18, 9, 10, 0),
            source: 'manual',
          },
        ],
      },
      tasksById: new Map([
        ['task-1', createTask({ id: 'task-1', title: '任务一', status: 'completed' })],
        ['task-2', createTask({ id: 'task-2', title: '任务二', status: 'in_progress' })],
      ]),
    })

    expect(view.linkedTasks).toEqual([
      { taskId: 'task-1', title: '任务一', outcome: 'completed' },
      { taskId: 'task-2', title: '任务二', outcome: 'continue' },
    ])
  })

  it('keeps historically linked tasks even if taskIds snapshot no longer contains them（历史关联任务不应被结束快照裁掉）', async () => {
    const module = await import('@/ui/app/pages/timeblock-detail-view')
    const view = module.buildTimeBlockDetailView({
      block: {
        ...createBlock(),
        taskIds: ['task-1'],
      },
      tasksById: new Map([
        ['task-1', createTask({ id: 'task-1', title: '任务一', status: 'completed' })],
        ['task-2', createTask({ id: 'task-2', title: '任务二', status: 'in_progress' })],
      ]),
    })

    expect(view.linkedTasks).toEqual([
      { taskId: 'task-1', title: '任务一', outcome: 'completed' },
      { taskId: 'task-2', title: '任务二', outcome: 'continue' },
    ])
  })
})
