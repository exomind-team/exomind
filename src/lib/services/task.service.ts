import { ExoMindEnvironment } from '@/lib/environment/environment'
import type { DomainBackendMode } from '@/config/domain-backend-mode'
import type { ITaskPort, CreateTaskInput, UpdateTaskInput } from '@/lib/environment/interfaces/task.port'
import type { TaskNode, TaskStatus } from '@/lib/types/task'
import { emitTaskCreated, emitTaskTransition } from './task-event-emitter'
import { PerfTrace } from '@/lib/utils/perf-trace'

type TaskEnvironmentLike = {
  task: ITaskPort
  runtime?: 'web' | 'tauri'
}

export interface TaskServiceOptions {
  backendMode?: DomainBackendMode
}

export interface DependencyCheckResult {
  met: boolean
  blocking: Array<{ taskId: string; type: 'soft' | 'hard'; status: TaskStatus }>
}

export interface TaskDependencySnapshot {
  tasks: TaskNode[]
  hardBlockedTaskIds: Set<string>
}

export interface TaskDependencySnapshotOptions {
  candidateTaskFilter?: (task: TaskNode) => boolean
}

export interface TaskService {
  listTasks(includeCancelled?: boolean): Promise<TaskNode[]>
  listTasksWithDependencyStatus?(
    includeCancelled?: boolean,
    options?: TaskDependencySnapshotOptions,
  ): Promise<TaskDependencySnapshot>
  getTask(id: string): Promise<TaskNode | null>
  createTask(input: CreateTaskInput): Promise<TaskNode>
  updateTask(id: string, input: UpdateTaskInput): Promise<TaskNode | null>
  // 行为语义：删除=取消
  cancelTask(id: string): Promise<TaskNode | null>
  transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null>
  getAvailableTransitions(id: string): Promise<TaskStatus[]>
  // Phase3: 父子层级
  getChildTasks(parentId: string): Promise<TaskNode[]>
  // Phase3: 依赖管理
  addDependency(taskId: string, depTaskId: string, type: 'soft' | 'hard'): Promise<TaskNode | null>
  removeDependency(taskId: string, depTaskId: string): Promise<TaskNode | null>
  checkDependenciesMet(taskId: string): Promise<DependencyCheckResult>
  // Sync: live PouchDB replication
  startSync(remoteUrl: string): Promise<void>
  stopSync(): Promise<void>
  onTaskChange(callback: () => void): () => void
}

export class TaskServiceImpl implements TaskService {
  private readonly env: TaskEnvironmentLike
  private readonly useInjectedEnv: boolean
  private readonly backendMode: DomainBackendMode
  private changeListeners = new Set<() => void>()

  constructor(env?: TaskEnvironmentLike, options: TaskServiceOptions = {}) {
    this.env = env ?? ExoMindEnvironment.getInstance()
    this.useInjectedEnv = typeof env !== 'undefined'
    this.backendMode = options.backendMode ?? this.resolveDefaultBackendMode()
  }

  listTasks(includeCancelled = false) {
    return this.env.task.listTasks(includeCancelled)
  }

  async listTasksWithDependencyStatus(
    includeCancelled = false,
    options: TaskDependencySnapshotOptions = {},
  ): Promise<TaskDependencySnapshot> {
    const trace = new PerfTrace('TaskService listTasksWithDependencyStatus', {
      includeCancelled,
    })
    const tasks = await this.env.task.listTasks(includeCancelled)
    const candidateTasks = options.candidateTaskFilter
      ? tasks.filter(options.candidateTaskFilter)
      : tasks
    trace.step('list-tasks', {
      candidateCount: candidateTasks.length,
      taskCount: tasks.length,
    })

    const tasksById = new Map(tasks.map((task) => [task.id, task]))
    const hardBlockedTaskIds = new Set<string>()

    for (const task of candidateTasks) {
      if (hasHardBlockingDependency(this.checkDependenciesMetFromTaskMap(task, tasksById))) {
        hardBlockedTaskIds.add(task.id)
      }
    }

    trace.finish({
      candidateCount: candidateTasks.length,
      hardBlockedCount: hardBlockedTaskIds.size,
      taskCount: tasks.length,
    })

    return {
      tasks,
      hardBlockedTaskIds,
    }
  }

  getTask(id: string) {
    return this.env.task.getTaskById(id)
  }

  async createTask(input: CreateTaskInput): Promise<TaskNode> {
    if (input.parentId) {
      const parent = await this.env.task.getTaskById(input.parentId)
      if (!parent) throw new Error(`Parent task ${input.parentId} not found`)
    }
    const created = await this.env.task.createTask(input)
    this.notifyChangeListeners()
    emitTaskCreated(created.id, created.title)
    return created
  }

  async updateTask(id: string, input: UpdateTaskInput) {
    const updated = await this.env.task.updateTask(id, input)
    if (updated) {
      this.notifyChangeListeners()
    }
    return updated
  }

  async cancelTask(id: string) {
    const before = await this.env.task.getTaskById(id)
    const fromStatus = before?.status ?? 'pending'
    const task = await this.env.task.cancelTask(id)
    if (task) {
      this.notifyChangeListeners()
      if (this.shouldEmitTransitionEvents()) {
        emitTaskTransition(task.id, task.title, fromStatus, 'cancelled')
      }
    }
    return task
  }

  async transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null> {
    const before = await this.env.task.getTaskById(id)
    if (!before) return null
    const fromStatus = before.status

    if (to === 'in_progress') {
      const depCheck = await this.checkDependenciesMet(id)
      const hardBlocking = depCheck.blocking.filter((b) => b.type === 'hard')
      if (hardBlocking.length > 0) {
        const ids = hardBlocking.map((b) => b.taskId).join(', ')
        throw new Error(`Cannot transition to in_progress: hard dependencies not met [${ids}]`)
      }
    }
    const transitioned = await this.env.task.transitionTask(id, to)
    if (transitioned) {
      this.notifyChangeListeners()
      if (this.shouldEmitTransitionEvents()) {
        emitTaskTransition(transitioned.id, transitioned.title, fromStatus, to)
      }
    }
    return transitioned
  }

  getAvailableTransitions(id: string) {
    return this.env.task.getAvailableTransitions(id)
  }

  async getChildTasks(parentId: string): Promise<TaskNode[]> {
    const all = await this.env.task.listTasks(true)
    return all.filter((t) => t.parentId === parentId)
  }

  async addDependency(
    taskId: string,
    depTaskId: string,
    type: 'soft' | 'hard',
  ): Promise<TaskNode | null> {
    if (taskId === depTaskId) throw new Error('A task cannot depend on itself')

    const task = await this.env.task.getTaskById(taskId)
    if (!task) return null

    const depTask = await this.env.task.getTaskById(depTaskId)
    if (!depTask) throw new Error(`Dependency target ${depTaskId} not found`)

    // 已有该依赖则更新 type
    const existing = task.dependsOn.find((d) => d.taskId === depTaskId)
    if (existing) {
      if (existing.type === type) return task
      const updated = task.dependsOn.map((d) => (d.taskId === depTaskId ? { ...d, type } : d))
      return this.updateTask(taskId, { dependsOn: updated })
    }

    // 环检测
    if (await this.wouldCreateDependencyCycle(taskId, depTaskId)) {
      throw new Error(`Adding dependency ${taskId} → ${depTaskId} would create a cycle`)
    }

    const newDeps = [...task.dependsOn, { taskId: depTaskId, type }]
    return this.updateTask(taskId, { dependsOn: newDeps })
  }

  async removeDependency(taskId: string, depTaskId: string): Promise<TaskNode | null> {
    const task = await this.env.task.getTaskById(taskId)
    if (!task) return null
    const newDeps = task.dependsOn.filter((d) => d.taskId !== depTaskId)
    return this.updateTask(taskId, { dependsOn: newDeps })
  }

  async checkDependenciesMet(taskId: string): Promise<DependencyCheckResult> {
    const task = await this.env.task.getTaskById(taskId)
    if (!task) return { met: true, blocking: [] }

    const blocking: DependencyCheckResult['blocking'] = []

    for (const dep of task.dependsOn) {
      const depTask = await this.env.task.getTaskById(dep.taskId)
      if (!depTask) continue // 缺失的依赖视为不阻塞

      if (dep.type === 'hard' && depTask.status !== 'completed') {
        blocking.push({ taskId: dep.taskId, type: dep.type, status: depTask.status })
      } else if (dep.type === 'soft' && depTask.status === 'pending') {
        blocking.push({ taskId: dep.taskId, type: dep.type, status: depTask.status })
      }
    }

    return { met: blocking.length === 0, blocking }
  }

  /* ── Sync ── */

  async startSync(_remoteUrl: string): Promise<void> {
    // Legacy no-op: task data no longer depends on PouchDB live sync.
  }

  async stopSync(): Promise<void> {
    // Legacy no-op: task data no longer depends on PouchDB live sync.
  }

  onTaskChange(callback: () => void): () => void {
    this.changeListeners.add(callback)
    return () => { this.changeListeners.delete(callback) }
  }

  private notifyChangeListeners(): void {
    for (const listener of this.changeListeners) {
      try { listener() } catch { /* ignore */ }
    }
  }

  notifyExternalChange(): void {
    this.notifyChangeListeners()
  }

  private resolveDefaultBackendMode(): DomainBackendMode {
    if (this.useInjectedEnv) {
      return 'legacy'
    }

    return 'rt-sqlite'
  }

  private shouldEmitTransitionEvents(): boolean {
    return this.backendMode !== 'rt-sqlite'
  }

  private checkDependenciesMetFromTaskMap(
    task: TaskNode | null | undefined,
    tasksById: ReadonlyMap<string, TaskNode>,
  ): DependencyCheckResult {
    if (!task) {
      return { met: true, blocking: [] }
    }

    const blocking: DependencyCheckResult['blocking'] = []

    for (const dep of task.dependsOn) {
      const depTask = tasksById.get(dep.taskId)
      if (!depTask) continue

      if (dep.type === 'hard' && depTask.status !== 'completed') {
        blocking.push({ taskId: dep.taskId, type: dep.type, status: depTask.status })
      } else if (dep.type === 'soft' && depTask.status === 'pending') {
        blocking.push({ taskId: dep.taskId, type: dep.type, status: depTask.status })
      }
    }

    return { met: blocking.length === 0, blocking }
  }

  /**
   * BFS 环检测：添加 taskId → depTaskId 后，
   * 是否能从 depTaskId 沿 dependsOn 到达 taskId。
   */
  private async wouldCreateDependencyCycle(taskId: string, depTaskId: string): Promise<boolean> {
    const visited = new Set<string>()
    const queue = [depTaskId]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === taskId) return true
      if (visited.has(current)) continue
      visited.add(current)

      const task = await this.env.task.getTaskById(current)
      if (!task) continue
      for (const dep of task.dependsOn) {
        if (!visited.has(dep.taskId)) {
          queue.push(dep.taskId)
        }
      }
    }

    return false
  }
}

function hasHardBlockingDependency(dependencyCheck: DependencyCheckResult): boolean {
  return dependencyCheck.blocking.some((dependency) => dependency.type === 'hard')
}

export async function loadTaskDependencySnapshot(
  taskService: Pick<TaskService, 'listTasks' | 'checkDependenciesMet'> & Partial<Pick<TaskService, 'listTasksWithDependencyStatus'>>,
  includeCancelled = false,
  options: TaskDependencySnapshotOptions = {},
): Promise<TaskDependencySnapshot> {
  if (typeof taskService.listTasksWithDependencyStatus === 'function') {
    return taskService.listTasksWithDependencyStatus(includeCancelled, options)
  }

  const tasks = await taskService.listTasks(includeCancelled)
  const candidateTasks = options.candidateTaskFilter
    ? tasks.filter(options.candidateTaskFilter)
    : tasks
  const hardBlockedTaskIds = new Set<string>()

  await Promise.all(candidateTasks.map(async (task) => {
    try {
      const dependencyCheck = await taskService.checkDependenciesMet(task.id)
      if (hasHardBlockingDependency(dependencyCheck)) {
        hardBlockedTaskIds.add(task.id)
      }
    } catch {
      hardBlockedTaskIds.add(task.id)
    }
  }))

  return {
    tasks,
    hardBlockedTaskIds,
  }
}

let instance: TaskService | null = null

export function getTaskService(): TaskService {
  if (!instance) instance = new TaskServiceImpl()
  return instance
}

export function notifyTaskDataChanged(): void {
  if (instance && instance instanceof TaskServiceImpl) {
    instance.notifyExternalChange()
  }
}
