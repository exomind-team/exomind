import { describe, it, expect, beforeEach } from 'vitest'
import { TaskMockAdapter } from './task-mock-adapter'

describe('TaskMockAdapter', () => {
  let adapter: TaskMockAdapter

  beforeEach(() => {
    adapter = new TaskMockAdapter()
  })

  it('listTasks() 默认不返回 abandoned 任务', async () => {
    const created = await adapter.createTask({ title: '待放弃任务' })
    await adapter.transitionTask(created.id, 'in_progress')
    await adapter.abandonTask(created.id)

    const tasks = await adapter.listTasks()
    expect(tasks.every(t => t.status !== 'abandoned')).toBe(true)
  })

  it('listTasks(true) 包含 abandoned 任务', async () => {
    const created = await adapter.createTask({ title: '待放弃任务2' })
    await adapter.transitionTask(created.id, 'in_progress')
    await adapter.abandonTask(created.id)

    const tasks = await adapter.listTasks(true)
    const abandonedTasks = tasks.filter(t => t.status === 'abandoned')
    expect(abandonedTasks.length).toBeGreaterThan(0)
  })

  it('createTask 创建后 status 为 not_started，id 非空', async () => {
    const task = await adapter.createTask({ title: '新任务' })
    expect(task.id).toBeTruthy()
    expect(task.status).toBe('not_started')
  })

  it('updateTask 更新字段，updatedAt 变大', async () => {
    const created = await adapter.createTask({ title: '原标题' })
    const originalUpdatedAt = created.updatedAt

    // 等待 1ms 确保时间戳有变化
    await new Promise(resolve => setTimeout(resolve, 1))

    const updated = await adapter.updateTask(created.id, { title: '新标题' })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('新标题')
    expect(updated!.updatedAt).toBeGreaterThan(originalUpdatedAt)
  })

  it('abandonTask 后任务 status 为 abandoned，且从 listTasks() 中消失', async () => {
    const created = await adapter.createTask({ title: '要放弃的任务' })
    await adapter.transitionTask(created.id, 'in_progress')
    const abandoned = await adapter.abandonTask(created.id)

    expect(abandoned).not.toBeNull()
    expect(abandoned!.status).toBe('abandoned')

    const tasks = await adapter.listTasks()
    expect(tasks.find(t => t.id === created.id)).toBeUndefined()
  })

  it('transitionTask 合法转换成功', async () => {
    const created = await adapter.createTask({ title: '状态转换测试' })
    const transitioned = await adapter.transitionTask(created.id, 'in_progress')

    expect(transitioned).not.toBeNull()
    expect(transitioned!.status).toBe('in_progress')
  })

  it('transitionTask 非法转换抛出 Error', async () => {
    const created = await adapter.createTask({ title: '非法转换测试' })
    // not_started → completed 是非法转换（必须先经过 in_progress）
    await expect(adapter.transitionTask(created.id, 'completed')).rejects.toThrow()
  })

  it('getAvailableTransitions 对 not_started 任务返回 [\'in_progress\']', async () => {
    const created = await adapter.createTask({ title: '可用转换测试' })
    const transitions = await adapter.getAvailableTransitions(created.id)
    expect(transitions).toEqual(['in_progress'])
  })
})
