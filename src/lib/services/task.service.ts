import { ExoMindEnvironment } from '@/lib/environment/environment'
import type { ITaskPort, CreateTaskInput, UpdateTaskInput } from '@/lib/environment/interfaces/task.port'
import type { TaskNode, TaskStatus } from '@/lib/types/task'
import { mergeTasksById, type ImportStrategy } from '@/lib/eventlog/transfer'
import { getTaskStorage } from '@/lib/storage/task-storage'
import { getCurrentUserId } from '@/lib/storage/event-storage'

type TaskEnvironmentLike = {
  task: ITaskPort
}

export interface DependencyCheckResult {
  met: boolean
  blocking: Array<{ taskId: string; type: 'soft' | 'hard'; status: TaskStatus }>
}

export interface TaskBackupImportResult {
  imported: number
  skipped: number
  total: number
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
  private syncUnsubscribe: (() => void) | null = null
  private changeListeners = new Set<() => void>()

  constructor(env?: TaskEnvironmentLike) {
    this.env = env ?? ExoMindEnvironment.getInstance()
  }

  private getStorage() {
    return getTaskStorage(getCurrentUserId())
  }

  listTasks(includeAbandoned = false) {
    return this.env.task.listTasks(includeAbandoned)
  }

  getTask(id: string) {
    return this.env.task.getTaskById(id)
  }

  async createTask(input: CreateTaskInput): Promise<TaskNode> {
    if (input.parentId) {
      const parent = await this.env.task.getTaskById(input.parentId)
      if (!parent) throw new Error(`Parent task ${input.parentId} not found`)
    }
    return this.env.task.createTask(input)
  }

  updateTask(id: string, input: UpdateTaskInput) {
    return this.env.task.updateTask(id, input)
  }

  abandonTask(id: string) {
    return this.env.task.abandonTask(id)
  }

  async transitionTask(id: string, to: TaskStatus): Promise<TaskNode | null> {
    if (to === 'in_progress') {
      const depCheck = await this.checkDependenciesMet(id)
      const hardBlocking = depCheck.blocking.filter((b) => b.type === 'hard')
      if (hardBlocking.length > 0) {
        const ids = hardBlocking.map((b) => b.taskId).join(', ')
        throw new Error(`Cannot transition to in_progress: hard dependencies not met [${ids}]`)
      }
    }
    return this.env.task.transitionTask(id, to)
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
      return this.env.task.updateTask(taskId, { dependsOn: updated })
    }

    // 环检测
    if (await this.wouldCreateDependencyCycle(taskId, depTaskId)) {
      throw new Error(`Adding dependency ${taskId} → ${depTaskId} would create a cycle`)
    }

    const newDeps = [...task.dependsOn, { taskId: depTaskId, type }]
    return this.env.task.updateTask(taskId, { dependsOn: newDeps })
  }

  async removeDependency(taskId: string, depTaskId: string): Promise<TaskNode | null> {
    const task = await this.env.task.getTaskById(taskId)
    if (!task) return null
    const newDeps = task.dependsOn.filter((d) => d.taskId !== depTaskId)
    return this.env.task.updateTask(taskId, { dependsOn: newDeps })
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
      } else if (dep.type === 'soft' && depTask.status === 'not_started') {
        blocking.push({ taskId: dep.taskId, type: dep.type, status: depTask.status })
      }
    }

    return { met: blocking.length === 0, blocking }
  }

  /* ── Sync ── */

  async startSync(remoteUrl: string): Promise<void> {
    const storage = this.getStorage()
    // Subscribe to remote changes to notify UI
    if (!this.syncUnsubscribe) {
      this.syncUnsubscribe = storage.onRemoteChange(() => {
        this.notifyChangeListeners()
      })
    }
    await storage.syncToRemote(remoteUrl)
  }

  async stopSync(): Promise<void> {
    if (this.syncUnsubscribe) {
      this.syncUnsubscribe()
      this.syncUnsubscribe = null
    }
    await this.getStorage().stopSync()
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

let instance: TaskService | null = null

export function getTaskService(): TaskService {
  if (!instance) instance = new TaskServiceImpl()
  return instance
}

function sortTasksForStorageWrite(tasks: TaskNode[]): TaskNode[] {
  return [...tasks].sort((a, b) => (a.createdAt - b.createdAt) || (a.updatedAt - b.updatedAt))
}

export async function exportTasksForBackup(): Promise<TaskNode[]> {
  return getTaskService().listTasks(true)
}

export async function importTasksFromBackup(
  tasks: TaskNode[],
  strategy: ImportStrategy,
): Promise<TaskBackupImportResult> {
  const incoming = mergeTasksById([], tasks)
  const existing = await getTaskService().listTasks(true)

  let next: TaskNode[]
  let imported = 0
  let skipped = 0

  if (strategy === 'overwrite') {
    next = incoming
    imported = incoming.length
  } else {
    const existingIds = new Set(existing.map((task) => task.id))
    imported = incoming.filter((task) => !existingIds.has(task.id)).length
    skipped = incoming.length - imported
    next = mergeTasksById(existing, incoming)
  }

  const storage = getTaskStorage(getCurrentUserId())
  const nextSorted = sortTasksForStorageWrite(next)
  const existingSorted = sortTasksForStorageWrite(existing)

  try {
    await storage.clearAll()
    for (const task of nextSorted) {
      await storage.addTask(task)
    }
  } catch (error) {
    try {
      await storage.clearAll()
      for (const task of existingSorted) {
        await storage.addTask(task)
      }
    } catch (rollbackError) {
      const importMessage = error instanceof Error ? error.message : String(error)
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      throw new Error(`任务导入失败且回滚失败：${importMessage}; rollback=${rollbackMessage}`)
    }
    throw error
  }

  return {
    imported,
    skipped,
    total: next.length,
  }
}
