import { ExoMindEnvironment } from '@/lib/environment/environment'
import type { ITaskPort, CreateTaskInput, UpdateTaskInput } from '@/lib/environment/interfaces/task.port'
import type { TaskNode, TaskStatus } from '@/lib/types/task'

type TaskEnvironmentLike = {
  task: ITaskPort
}

export interface TaskService {
  listTasks(includeAbandoned?: boolean): Promise<TaskNode[]>
  getTask(id: string): Promise<TaskNode | null>
  createTask(input: CreateTaskInput): Promise<TaskNode>
  updateTask(id: string, input: UpdateTaskInput): Promise<TaskNode | null>
  // 行为语义：删除=放弃
  abandonTask(id: string): Promise<TaskNode | null>
  transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null>
  getAvailableTransitions(id: string): Promise<TaskStatus[]>
}

export class TaskServiceImpl implements TaskService {
  private readonly env: TaskEnvironmentLike

  constructor(env?: TaskEnvironmentLike) {
    this.env = env ?? ExoMindEnvironment.getInstance()
  }

  listTasks(includeAbandoned = false) {
    return this.env.task.listTasks(includeAbandoned)
  }

  getTask(id: string) {
    return this.env.task.getTaskById(id)
  }

  createTask(input: CreateTaskInput) {
    return this.env.task.createTask(input)
  }

  updateTask(id: string, input: UpdateTaskInput) {
    return this.env.task.updateTask(id, input)
  }

  abandonTask(id: string) {
    return this.env.task.abandonTask(id)
  }

  transitionTask(id: string, to: TaskStatus) {
    return this.env.task.transitionTask(id, to)
  }

  getAvailableTransitions(id: string) {
    return this.env.task.getAvailableTransitions(id)
  }
}

let instance: TaskService | null = null

export function getTaskService(): TaskService {
  if (!instance) instance = new TaskServiceImpl()
  return instance
}
