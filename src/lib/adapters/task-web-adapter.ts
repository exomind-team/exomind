import type { ITaskPort, CreateTaskInput, UpdateTaskInput } from '@/lib/environment/interfaces/task.port'
import { WebStorageAdapter } from '@/lib/adapters/web-storage'
import type { TaskNode, TaskStatus } from '@/lib/types/task'
import { canTransition, transition } from '@/lib/types/task'
import { createUuidV4 } from '@/lib/utils/uuid'

const STORAGE_KEY = 'task_nodes_v2'
const ALL_STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'suspended', 'completed', 'abandoned']

export class TaskWebAdapter implements ITaskPort {
  private readonly storage = new WebStorageAdapter()

  private async readAll(): Promise<TaskNode[]> {
    const data = await this.storage.read<TaskNode[]>(STORAGE_KEY)
    return Array.isArray(data) ? data : []
  }

  private async writeAll(tasks: TaskNode[]): Promise<void> {
    await this.storage.write(STORAGE_KEY, tasks)
  }

  async listTasks(includeAbandoned = false): Promise<TaskNode[]> {
    const tasks = await this.readAll()
    return includeAbandoned ? tasks : tasks.filter(t => t.status !== 'abandoned')
  }

  async getTaskById(id: string): Promise<TaskNode | null> {
    const tasks = await this.readAll()
    return tasks.find(t => t.id === id) ?? null
  }

  async createTask(input: CreateTaskInput): Promise<TaskNode> {
    const tasks = await this.readAll()
    const now = Date.now()
    const task: TaskNode = {
      id: createUuidV4(),
      title: input.title.trim(),
      description: input.description,
      doneCondition: input.doneCondition,
      status: 'not_started',
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
    await this.writeAll([...tasks, task])
    return task
  }

  async updateTask(id: string, input: UpdateTaskInput): Promise<TaskNode | null> {
    const tasks = await this.readAll()
    const idx = tasks.findIndex(t => t.id === id)
    if (idx === -1) return null
    const updated: TaskNode = { ...tasks[idx], ...input, updatedAt: Date.now() }
    const next = [...tasks]
    next[idx] = updated
    await this.writeAll(next)
    return updated
  }

  async abandonTask(id: string): Promise<TaskNode | null> {
    const tasks = await this.readAll()
    const task = tasks.find(t => t.id === id)
    if (!task) return null
    const abandoned = transition(task, 'abandoned')
    const next = tasks.map(t => t.id === id ? abandoned : t)
    await this.writeAll(next)
    return abandoned
  }

  async transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null> {
    const tasks = await this.readAll()
    const task = tasks.find(t => t.id === id)
    if (!task) return null
    const transitioned = transition(task, to)
    const next = tasks.map(t => t.id === id ? transitioned : t)
    await this.writeAll(next)
    return transitioned
  }

  async getAvailableTransitions(id: string): Promise<TaskStatus[]> {
    const task = await this.getTaskById(id)
    if (!task) return []
    return ALL_STATUSES.filter(s => canTransition(task.status, s))
  }
}
