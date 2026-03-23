import { describe, it, expect, vi } from 'vitest'
import {
  canTransition,
  transition,
  type TaskNode,
  type TaskStatus,
} from '@/lib/types/task'

// ────────────────────────────────────────────────────────────
// Helper: 构造最小合法 TaskNode（用于 transition 测试）
// ────────────────────────────────────────────────────────────
function makeTask(status: TaskStatus): TaskNode {
  const now = Date.now()
  return {
    id: 'test-id',
    title: 'Test Task',
    status,
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

// ────────────────────────────────────────────────────────────
// canTransition: 合法路径
// ────────────────────────────────────────────────────────────
describe('canTransition - valid transitions', () => {
  it('pending → in_progress 合法', () => {
    expect(canTransition('pending', 'in_progress')).toBe(true)
  })

  it('in_progress → suspended 合法', () => {
    expect(canTransition('in_progress', 'suspended')).toBe(true)
  })

  it('in_progress → completed 合法', () => {
    expect(canTransition('in_progress', 'completed')).toBe(true)
  })

  it('in_progress → cancelled 合法', () => {
    expect(canTransition('in_progress', 'cancelled')).toBe(true)
  })

  it('suspended → in_progress 合法', () => {
    expect(canTransition('suspended', 'in_progress')).toBe(true)
  })

  it('suspended → completed 合法', () => {
    expect(canTransition('suspended', 'completed')).toBe(true)
  })

  it('suspended → cancelled 合法', () => {
    expect(canTransition('suspended', 'cancelled')).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// canTransition: 非法路径
// ────────────────────────────────────────────────────────────
describe('canTransition - invalid transitions', () => {
  it('pending → suspended 非法', () => {
    expect(canTransition('pending', 'suspended')).toBe(false)
  })

  it('pending → completed 非法（不可直接完成）', () => {
    expect(canTransition('pending', 'completed')).toBe(false)
  })

  it('pending → cancelled 非法', () => {
    expect(canTransition('pending', 'cancelled')).toBe(false)
  })

  it('in_progress → pending 非法（不可回退）', () => {
    expect(canTransition('in_progress', 'pending')).toBe(false)
  })

  it('suspended → pending 非法', () => {
    expect(canTransition('suspended', 'pending')).toBe(false)
  })

  it('completed → in_progress 非法（终态不可转换）', () => {
    expect(canTransition('completed', 'in_progress')).toBe(false)
  })

  it('completed → suspended 非法（终态不可转换）', () => {
    expect(canTransition('completed', 'suspended')).toBe(false)
  })

  it('completed → cancelled 非法（终态不可转换）', () => {
    expect(canTransition('completed', 'cancelled')).toBe(false)
  })

  it('cancelled → in_progress 非法（终态不可转换）', () => {
    expect(canTransition('cancelled', 'in_progress')).toBe(false)
  })

  it('cancelled → completed 非法（终态不可转换）', () => {
    expect(canTransition('cancelled', 'completed')).toBe(false)
  })

  it('in_progress → in_progress 自转换非法', () => {
    expect(canTransition('in_progress', 'in_progress')).toBe(false)
  })

  it('suspended → suspended 自转换非法', () => {
    expect(canTransition('suspended', 'suspended')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// transition: 不可变性
// ────────────────────────────────────────────────────────────
describe('transition - immutability', () => {
  it('合法转换返回新对象，原对象不变', () => {
    const original = makeTask('pending')
    const next = transition(original, 'in_progress')

    expect(next).not.toBe(original)          // 新对象
    expect(original.status).toBe('pending') // 原对象未被修改
    expect(next.status).toBe('in_progress')
  })

  it('合法转换更新 updatedAt（严格大于，而非等于）', () => {
    vi.useFakeTimers()
    const original = makeTask('in_progress')
    vi.advanceTimersByTime(10) // 推进 10ms，确保 Date.now() 返回更大值

    const next = transition(original, 'suspended')

    expect(next.updatedAt).toBeGreaterThan(original.updatedAt)
    vi.useRealTimers()
  })
})

// ────────────────────────────────────────────────────────────
// transition: 非法转换抛出 Error
// ────────────────────────────────────────────────────────────
describe('transition - invalid throws Error', () => {
  it('pending → completed 抛出 Error', () => {
    const task = makeTask('pending')
    expect(() => transition(task, 'completed')).toThrow(Error)
  })

  it('completed → in_progress 抛出 Error（终态）', () => {
    const task = makeTask('completed')
    expect(() => transition(task, 'in_progress')).toThrow(Error)
  })

  it('cancelled → suspended 抛出 Error（终态）', () => {
    const task = makeTask('cancelled')
    expect(() => transition(task, 'suspended')).toThrow(Error)
  })
})

// ────────────────────────────────────────────────────────────
// transition: completed 时设置 completedAt
// ────────────────────────────────────────────────────────────
describe('transition - completedAt on terminal states', () => {
  it('转换到 completed 时设置 completedAt', () => {
    const before = Date.now()
    const task = makeTask('in_progress')
    const next = transition(task, 'completed')

    expect(next.completedAt).toBeDefined()
    expect(next.completedAt!).toBeGreaterThanOrEqual(before)
  })

  it('转换到 cancelled 时设置 completedAt', () => {
    const before = Date.now()
    const task = makeTask('suspended')
    const next = transition(task, 'cancelled')

    expect(next.completedAt).toBeDefined()
    expect(next.completedAt!).toBeGreaterThanOrEqual(before)
  })

  it('非终态转换不设置 completedAt', () => {
    const task = makeTask('pending')
    const next = transition(task, 'in_progress')

    expect(next.completedAt).toBeUndefined()
  })
})
