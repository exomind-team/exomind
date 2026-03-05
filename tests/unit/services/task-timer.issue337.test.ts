/**
 * Phase4 (#337) 任务↔时间块 1:N 计时关联 单元测试
 *
 * 覆盖 TaskTimerServiceImpl 的关联 CRUD、状态联动、spentMinutes 累计。
 * 使用 mock TaskService + TimeBlockService 隔离测试。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskTimerServiceImpl } from '@/lib/services/task-timer.service'
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
    status: 'not_started',
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
    abandonTask: vi.fn(async () => null),
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
  return {
    loadTimeBlocks: vi.fn(async () => completedBlocks),
    loadActiveBlock: vi.fn(async () => activeBlock),
    startBlock: vi.fn(async (name: string) => makeActiveBlock({ name })),
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

/* ── tests ── */

describe('TaskTimerService: startTimerForTask', () => {
  it('starts timer for not_started task and transitions to in_progress', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'not_started' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startTimerForTask('t1', { mode: 'countup' })

    expect(block).not.toBeNull()
    expect(block!.taskId).toBe('t1')
    expect(taskSvc.transitionTask).toHaveBeenCalledWith('t1', 'in_progress')
    expect(tbSvc.startBlock).toHaveBeenCalledWith('Test Task', { mode: 'countup' })
  })

  it('starts timer for in_progress task without extra transition', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'in_progress' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startTimerForTask('t1', { mode: 'countup' })

    expect(block).not.toBeNull()
    expect(taskSvc.transitionTask).not.toHaveBeenCalled()
  })

  it('starts timer for suspended task and transitions to in_progress', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'suspended' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startTimerForTask('t1', { mode: 'countup' })

    expect(block).not.toBeNull()
    expect(taskSvc.transitionTask).toHaveBeenCalledWith('t1', 'in_progress')
  })

  it('returns null for completed task', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'completed' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startTimerForTask('t1', { mode: 'countup' })
    expect(block).toBeNull()
  })

  it('returns null for abandoned task', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'abandoned' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startTimerForTask('t1', { mode: 'countup' })
    expect(block).toBeNull()
  })

  it('returns null for missing task', async () => {
    const taskSvc = createMockTaskService(new Map())
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startTimerForTask('nope', { mode: 'countup' })
    expect(block).toBeNull()
  })
})

describe('TaskTimerService: endTimerForTask', () => {
  it('ends timer with "continue" keeps task in_progress', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'in_progress' })]])
    const taskSvc = createMockTaskService(tasks)
    const active = makeActiveBlock({ taskId: 't1' })
    const tbSvc = createMockTBService(active)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const result = await svc.endTimerForTask(undefined, 'continue')

    expect(tbSvc.markEnding).toHaveBeenCalled()
    expect(tbSvc.endBlock).toHaveBeenCalled()
    expect(result).not.toBeNull()
    // "continue" should NOT call transitionTask
    expect(taskSvc.transitionTask).not.toHaveBeenCalled()
  })

  it('ends timer with "suspend" transitions to suspended', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'in_progress' })]])
    const taskSvc = createMockTaskService(tasks)
    const active = makeActiveBlock({ taskId: 't1' })
    const tbSvc = createMockTBService(active)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.endTimerForTask(undefined, 'suspend')

    expect(taskSvc.transitionTask).toHaveBeenCalledWith('t1', 'suspended')
  })

  it('ends timer with "complete" transitions to completed', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'in_progress' })]])
    const taskSvc = createMockTaskService(tasks)
    const active = makeActiveBlock({ taskId: 't1' })
    const tbSvc = createMockTBService(active)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.endTimerForTask(undefined, 'complete')

    expect(taskSvc.transitionTask).toHaveBeenCalledWith('t1', 'completed')
  })

  it('returns null when no active block', async () => {
    const taskSvc = createMockTaskService(new Map())
    const tbSvc = createMockTBService(null)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const result = await svc.endTimerForTask(undefined, 'continue')
    expect(result).toBeNull()
  })

  it('ends block without taskId (no task association)', async () => {
    const taskSvc = createMockTaskService(new Map())
    const active = makeActiveBlock() // no taskId
    const tbSvc = createMockTBService(active)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const result = await svc.endTimerForTask('good', 'continue')

    expect(result).toBeNull()
    expect(tbSvc.markEnding).toHaveBeenCalled()
    expect(tbSvc.endBlock).toHaveBeenCalledWith('good')
  })
})

describe('TaskTimerService: getTimeBlocksForTask', () => {
  it('returns only blocks matching taskId', async () => {
    const blocks: TimeBlock[] = [
      makeTimeBlock({ id: 'b1', startId: 'b1' }),
      makeTimeBlock({ id: 'b2', startId: 'b2' }),
    ]
    // Inject taskId onto the blocks (simulating stored data)
    ;(blocks[0] as unknown as { taskId: string }).taskId = 't1'
    ;(blocks[1] as unknown as { taskId: string }).taskId = 't2'

    const taskSvc = createMockTaskService(new Map())
    const tbSvc = createMockTBService(null, blocks)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const result = await svc.getTimeBlocksForTask('t1')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b1')
    expect(result[0].taskId).toBe('t1')
  })

  it('returns empty array when no blocks match', async () => {
    const blocks: TimeBlock[] = [makeTimeBlock({ id: 'b1' })]
    ;(blocks[0] as unknown as { taskId: string }).taskId = 't2'

    const taskSvc = createMockTaskService(new Map())
    const tbSvc = createMockTBService(null, blocks)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const result = await svc.getTimeBlocksForTask('t1')
    expect(result).toHaveLength(0)
  })
})

describe('TaskTimerService: updateSpentMinutes', () => {
  it('calculates total minutes from linked blocks', async () => {
    const now = Date.now()
    const blocks: TimeBlock[] = [
      makeTimeBlock({ id: 'b1', startTime: now - 60 * 60_000, endTime: now - 30 * 60_000 }), // 30 min
      makeTimeBlock({ id: 'b2', startTime: now - 25 * 60_000, endTime: now }),                // 25 min
    ]
    ;(blocks[0] as unknown as { taskId: string }).taskId = 't1'
    ;(blocks[1] as unknown as { taskId: string }).taskId = 't1'

    const tasks = new Map([['t1', makeTask({ id: 't1' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService(null, blocks)
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const result = await svc.updateSpentMinutes('t1')

    expect(result).not.toBeNull()
    expect(taskSvc.updateTask).toHaveBeenCalledWith('t1', { spentMinutes: 55 })
  })

  it('returns 0 minutes when no blocks linked', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService(null, [])
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    await svc.updateSpentMinutes('t1')

    expect(taskSvc.updateTask).toHaveBeenCalledWith('t1', { spentMinutes: 0 })
  })
})
