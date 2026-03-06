/**
 * Phase4 (#337) 任务↔时间块 1:N 计时关联 单元测试
 *
 * 覆盖 TaskTimerServiceImpl：
 * - startBlockForTask 创建时间块并关联到任务
 * - startBlockForTask 自动将 not_started 转为 in_progress
 * - onBlockEndForTask 追加 blockId 到 timeBlockIds
 * - getBlockIdsForTask 返回已关联的时间块列表
 * - calculateSpentMinutes 正确累计
 * - 重复 blockId 不重复添加
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
    startBlock: vi.fn(async (name: string, _config?: unknown, _desc?: string, taskId?: string) => makeActiveBlock({ name, startId: `block-${Date.now()}`, taskId })),
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

describe('TaskTimerService: startBlockForTask', () => {
  it('creates time block and associates blockId to task', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'in_progress' })]])
    const taskSvc = createMockTaskService(tasks)
    const tbSvc = createMockTBService()
    const svc = new TaskTimerServiceImpl(taskSvc, tbSvc)

    const block = await svc.startBlockForTask('t1', { mode: 'countup' })

    expect(block).not.toBeNull()
    expect(tbSvc.startBlock).toHaveBeenCalledWith('Test Task', { mode: 'countup' }, undefined, 't1')
    expect(block!.taskId).toBe('t1')
    // Should update task with new blockId in timeBlockIds
    expect(taskSvc.updateTask).toHaveBeenCalledWith('t1', {
      timeBlockIds: [block!.startId],
    })
  })

  it('auto-transitions not_started to in_progress', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'not_started' })]])
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

  it('returns null for abandoned task', async () => {
    const tasks = new Map([['t1', makeTask({ id: 't1', status: 'abandoned' })]])
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
