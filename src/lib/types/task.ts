export interface Dependency {
  taskId: string
  type: 'soft' | 'hard'
}

/** 5 状态机：pending → in_progress ⇌ suspended → completed / cancelled */
export type TaskStatus = 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled'
export type LegacyTaskStatus = 'not_started' | 'abandoned'
export type CompatibleTaskStatus = TaskStatus | LegacyTaskStatus

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
  timeBlockIds?: string[]         // Phase4: 关联时间块 ID 列表（1:N）
  createdAt: number               // UTC timestamp，毫秒
  updatedAt: number
  completedAt?: number
}

export type TaskNodeLike = Omit<TaskNode, 'status'> & { status: CompatibleTaskStatus }

export function normalizeTaskStatus(status: CompatibleTaskStatus): TaskStatus {
  switch (status) {
    case 'not_started':
      return 'pending'
    case 'abandoned':
      return 'cancelled'
    default:
      return status
  }
}

export function toStoredTaskStatus(status: TaskStatus): CompatibleTaskStatus {
  // Stage-2: Persist canonical wire format to storage.
  // Legacy values are still accepted via `normalizeTaskStatus()` for backward compatibility.
  return status
}

export function normalizeTaskNode(task: TaskNodeLike): TaskNode {
  return {
    ...task,
    status: normalizeTaskStatus(task.status),
  }
}

export function isTerminalTaskStatus(status: CompatibleTaskStatus): boolean {
  const normalized = normalizeTaskStatus(status)
  return normalized === 'completed' || normalized === 'cancelled'
}

// 合法状态转换表
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['suspended', 'completed', 'cancelled'],
  suspended:   ['in_progress', 'completed', 'cancelled'],
  completed:   [],
  cancelled:   [],
}

/** 检查状态转换是否合法 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to)
}

/**
 * 执行状态转换，返回新的 TaskNode（不可变）。
 * 非法转换时抛出 Error。
 * 转换到 completed / cancelled 时同时设置 completedAt。
 */
export function transition(task: TaskNodeLike, to: TaskStatus): TaskNode {
  const normalizedTask = normalizeTaskNode(task)
  if (!canTransition(normalizedTask.status, to)) {
    throw new Error(
      `Invalid transition: ${normalizedTask.status} → ${to}`
    )
  }
  const now = Date.now()
  return {
    ...normalizedTask,
    status: to,
    updatedAt: now,
    ...(to === 'completed' || to === 'cancelled' ? { completedAt: now } : {}),
  }
}
