import { describe, it, expect, beforeEach } from 'vitest'
import { TaskMockAdapter } from './task-mock-adapter'

describe('TaskNode CRUD 完整链路验证', () => {
  let adapter: TaskMockAdapter

  beforeEach(() => {
    adapter = new TaskMockAdapter()
  })

  it('创建 → 查询 → 更新 → 状态转换 → 放弃 完整链路', async () => {
    // 创建
    const created = await adapter.createTask({ title: '测试任务', priority: 'high', tags: ['test'] })
    expect(created.id).toBeTruthy()
    expect(created.status).toBe('not_started')
    expect(created.priority).toBe('high')

    // 查询
    const fetched = await adapter.getTaskById(created.id)
    expect(fetched?.title).toBe('测试任务')

    // 更新标题
    const updated = await adapter.updateTask(created.id, { title: '更新后的任务' })
    expect(updated?.title).toBe('更新后的任务')

    // 获取可用转换（not_started 只能转 in_progress）
    const available = await adapter.getAvailableTransitions(created.id)
    expect(available).toEqual(['in_progress'])

    // 状态转换：开始任务
    const started = await adapter.transitionTask(created.id, 'in_progress')
    expect(started?.status).toBe('in_progress')

    // 挂起
    const suspended = await adapter.transitionTask(created.id, 'suspended')
    expect(suspended?.status).toBe('suspended')

    // 放弃（行为语义：删除=放弃）
    const abandoned = await adapter.abandonTask(created.id)
    expect(abandoned?.status).toBe('abandoned')

    // 放弃后不出现在默认列表中
    const list = await adapter.listTasks()
    expect(list.find(t => t.id === created.id)).toBeUndefined()

    // 但 includeAbandoned=true 时可见
    const allList = await adapter.listTasks(true)
    expect(allList.find(t => t.id === created.id)?.status).toBe('abandoned')
  })

  it('终态任务不可再转换', async () => {
    const task = await adapter.createTask({ title: '终态测试' })
    await adapter.transitionTask(task.id, 'in_progress')
    await adapter.transitionTask(task.id, 'completed')

    await expect(adapter.transitionTask(task.id, 'in_progress')).rejects.toThrow()
    await expect(adapter.abandonTask(task.id)).rejects.toThrow()
  })
})
