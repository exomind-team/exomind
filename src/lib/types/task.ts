export interface Dependency {
  taskId: string
  type: 'soft' | 'hard'
}

/** 5 状态机：not_started → in_progress ⇌ suspended → completed / abandoned */
export type TaskStatus = 'not_started' | 'in_progress' | 'suspended' | 'completed' | 'abandoned'

export type TaskPriority = 'low' | 'medium' | 'high'

export interface TaskNode {
  id: string
  title: string
  description?: string
  doneCondition?: string          // DOD 完成条件
  status: TaskStatus
  priority: TaskPriority
  dueAt?: number                  // 截止时间（UTC timestamp，毫秒）
  source?: string                 // 来源标识
  parentId?: string               // 父任务 ID（单父，允许为空=根节点）
  dependsOn: Dependency[]         // 依赖关系列表
  tags: string[]
  estimatedMinutes?: number
  spentMinutes?: number
  timeBlockIds?: string[]         // Phase4: 关联时间块 ID 列表（1:N）
  createdAt: number               // UTC timestamp，毫秒
  updatedAt: number
  completedAt?: number
}

// 合法状态转换表
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  not_started: ['in_progress'],
  in_progress: ['suspended', 'completed', 'abandoned'],
  suspended:   ['in_progress', 'completed', 'abandoned'],
  completed:   [],
  abandoned:   [],
}

/** 检查状态转换是否合法 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

/**
 * 执行状态转换，返回新的 TaskNode（不可变）。
 * 非法转换时抛出 Error。
 * 转换到 completed / abandoned 时同时设置 completedAt。
 */
export function transition(task: TaskNode, to: TaskStatus): TaskNode {
  if (!canTransition(task.status, to)) {
    throw new Error(
      `Invalid transition: ${task.status} → ${to}`
    )
  }
  const now = Date.now()
  return {
    ...task,
    status: to,
    updatedAt: now,
    ...(to === 'completed' || to === 'abandoned' ? { completedAt: now } : {}),
  }
}
