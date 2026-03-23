/**
 * Phase3 (#336) 父子层级 + 软硬依赖 单元测试
 *
 * 覆盖 TaskServiceImpl 的层级查询、依赖管理、环检测、依赖感知状态转换。
 * 使用 mock ITaskPort 隔离测试。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/services/task-event-emitter', () => ({
  emitTaskCreated: vi.fn(),
  emitTaskTransition: vi.fn(),
}))

import { TaskServiceImpl } from '@/lib/services/task.service'
import { emitTaskCreated, emitTaskTransition } from '@/lib/services/task-event-emitter'
import type { ITaskPort } from '@/lib/environment/interfaces/task.port'
import type { TaskNode, TaskStatus, Dependency } from '@/lib/types/task'

/* ── helpers ── */

let idSeq = 0

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  idSeq++
  const now = Date.now()
  return {
    id: `t${idSeq}`,
    title: `Task ${idSeq}`,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createMockPort(tasks: TaskNode[]): ITaskPort {
  const store = new Map(tasks.map((t) => [t.id, { ...t }]))

  return {
    listTasks: vi.fn(async () => [...store.values()]),
    getTaskById: vi.fn(async (id: string) => store.get(id) ?? null),
    createTask: vi.fn(async (input) => {
      const t = makeTask({ title: input.title, parentId: input.parentId })
      store.set(t.id, t)
      return t
    }),
    updateTask: vi.fn(async (id: string, updates) => {
      const existing = store.get(id)
      if (!existing) return null
      const updated = { ...existing, ...updates, updatedAt: Date.now() }
      store.set(id, updated)
      return updated
    }),
    cancelTask: vi.fn(async (id: string) => {
      const t = store.get(id)
      if (!t) return null
      t.status = 'cancelled'
      t.completedAt = Date.now()
      return t
    }),
    transitionTask: vi.fn(async (id: string, to: TaskStatus) => {
      const t = store.get(id)
      if (!t) return null
      t.status = to
      t.updatedAt = Date.now()
      if (to === 'completed' || to === 'cancelled') t.completedAt = Date.now()
      return t
    }),
    getAvailableTransitions: vi.fn(async () => []),
  }
}

beforeEach(() => {
  vi.mocked(emitTaskCreated).mockClear()
  vi.mocked(emitTaskTransition).mockClear()
})

/* ── tests ── */

describe('TaskService Phase3: parent-child hierarchy', () => {
  let port: ITaskPort
  let service: TaskServiceImpl

  beforeEach(() => {
    idSeq = 0
  })

  it('getChildTasks returns direct children only', async () => {
    const parent = makeTask({ id: 'root' })
    const child1 = makeTask({ id: 'c1', parentId: 'root' })
    const child2 = makeTask({ id: 'c2', parentId: 'root' })
    const other = makeTask({ id: 'o1', parentId: 'other' })

    port = createMockPort([parent, child1, child2, other])
    service = new TaskServiceImpl({ task: port })

    const children = await service.getChildTasks('root')
    expect(children).toHaveLength(2)
    expect(children.map((c) => c.id).sort()).toEqual(['c1', 'c2'])
  })

  it('getChildTasks returns empty for leaf task', async () => {
    const leaf = makeTask({ id: 'leaf' })
    port = createMockPort([leaf])
    service = new TaskServiceImpl({ task: port })

    const children = await service.getChildTasks('leaf')
    expect(children).toHaveLength(0)
  })

  it('createTask with valid parentId succeeds', async () => {
    const parent = makeTask({ id: 'parent' })
    port = createMockPort([parent])
    service = new TaskServiceImpl({ task: port })

    const child = await service.createTask({ title: 'child', parentId: 'parent' })
    expect(child.parentId).toBe('parent')
  })

  it('createTask with invalid parentId throws', async () => {
    port = createMockPort([])
    service = new TaskServiceImpl({ task: port })

    await expect(service.createTask({ title: 'orphan', parentId: 'nonexistent' })).rejects.toThrow(
      'Parent task nonexistent not found',
    )
  })

  it('createTask without parentId succeeds (root task)', async () => {
    port = createMockPort([])
    service = new TaskServiceImpl({ task: port })

    const task = await service.createTask({ title: 'root' })
    expect(task.title).toBe('root')
    expect(task.parentId).toBeUndefined()
  })

  it('createTask emits task_created after success', async () => {
    port = createMockPort([])
    service = new TaskServiceImpl({ task: port })

    const task = await service.createTask({ title: 'emit me' })

    expect(emitTaskCreated).toHaveBeenCalledWith(task.id, 'emit me')
  })
})

describe('TaskService Phase3: dependency management', () => {
  let port: ITaskPort
  let service: TaskServiceImpl

  beforeEach(() => {
    idSeq = 0
  })

  it('addDependency creates a new hard dependency', async () => {
    const a = makeTask({ id: 'a' })
    const b = makeTask({ id: 'b' })
    port = createMockPort([a, b])
    service = new TaskServiceImpl({ task: port })

    const result = await service.addDependency('a', 'b', 'hard')
    expect(result).not.toBeNull()
    expect(result!.dependsOn).toEqual([{ taskId: 'b', type: 'hard' }])
  })

  it('addDependency creates a new soft dependency', async () => {
    const a = makeTask({ id: 'a' })
    const b = makeTask({ id: 'b' })
    port = createMockPort([a, b])
    service = new TaskServiceImpl({ task: port })

    const result = await service.addDependency('a', 'b', 'soft')
    expect(result).not.toBeNull()
    expect(result!.dependsOn).toEqual([{ taskId: 'b', type: 'soft' }])
  })

  it('addDependency updates type for existing dep', async () => {
    const a = makeTask({ id: 'a', dependsOn: [{ taskId: 'b', type: 'soft' }] })
    const b = makeTask({ id: 'b' })
    port = createMockPort([a, b])
    service = new TaskServiceImpl({ task: port })

    const result = await service.addDependency('a', 'b', 'hard')
    expect(result).not.toBeNull()
    expect(result!.dependsOn).toEqual([{ taskId: 'b', type: 'hard' }])
  })

  it('addDependency same type returns unchanged task', async () => {
    const deps: Dependency[] = [{ taskId: 'b', type: 'hard' }]
    const a = makeTask({ id: 'a', dependsOn: deps })
    const b = makeTask({ id: 'b' })
    port = createMockPort([a, b])
    service = new TaskServiceImpl({ task: port })

    const result = await service.addDependency('a', 'b', 'hard')
    expect(result).not.toBeNull()
    expect(result!.dependsOn).toEqual(deps)
    // Should NOT call updateTask since type is same
    expect(port.updateTask).not.toHaveBeenCalled()
  })

  it('addDependency throws on self-dependency', async () => {
    const a = makeTask({ id: 'a' })
    port = createMockPort([a])
    service = new TaskServiceImpl({ task: port })

    await expect(service.addDependency('a', 'a', 'hard')).rejects.toThrow(
      'A task cannot depend on itself',
    )
  })

  it('addDependency throws if dep target not found', async () => {
    const a = makeTask({ id: 'a' })
    port = createMockPort([a])
    service = new TaskServiceImpl({ task: port })

    await expect(service.addDependency('a', 'missing', 'hard')).rejects.toThrow(
      'Dependency target missing not found',
    )
  })

  it('addDependency returns null if source task not found', async () => {
    port = createMockPort([])
    service = new TaskServiceImpl({ task: port })

    const result = await service.addDependency('missing', 'b', 'hard')
    expect(result).toBeNull()
  })

  it('removeDependency removes existing dep', async () => {
    const a = makeTask({
      id: 'a',
      dependsOn: [
        { taskId: 'b', type: 'hard' },
        { taskId: 'c', type: 'soft' },
      ],
    })
    const b = makeTask({ id: 'b' })
    const c = makeTask({ id: 'c' })
    port = createMockPort([a, b, c])
    service = new TaskServiceImpl({ task: port })

    const result = await service.removeDependency('a', 'b')
    expect(result).not.toBeNull()
    expect(result!.dependsOn).toEqual([{ taskId: 'c', type: 'soft' }])
  })

  it('removeDependency returns null if task not found', async () => {
    port = createMockPort([])
    service = new TaskServiceImpl({ task: port })

    const result = await service.removeDependency('missing', 'b')
    expect(result).toBeNull()
  })

  it('removeDependency on non-existent dep is no-op', async () => {
    const a = makeTask({ id: 'a', dependsOn: [{ taskId: 'b', type: 'hard' }] })
    const b = makeTask({ id: 'b' })
    port = createMockPort([a, b])
    service = new TaskServiceImpl({ task: port })

    const result = await service.removeDependency('a', 'c')
    expect(result).not.toBeNull()
    expect(result!.dependsOn).toEqual([{ taskId: 'b', type: 'hard' }])
  })
})

describe('TaskService Phase3: cycle detection', () => {
  let port: ITaskPort
  let service: TaskServiceImpl

  beforeEach(() => {
    idSeq = 0
  })

  it('detects direct cycle: A→B→A', async () => {
    const a = makeTask({ id: 'a' })
    const b = makeTask({ id: 'b', dependsOn: [{ taskId: 'a', type: 'hard' }] })
    port = createMockPort([a, b])
    service = new TaskServiceImpl({ task: port })

    await expect(service.addDependency('a', 'b', 'hard')).rejects.toThrow('would create a cycle')
  })

  it('detects transitive cycle: A→B→C→A', async () => {
    const a = makeTask({ id: 'a' })
    const b = makeTask({ id: 'b', dependsOn: [{ taskId: 'a', type: 'hard' }] })
    const c = makeTask({ id: 'c', dependsOn: [{ taskId: 'b', type: 'hard' }] })
    port = createMockPort([a, b, c])
    service = new TaskServiceImpl({ task: port })

    // A depends on C, C→B→A would create cycle
    await expect(service.addDependency('a', 'c', 'hard')).rejects.toThrow('would create a cycle')
  })

  it('allows non-cyclic dependency', async () => {
    const a = makeTask({ id: 'a' })
    const b = makeTask({ id: 'b' })
    const c = makeTask({ id: 'c', dependsOn: [{ taskId: 'b', type: 'hard' }] })
    port = createMockPort([a, b, c])
    service = new TaskServiceImpl({ task: port })

    // A→C is safe (C→B, no path back to A)
    const result = await service.addDependency('a', 'c', 'hard')
    expect(result).not.toBeNull()
    expect(result!.dependsOn).toEqual([{ taskId: 'c', type: 'hard' }])
  })
})

describe('TaskService Phase3: dependency-aware transitions', () => {
  let port: ITaskPort
  let service: TaskServiceImpl

  beforeEach(() => {
    idSeq = 0
  })

  it('transitionTask to in_progress blocked by hard dep (pending)', async () => {
    const dep = makeTask({ id: 'dep', status: 'pending' })
    const task = makeTask({ id: 'task', dependsOn: [{ taskId: 'dep', type: 'hard' }] })
    port = createMockPort([dep, task])
    service = new TaskServiceImpl({ task: port })

    await expect(service.transitionTask('task', 'in_progress')).rejects.toThrow(
      'hard dependencies not met',
    )
  })

  it('transitionTask to in_progress blocked by hard dep (in_progress)', async () => {
    const dep = makeTask({ id: 'dep', status: 'in_progress' })
    const task = makeTask({ id: 'task', dependsOn: [{ taskId: 'dep', type: 'hard' }] })
    port = createMockPort([dep, task])
    service = new TaskServiceImpl({ task: port })

    await expect(service.transitionTask('task', 'in_progress')).rejects.toThrow(
      'hard dependencies not met',
    )
  })

  it('transitionTask to in_progress allowed when hard dep completed', async () => {
    const dep = makeTask({ id: 'dep', status: 'completed' })
    const task = makeTask({ id: 'task', dependsOn: [{ taskId: 'dep', type: 'hard' }] })
    port = createMockPort([dep, task])
    service = new TaskServiceImpl({ task: port })

    const result = await service.transitionTask('task', 'in_progress')
    expect(result).not.toBeNull()
    expect(result!.status).toBe('in_progress')
  })

  it('soft dep blocks only when pending', async () => {
    const dep = makeTask({ id: 'dep', status: 'pending' })
    const task = makeTask({ id: 'task', dependsOn: [{ taskId: 'dep', type: 'soft' }] })
    port = createMockPort([dep, task])
    service = new TaskServiceImpl({ task: port })

    // Soft dep is pending → blocking but NOT hard, so transition allowed
    const result = await service.transitionTask('task', 'in_progress')
    expect(result).not.toBeNull()
    expect(result!.status).toBe('in_progress')
  })

  it('transitionTask to non-in_progress skips dep check', async () => {
    const dep = makeTask({ id: 'dep', status: 'pending' })
    const task = makeTask({
      id: 'task',
      status: 'in_progress',
      dependsOn: [{ taskId: 'dep', type: 'hard' }],
    })
    port = createMockPort([dep, task])
    service = new TaskServiceImpl({ task: port })

    // Transition to completed should not check deps
    const result = await service.transitionTask('task', 'completed')
    expect(result).not.toBeNull()
    expect(result!.status).toBe('completed')
  })

  it('transitionTask emits fromStatus -> toStatus after success', async () => {
    const task = makeTask({ id: 'task', status: 'pending', title: '测试任务' })
    port = createMockPort([task])
    service = new TaskServiceImpl({ task: port })

    await service.transitionTask('task', 'in_progress')

    expect(emitTaskTransition).toHaveBeenCalledWith('task', '测试任务', 'pending', 'in_progress')
  })

  it('cancelTask emits cancelled transition after success', async () => {
    const task = makeTask({ id: 'task', status: 'in_progress', title: '测试任务' })
    port = createMockPort([task])
    service = new TaskServiceImpl({ task: port })

    await service.cancelTask('task')

    expect(emitTaskTransition).toHaveBeenCalledWith('task', '测试任务', 'in_progress', 'cancelled')
  })
})

describe('TaskService Phase3: checkDependenciesMet', () => {
  let port: ITaskPort
  let service: TaskServiceImpl

  beforeEach(() => {
    idSeq = 0
  })

  it('returns met=true when no dependencies', async () => {
    const task = makeTask({ id: 'task' })
    port = createMockPort([task])
    service = new TaskServiceImpl({ task: port })

    const result = await service.checkDependenciesMet('task')
    expect(result.met).toBe(true)
    expect(result.blocking).toHaveLength(0)
  })

  it('returns met=true when all hard deps completed', async () => {
    const dep = makeTask({ id: 'dep', status: 'completed' })
    const task = makeTask({ id: 'task', dependsOn: [{ taskId: 'dep', type: 'hard' }] })
    port = createMockPort([dep, task])
    service = new TaskServiceImpl({ task: port })

    const result = await service.checkDependenciesMet('task')
    expect(result.met).toBe(true)
  })

  it('hard dep not completed → blocking', async () => {
    const dep = makeTask({ id: 'dep', status: 'in_progress' })
    const task = makeTask({ id: 'task', dependsOn: [{ taskId: 'dep', type: 'hard' }] })
    port = createMockPort([dep, task])
    service = new TaskServiceImpl({ task: port })

    const result = await service.checkDependenciesMet('task')
    expect(result.met).toBe(false)
    expect(result.blocking).toHaveLength(1)
    expect(result.blocking[0]).toEqual({ taskId: 'dep', type: 'hard', status: 'in_progress' })
  })

  it('soft dep pending → blocking', async () => {
    const dep = makeTask({ id: 'dep', status: 'pending' })
    const task = makeTask({ id: 'task', dependsOn: [{ taskId: 'dep', type: 'soft' }] })
    port = createMockPort([dep, task])
    service = new TaskServiceImpl({ task: port })

    const result = await service.checkDependenciesMet('task')
    expect(result.met).toBe(false)
    expect(result.blocking).toHaveLength(1)
  })

  it('soft dep in_progress → not blocking', async () => {
    const dep = makeTask({ id: 'dep', status: 'in_progress' })
    const task = makeTask({ id: 'task', dependsOn: [{ taskId: 'dep', type: 'soft' }] })
    port = createMockPort([dep, task])
    service = new TaskServiceImpl({ task: port })

    const result = await service.checkDependenciesMet('task')
    expect(result.met).toBe(true)
  })

  it('missing dep task is not blocking', async () => {
    const task = makeTask({ id: 'task', dependsOn: [{ taskId: 'gone', type: 'hard' }] })
    port = createMockPort([task])
    service = new TaskServiceImpl({ task: port })

    const result = await service.checkDependenciesMet('task')
    expect(result.met).toBe(true)
  })

  it('returns met=true for missing task id', async () => {
    port = createMockPort([])
    service = new TaskServiceImpl({ task: port })

    const result = await service.checkDependenciesMet('nonexistent')
    expect(result.met).toBe(true)
  })
})
