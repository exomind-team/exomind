/**
 * TaskTimerService - 任务↔时间块 1:N 计时关联
 *
 * 行为语义：任务在时间中推进（持续展开原则）
 * 架构不变量：任务必须通过时间块推进
 *
 * 职责：
 * - 从任务快速启动时间块（自动关联 blockId 到 task.timeBlockIds）
 * - 时间块结束时记录关联
 * - 关联查询与动态时长计算（spentMinutes 不持久化）
 */

import {
  resolveActiveBlockTaskIds,
  type ActiveBlockData,
  type BlockTaskAssociationEvent,
  type TimerConfig,
} from '@/lib/types/event'
import { getTaskService, type TaskService } from './task.service'
import { getTimeBlockService, type TimeBlockService } from './timeblock.service'
import type { TaskNode, TaskStatus } from '@/lib/types/task'
import { emitTaskLinked, emitTaskUnlinked } from './task-event-emitter'

export interface TaskTimerService {
  /** 从任务快速启动一个时间块，自动关联 */
  startBlockForTask(taskId: string, config?: TimerConfig): Promise<ActiveBlockData | null>

  /** 从多个任务启动一个时间块，建立多任务关联 */
  startBlockForTasks(taskIds: string[], config?: TimerConfig): Promise<ActiveBlockData | null>

  /** 运行中追加一个关联任务 */
  addTaskToBlock(taskId: string): Promise<void>

  /** 运行中移除一个关联任务 */
  removeTaskFromBlock(taskId: string): Promise<void>

  /** 时间块结束时回调：记录 blockId 关联（spentMinutes 动态计算，不持久化） */
  onBlockEndForTask(taskId: string, blockId: string): Promise<void>

  /** 时间块结束时回调：只为结束时仍关联的任务记录 blockId */
  onBlockEndForTasks(taskIds: string[], blockId: string): Promise<void>

  /** 获取任务关联的所有时间块 ID */
  getBlockIdsForTask(taskId: string): Promise<string[]>

  /** 计算任务已花费总时间（从关联时间块累计） */
  calculateSpentMinutes(taskId: string): Promise<number>

  /** 计算剩余预期分钟数（至少 1 分钟） */
  calculateRemainingMinutes(estimatedMinutes: number, spentMinutes: number): number
}

export class TaskTimerServiceImpl implements TaskTimerService {
  private readonly taskSvc: TaskService
  private readonly tbSvc: TimeBlockService

  constructor(taskSvc?: TaskService, tbSvc?: TimeBlockService) {
    this.taskSvc = taskSvc ?? getTaskService()
    this.tbSvc = tbSvc ?? getTimeBlockService()
  }

  async startBlockForTask(
    taskId: string,
    config: TimerConfig = { mode: 'countup' },
  ): Promise<ActiveBlockData | null> {
    return this.startBlockForTasks([taskId], config)
  }

  async startBlockForTasks(
    taskIds: string[],
    config: TimerConfig = { mode: 'countup' },
  ): Promise<ActiveBlockData | null> {
    const normalizedTaskIds = Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)))
    if (normalizedTaskIds.length === 0) return null
    const existingBlock = await this.tbSvc.loadActiveBlock()
    if (existingBlock) return existingBlock

    const tasks = await this.loadTasks(normalizedTaskIds)
    if (!tasks) return null

    for (const task of tasks) {
      const nextStatus = this.resolveAutoProgressStatus(task.status)
      if (nextStatus) {
        await this.taskSvc.transitionTask(task.id, nextStatus)
      }
    }

    const [primaryTask] = tasks
    if (!primaryTask) return null

    const block = await this.tbSvc.startBlock(primaryTask.title, config, undefined, { taskIds: normalizedTaskIds })
    await this.tbSvc.updateActiveBlock({
      taskIds: normalizedTaskIds,
      taskAssociationLog: this.ensureStartAssociationLog(
        block.taskAssociationLog ?? [],
        block.startId,
        normalizedTaskIds,
      ),
    })
    for (const task of tasks) {
      emitTaskLinked(task.id, task.title, block.startId, block.name)
    }

    return await this.tbSvc.loadActiveBlock() ?? block
  }

  async addTaskToBlock(taskId: string): Promise<void> {
    const normalizedTaskId = taskId.trim()
    if (!normalizedTaskId) return

    const activeBlock = await this.tbSvc.loadActiveBlock()
    if (!activeBlock) return

    const task = await this.taskSvc.getTask(normalizedTaskId)
    if (!task) return
    if (task.status === 'completed' || task.status === 'cancelled') return

    const existingTaskIds = resolveActiveBlockTaskIds(activeBlock)
    if (existingTaskIds.includes(normalizedTaskId)) return
    const dependencyCheck = await this.taskSvc.checkDependenciesMet(normalizedTaskId)
    const hardBlocking = dependencyCheck.blocking.filter((dependency) => dependency.type === 'hard')
    if (hardBlocking.length > 0) {
      const blockingIds = hardBlocking.map((dependency) => dependency.taskId).join(', ')
      throw new Error(`Cannot associate task to active block: hard dependencies not met [${blockingIds}]`)
    }

    const nextStatus = this.resolveAutoProgressStatus(task.status)
    if (nextStatus) {
      await this.taskSvc.transitionTask(task.id, nextStatus)
    }

    await this.tbSvc.updateActiveBlock({
      taskIds: [...existingTaskIds, normalizedTaskId],
      taskAssociationLog: this.appendAssociationEvent(
        activeBlock.taskAssociationLog ?? [],
        activeBlock.startId,
        normalizedTaskId,
        'associated',
      ),
    })
    emitTaskLinked(normalizedTaskId, task.title, activeBlock.startId, activeBlock.name)
  }

  async removeTaskFromBlock(taskId: string): Promise<void> {
    const normalizedTaskId = taskId.trim()
    if (!normalizedTaskId) return

    const activeBlock = await this.tbSvc.loadActiveBlock()
    if (!activeBlock) return

    const existingTaskIds = resolveActiveBlockTaskIds(activeBlock)
    if (!existingTaskIds.includes(normalizedTaskId)) return
    const task = await this.taskSvc.getTask(normalizedTaskId)

    await this.tbSvc.updateActiveBlock({
      taskIds: existingTaskIds.filter((existingTaskId) => existingTaskId !== normalizedTaskId),
      taskAssociationLog: this.appendAssociationEvent(
        activeBlock.taskAssociationLog ?? [],
        activeBlock.startId,
        normalizedTaskId,
        'disassociated',
      ),
    })
    emitTaskUnlinked(normalizedTaskId, task?.title ?? normalizedTaskId, activeBlock.startId, activeBlock.name)
  }

  async onBlockEndForTask(
    taskId: string,
    blockId: string,
  ): Promise<void> {
    await this.onBlockEndForTasks([taskId], blockId)
  }

  async onBlockEndForTasks(taskIds: string[], blockId: string): Promise<void> {
    const normalizedTaskIds = Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)))
    for (const taskId of normalizedTaskIds) {
      const task = await this.taskSvc.getTask(taskId)
      if (!task) continue

      const existingIds = task.timeBlockIds ?? []
      if (!existingIds.includes(blockId)) {
        await this.taskSvc.updateTask(taskId, {
          timeBlockIds: [...existingIds, blockId],
        })
      }
    }
  }

  async getBlockIdsForTask(taskId: string): Promise<string[]> {
    const task = await this.taskSvc.getTask(taskId)
    if (!task) return []
    return task.timeBlockIds ?? []
  }

  calculateRemainingMinutes(estimatedMinutes: number, spentMinutes: number): number {
    return Math.max(1, Math.round(estimatedMinutes - spentMinutes));
  }

  async calculateSpentMinutes(taskId: string): Promise<number> {
    const task = await this.taskSvc.getTask(taskId)
    if (!task) return 0

    const blockIds = task.timeBlockIds ?? []
    if (blockIds.length === 0) return 0

    // 从已完成时间块列表中查找匹配的块
    const allBlocks = await this.tbSvc.loadTimeBlocks()
    let totalMs = 0
    for (const block of allBlocks) {
      if (blockIds.includes(block.startId)) {
        totalMs += Math.max(0, block.endTime - block.startTime)
      }
    }

    return Math.round(totalMs / 60_000)
  }

  private async loadTasks(taskIds: string[]): Promise<TaskNode[] | null> {
    const tasks = await Promise.all(taskIds.map((taskId) => this.taskSvc.getTask(taskId)))
    if (tasks.some((task) => !task)) return null

    const resolvedTasks = tasks.filter((task): task is TaskNode => task !== null)
    if (resolvedTasks.some((task) => task.status === 'completed' || task.status === 'cancelled')) {
      return null
    }

    return resolvedTasks
  }

  private resolveAutoProgressStatus(status: TaskStatus): TaskStatus | null {
    if (status === 'pending' || status === 'suspended') {
      return 'in_progress'
    }
    return null
  }

  private appendAssociationEvent(
    existing: BlockTaskAssociationEvent[],
    blockId: string,
    taskId: string,
    action: BlockTaskAssociationEvent['action'],
  ): BlockTaskAssociationEvent[] {
    return [
      ...existing,
      {
        blockId,
        taskId,
        action,
        timestamp: Date.now(),
        source: 'manual',
      },
    ]
  }

  private ensureStartAssociationLog(
    existing: BlockTaskAssociationEvent[],
    blockId: string,
    taskIds: string[],
  ): BlockTaskAssociationEvent[] {
    const normalizedTaskIds = Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)))
    if (normalizedTaskIds.length === 0) return existing

    const existingKeys = new Set(
      existing
        .filter((event) => event.action === 'associated')
        .map((event) => `${event.blockId}::${event.taskId}`),
    )

    const missingEvents = normalizedTaskIds
      .filter((taskId) => !existingKeys.has(`${blockId}::${taskId}`))
      .map((taskId) => ({
        blockId,
        taskId,
        action: 'associated' as const,
        timestamp: Date.now(),
        source: 'block_start' as const,
      }))

    return missingEvents.length > 0 ? [...existing, ...missingEvents] : existing
  }
}

let instance: TaskTimerService | null = null

export function getTaskTimerService(): TaskTimerService {
  if (!instance) instance = new TaskTimerServiceImpl()
  return instance
}
