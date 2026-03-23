import type { Dependency, TaskNode, TaskStatus } from '@/lib/types/task'

export interface CreateTaskInput {
  title: string
  description?: string
  doneCondition?: string
  priority?: 'low' | 'medium' | 'high'
  dueAt?: number
  source?: string
  parentId?: string
  tags?: string[]
  estimatedMinutes?: number
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  doneCondition?: string
  priority?: 'low' | 'medium' | 'high'
  dueAt?: number
  source?: string
  parentId?: string
  dependsOn?: Dependency[]
  tags?: string[]
  estimatedMinutes?: number
  timeBlockIds?: string[]
}

export interface ITaskPort {
  listTasks(includeCancelled?: boolean): Promise<TaskNode[]>
  getTaskById(id: string): Promise<TaskNode | null>
  createTask(input: CreateTaskInput): Promise<TaskNode>
  updateTask(id: string, input: UpdateTaskInput): Promise<TaskNode | null>
  // 行为语义：删除=取消 / 不变量：不可删除原则
  cancelTask(id: string): Promise<TaskNode | null>
  transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null>
  getAvailableTransitions(id: string): Promise<TaskStatus[]>
}
