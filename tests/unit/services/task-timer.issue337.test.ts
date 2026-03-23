/**
 * Phase4 (#337) 任务↔时间块 1:N 计时关联 单元测试
 *
 * 覆盖 TaskTimerServiceImpl：
 * - startBlockForTask 创建时间块并关联到任务
 * - startBlockForTask 自动将 pending 转为 in_progress
 * - onBlockEndForTask 追加 blockId 到 timeBlockIds
 * - #418 多任务关联：批量启动 / 运行中增删 / 结束时按仍关联任务回写
 * - getBlockIdsForTask 返回已关联的时间块列表
 * - calculateSpentMinutes 正确累计
 * - 重复 blockId 不重复添加
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/services/task-event-emitter', () => ({
  emitTaskLinked: vi.fn(),
  emitTaskUnlinked: vi.fn(),
}))

import { TaskTimerServiceImpl } from '@/lib/services/task-timer.service'
import { emitTaskLinked, emitTaskUnlinked } from '@/lib/services/task-event-emitter'
import type { TaskService } from '@/lib/services/task.service'
import type { TimeBlockService } from '@/lib/services/timeblock.service'
import type { TaskNode } from '@/lib/types/task'
import type { ActiveBlockData, TimeBlock } from '@/lib/types/event'

/* ── helpers ── */

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  const now = Date.now()
  return {
    id: 'task-1',
    title: 'Test Task',
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeActiveBlock(overrides: Partial<ActiveBlockData> = {}): ActiveBlockData {
  const now = Date.now()
  return {
    startId: 'block-1',
    name: 'Test Task',
    mode: 'countup',
    elapsed: 0,
    startTime: now,
    paused: false,
    phase: 'running',
    version: 1,
    taskIds: [],
    taskAssociationLog: [],
    ...overrides,
  }
}

function makeTimeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  const now = Date.now()
  return {
    id: 'block-1',
    name: 'Test Task',
    startId: 'block-1',
    endId: 'end-1',
    tags: new Set(['block_feedback']),
    startTime: now - 30 * 60_000,
    endTime: now,
    ...overrides,
  }
}

function createMockTaskService(tasks: Map<string, TaskNode>): TaskService {
  return {
    listTasks: vi.fn(async () => [...tasks.values()]),
    getTask: vi.fn(async (id: string) => tasks.get(id) ?? null),
    createTask: vi.fn(async (input) => {
      const t = makeTask({ title: input.title })
      tasks.set(t.id, t)
      return t
    }),
    updateTask: vi.fn(async (id: string, updates) => {
      const t = tasks.get(id)
      if (!t) return null
      const updated = { ...t, ...updates, updatedAt: Date.now() }
      tasks.set(id, updated)
      return updated
    }),
    cancelTask: vi.fn(async () => null),
    transitionTask: vi.fn(async (id: string, to) => {
      const t = tasks.get(id)
      if (!t) return null
      t.status = to
      t.updatedAt = Date.now()
      return t
    }),
    getAvailableTransitions: vi.fn(async () => []),
    getChildTasks: vi.fn(async () => []),
    addDependency: vi.fn(async () => null),
    removeDependency: vi.fn(async () => null),
    checkDependenciesMet: vi.fn(async () => ({ met: true, blocking: [] })),
  }
}

function createMockTBService(
  activeBlock: ActiveBlockData | null = null,
  completedBlocks: TimeBlock[] = [],
): TimeBlockService {
  let currentActiveBlock = activeBlock
  return {
    loadTimeBlocks: vi.fn(async () => completedBlocks),
    loadActiveBlock: vi.fn(async () => currentActiveBlock),
    startBlock: vi.fn(async (
      name: string,
      _config?: unknown,
      _desc?: string,
      taskBinding?: string | { taskIds: string[] },
    ) => {
      const taskIds = typeof taskBinding === 'string'
        ? [taskBinding]
        : taskBinding?.taskIds ?? []
      currentActiveBlock = makeActiveBlock({
        name,
        startId: `block-${Date.now()}`,
        taskIds,
        taskId: taskIds[0],
        taskAssociationLog: taskIds.map((taskId) => ({
          blockId: 'block-1',
          taskId,
          action: 'associated',
          timestamp: Date.now(),
          source: 'block_start',
        })),
      })
      return currentActiveBlock
    }),
    updateActiveBlock: vi.fn(async (patch) => {
      if (!currentActiveBlock) return null
      currentActiveBlock = {
        ...currentActiveBlock,
        ...patch,
      }
      return currentActiveBlock
    }),
    markEnding: vi.fn(async () => {}),
    endBlock: vi.fn(async () => null),
    pauseBlock: vi.fn(async () => {}),
    resumeBlock: vi.fn(async () => {}),
    updateElapsed: vi.fn(async () => {}),
    onBlockChange: vi.fn(() => () => {}),
    startSync: vi.fn(async () => {}),
    stopSync: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  vi.mocked(emitTaskLinked).mockClear()
  vi.mocked(emitTaskUnlinked).mockClear()
})

/* ── tests ── */

describe('TaskTimerService: startBlockForTask', () => {
  it('creates time block with multi-task binding payload', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'in_progress' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startBlockForTask('t1', { mode: 'countup' })

    expect(block).not.toBeNull()
    expect(tbSvc.startBlock).toHaveBeenCalledWith('Test Task', { mode: 'countup' }, undefined, { taskIds: ['t1'] })
    expect(block!.taskIds).toEqual(['t1'])
    expect(taskSvc.updateTask).not.toHaveBeenCalled()
  })

  it('auto-transitions pending to in_progress', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'pending' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.startBlockForTask('t1')

    expect(taskSvc.transitionTask).toHaveBeenCalledWith('t1', 'in_progress')
  })

  it('auto-transitions suspended to in_progress', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'suspended' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.startBlockForTask('t1')

    expect(taskSvc.transitionTask).toHaveBeenCalledWith('t1', 'in_progress')
  })

  it('does not transition already in_progress task', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'in_progress' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.startBlockForTask('t1')

    expect(taskSvc.transitionTask).not.toHaveBeenCalled()
  })

  it('returns null for completed task', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'completed' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    expect(await svc.startBlockForTask('t1')).toBeNull()
    expect(tbSvc.startBlock).not.toHaveBeenCalled()
  })

  it('returns null for cancelled task', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'cancelled' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    expect(await svc.startBlockForTask('t1')).toBeNull()
  })

  it('returns null for missing task', async () => {
    const taskSvc = createMockTaskService(new Map())
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    expect(await svc.startBlockForTask('nope')).toBeNull()
  })

  it('does not duplicate blockId in existing timeBlockIds', async () => {
    const tbSvc = createMockTBService()
    // Pre-set startBlock to return a known startId
    ;(tbSvc.startBlock as ReturnType<typeof vi.fn>).mockResolvedValue(makeActiveBlock({ startId: 'existing-block' }))

    const tasks = new Map([['t1', makeTask({
      id: 't1',
      status: 'in_progress',
      timeBlockIds: ['existing-block'],
    })]])
    const taskSvc = createMockTaskService(tasks)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.startBlockForTask('t1')

    // Should NOT call updateTask since blockId already exists
    expect(taskSvc.updateTask).not.toHaveBeenCalled()
  })
})

describe('TaskTimerService: onBlockEndForTask', () => {
  it('appends blockId to task timeBlockIds', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'in_progress' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.onBlockEndForTask('t1', 'block-new')

    expect(taskSvc.updateTask).toHaveBeenCalledWith('t1', {
      timeBlockIds: ['block-new'],
    })
  })

  it('does not duplicate existing blockId', async () => {
    const tasks = new Map([['t1', makeTask({
      id: 't1',
      status: 'in_progress',
      timeBlockIds: ['block-1'],
    })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.onBlockEndForTask('t1', 'block-1')

    // Should NOT call updateTask since blockId already exists
    expect(taskSvc.updateTask).not.toHaveBeenCalled()
  })

  it('does nothing for missing task', async () => {
    const taskSvc = createMockTaskService(new Map())
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.onBlockEndForTask('nope', 'block-1')

    expect(taskSvc.updateTask).not.toHaveBeenCalled()
  })
})

describe('TaskTimerService: getBlockIdsForTask', () => {
  it('returns timeBlockIds from task', async () => {
    const tasks = new Map([['t1', makeTask({
      id: 't1',
      timeBlockIds: ['b1', 'b2', 'b3'],
    })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const ids = await svc.getBlockIdsForTask('t1')
    expect(ids).toEqual(['b1', 'b2', 'b3'])
  })

  it('returns empty array for task without timeBlockIds', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const ids = await svc.getBlockIdsForTask('t1')
    expect(ids).toEqual([])
  })

  it('returns empty array for missing task', async () => {
    const taskSvc = createMockTaskService(new Map())
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const ids = await svc.getBlockIdsForTask('nope')
    expect(ids).toEqual([])
  })
})

describe('TaskTimerService: calculateSpentMinutes', () => {
  it('calculates total from matching completed blocks', async () => {
    const now = Date.now()
    const blocks: TimeBlock[] = [
      makeTimeBlock({ startId: 'b1', startTime: now - 60 * 60_000, endTime: now - 30 * 60_000 }), // 30 min
      makeTimeBlock({ startId: 'b2', startTime: now - 25 * 60_000, endTime: now }),                // 25 min
      makeTimeBlock({ startId: 'b3', startTime: now - 10 * 60_000, endTime: now }),                // 10 min (not linked)
    ]
    const tasks = new Map([['t1', makeTask({
      id: 't1',
      timeBlockIds: ['b1', 'b2'], // b3 not linked
    })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService(null, blocks)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const result = await svc.calculateSpentMinutes('t1')
    expect(result).toBe(55) // 30 + 25
  })

  it('returns 0 when no blocks linked', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', timeBlockIds: [] })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService(null, [])
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const result = await svc.calculateSpentMinutes('t1')
    expect(result).toBe(0)
  })

  it('returns 0 for missing task', async () => {
    const taskSvc = createMockTaskService(new Map())
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const result = await svc.calculateSpentMinutes('nope')
    expect(result).toBe(0)
  })
})

describe('#418 multi-task association', () => {
  it('startBlockForTasks associates multiple tasks', async () => {
    const tasks = new Map([
      ['task-1', makeTask({ id: 'task-1', title: 'Task 1', status: 'pending' })],
      ['task-2', makeTask({ id: 'task-2', title: 'Task 2', status: 'pending' })],
    ])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startBlockForTasks(['task-1', 'task-2'])

    expect(block).not.toBeNull()
    expect(tbSvc.startBlock).toHaveBeenCalledWith('Task 1', { mode: 'countup' }, undefined, { taskIds: ['task-1', 'task-2'] })
    expect(taskSvc.transitionTask).toHaveBeenCalledTimes(2)
    expect(block?.taskIds).toEqual(['task-1', 'task-2'])
    expect(emitTaskLinked).toHaveBeenCalledWith('task-1', 'Task 1', expect.any(String), 'Task 1')
    expect(emitTaskLinked).toHaveBeenCalledWith('task-2', 'Task 2', expect.any(String), 'Task 1')
  })

  it('addTaskToBlock adds task to running block with audit log', async () => {
    const tasks = new Map([
      ['task-1', makeTask({ id: 'task-1', status: 'in_progress' })],
      ['task-2', makeTask({ id: 'task-2', status: 'in_progress' })],
    ])
    const activeBlock = makeActiveBlock({
      startId: 'block-live',
      taskIds: ['task-1'],
      taskAssociationLog: [],
    })
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService(activeBlock)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.addTaskToBlock('task-2')

    expect(tbSvc.updateActiveBlock).toHaveBeenCalledWith(expect.objectContaining({
      taskIds: ['task-1', 'task-2'],
      taskAssociationLog: expect.arrayContaining([
        expect.objectContaining({ taskId: 'task-2', action: 'associated', source: 'manual' }),
      ]),
    }))
    expect(emitTaskLinked).toHaveBeenCalledWith('task-2', 'Test Task', 'block-live', 'Test Task')
  })

  it('addTaskToBlock preserves existing associated tasks reconstructed from log-only active block', async () => {
    const tasks = new Map([
      ['task-1', makeTask({ id: 'task-1', status: 'in_progress' })],
      ['task-2', makeTask({ id: 'task-2', status: 'in_progress' })],
    ])
    const activeBlock = makeActiveBlock({
      startId: 'block-live',
      taskIds: [],
      taskAssociationLog: [
        {
          blockId: 'block-live',
          taskId: 'task-1',
          action: 'associated',
          timestamp: 1,
          source: 'block_start',
        },
      ],
      taskId: undefined,
    })
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService(activeBlock)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.addTaskToBlock('task-2')

    expect(tbSvc.updateActiveBlock).toHaveBeenCalledWith(expect.objectContaining({
      taskIds: ['task-1', 'task-2'],
      taskAssociationLog: expect.arrayContaining([
        expect.objectContaining({ taskId: 'task-1', action: 'associated', source: 'block_start' }),
        expect.objectContaining({ taskId: 'task-2', action: 'associated', source: 'manual' }),
      ]),
    }))
  })

  it('addTaskToBlock rejects tasks blocked by hard dependencies', async () => {
    const tasks = new Map([
      ['task-1', makeTask({ id: 'task-1', status: 'in_progress' })],
      ['task-2', makeTask({ id: 'task-2', status: 'pending', dependsOn: [{ taskId: 'dep-1', type: 'hard' }] })],
    ])
    const activeBlock = makeActiveBlock({
      startId: 'block-live',
      taskIds: ['task-1'],
      taskAssociationLog: [],
    })
    const taskSvc = createMockTaskService(tasks)
    ;(taskSvc.checkDependenciesMet as ReturnType<typeof vi.fn>).mockResolvedValue({
      met: false,
      blocking: [{ taskId: 'dep-1', type: 'hard', status: 'pending' }],
    })
    const tbSvc = createMockTBService(activeBlock)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await expect(svc.addTaskToBlock('task-2')).rejects.toThrow(
      'Cannot associate task to active block: hard dependencies not met [dep-1]',
    )
    expect(tbSvc.updateActiveBlock).not.toHaveBeenCalled()
  })

  it('removeTaskFromBlock removes task with disassociation log', async () => {
    const tasks = new Map([
      ['task-1', makeTask({ id: 'task-1', status: 'in_progress' })],
      ['task-2', makeTask({ id: 'task-2', status: 'in_progress' })],
    ])
    const activeBlock = makeActiveBlock({
      startId: 'block-live',
      taskIds: ['task-1', 'task-2'],
      taskAssociationLog: [],
    })
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService(activeBlock)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.removeTaskFromBlock('task-2')

    expect(tbSvc.updateActiveBlock).toHaveBeenCalledWith(expect.objectContaining({
      taskIds: ['task-1'],
      taskAssociationLog: expect.arrayContaining([
        expect.objectContaining({ taskId: 'task-2', action: 'disassociated', source: 'manual' }),
      ]),
    }))
    expect(emitTaskUnlinked).toHaveBeenCalledWith('task-2', 'Test Task', 'block-live', 'Test Task')
  })

  it('onBlockEndForTasks only writes timeBlockIds for tasks still associated at end', async () => {
    const tasks = new Map([
      ['task-1', makeTask({ id: 'task-1', timeBlockIds: [] })],
      ['task-2', makeTask({ id: 'task-2', timeBlockIds: [] })],
    ])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.onBlockEndForTasks(['task-1'], 'block-1')

    expect(taskSvc.updateTask).toHaveBeenCalledWith('task-1', {
      timeBlockIds: ['block-1'],
    })
    expect(taskSvc.updateTask).not.toHaveBeenCalledWith('task-2', expect.anything())
  })

  it('startBlockForTask delegates to startBlockForTasks', async () => {
    const tasks = new Map([
      ['task-1', makeTask({ id: 'task-1', status: 'pending' })],
    ])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startBlockForTask('task-1')

    expect(block?.taskIds).toEqual(['task-1'])
    expect(tbSvc.startBlock).toHaveBeenCalledWith('Test Task', { mode: 'countup' }, undefined, { taskIds: ['task-1'] })
  })

  it('startBlockForTask seals task association onto the persisted active block', async () => {
    const tasks = new Map([
      ['task-1', makeTask({ id: 'task-1', status: 'pending' })],
    ])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.startBlockForTask('task-1')

    expect(tbSvc.updateActiveBlock).toHaveBeenCalledWith(expect.objectContaining({
      taskIds: ['task-1'],
      taskAssociationLog: expect.arrayContaining([
        expect.objectContaining({ taskId: 'task-1', action: 'associated', source: 'block_start' }),
      ]),
    }))
  })
})
