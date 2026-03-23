import type { ITaskPort, CreateTaskInput, UpdateTaskInput } from '@/lib/environment/interfaces/task.port'
import type { TaskNode, TaskStatus } from '@/lib/types/task'
import { canTransition, transition } from '@/lib/types/task'
import { createUuidV4 } from '@/lib/utils/uuid'
import { MOCK_TASK_NODES_FIXTURE } from './fixtures/tasks'

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const ALL_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'suspended', 'completed', 'cancelled']

export class TaskMockAdapter implements ITaskPort {
  private tasks: TaskNode[] = deepClone(MOCK_TASK_NODES_FIXTURE)

  async listTasks(includeCancelled = false): Promise<TaskNode[]> {
    const all = deepClone(this.tasks)
    return includeCancelled ? all : all.filter(t => t.status !== 'cancelled')
  }

  async getTaskById(id: string): Promise<TaskNode | null> {
    const task = this.tasks.find(t => t.id === id)
    return task ? deepClone(task) : null
  }

  async createTask(input: CreateTaskInput): Promise<TaskNode> {
    const now = Date.now()
    const task: TaskNode = {
      id: createUuidV4(),
      title: input.title.trim(),
      description: input.description,
      doneCondition: input.doneCondition,
      status: 'pending',
      priority: input.priority ?? 'medium',
      dueAt: input.dueAt,
      source: input.source,
      parentId: input.parentId,
      dependsOn: [],
      tags: input.tags ?? [],
      estimatedMinutes: input.estimatedMinutes,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.push(task)
    return deepClone(task)
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<TaskNode | null> {
    const idx = this.tasks.findIndex(t => t.id === id)
    if (idx === -1) return null
    const current = this.tasks[idx]
    const now = Date.now()
    const nextUpdatedAt = now > current.updatedAt ? now : current.updatedAt + 1
    const updated: TaskNode = { ...current, ...input, updatedAt: nextUpdatedAt }
    this.tasks[idx] = updated
    return deepClone(updated)
  }

  async cancelTask(id: string): Promise<TaskNode | null> {
    const task = this.tasks.find(t => t.id === id)
    if (!task) return null
    const cancelled = transition(task, 'cancelled')
    this.tasks = this.tasks.map(t => t.id === id ? cancelled : t)
    return deepClone(cancelled)
  }

  async transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null> {
    const task = this.tasks.find(t => t.id === id)
    if (!task) return null
    const transitioned = transition(task, to)
    this.tasks = this.tasks.map(t => t.id === id ? transitioned : t)
    return deepClone(transitioned)
  }

  async getAvailableTransitions(id: string): Promise<TaskStatus[]> {
    const task = await this.getTaskById(id)
    if (!task) return []
    return ALL_STATUSES.filter(s => canTransition(task.status, s))
  }
}
