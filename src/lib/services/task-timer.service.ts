/**
 * TaskTimerService - 任务↔时间块 1:N 计时关联
 *
 * 行为语义：任务在时间中推进（持续展开原则）
 * 架构不变量：任务必须通过时间块推进
 *
 * 职责：
 * - 从任务快速启动时间块（建立任务 ↔ 时间块关联）
 * - 时间块结束时把该时间块写回所有历史上关联过它的任务
 * - 关联查询与动态时长计算（spentMinutes 不持久化）
 */

import {
  calculateTaskAssociationDurationMs,
  resolveActiveBlockTaskIds,
  resolveTimeBlockRelatedTaskIds,
  type ActiveBlockData,
  type BlockTaskAssociationEvent,
  type TimerConfig,
} from '@/lib/types/event'
import { getTaskService, type TaskService } from './task.service'
import { getTimeBlockService, type TimeBlockService } from './timeblock.service'
import type { TaskNode, TaskStatus } from '@/lib/types/task'
import { emitTaskLinked, emitTaskUnlinked } from './task-event-emitter'
import { PerfTrace } from '@/lib/utils/perf-trace'

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

  /** 时间块结束时回调：为时间块历史上关联过的所有任务记录 blockId */
  onBlockEndForTasks(taskIds: string[], blockId: string): Promise<void>

  /** 获取任务关联的所有时间块 ID */
  getBlockIdsForTask(taskId: string): Promise<string[]>

  /** 计算任务已花费总时间（按任务在各关联时间块中的实际关联时长累计） */
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
    const trace = new PerfTrace('TaskTimerService startBlockForTasks', {
      mode: config.mode,
      targetMinutes: config.mode === 'countdown' ? config.minutes ?? null : null,
      taskCount: normalizedTaskIds.length,
    })

    try {
      const existingBlock = await this.tbSvc.loadActiveBlock()
      trace.step('load-active-block', {
        hasExisting: Boolean(existingBlock),
      })
      if (existingBlock) {
        const existingTaskIds = resolveActiveBlockTaskIds(existingBlock)
        const retryTaskIds = normalizedTaskIds.filter((taskId) => existingTaskIds.includes(taskId))
        await this.reconcileAssociatedTaskProgress(retryTaskIds)
        trace.step('reconcile-associated-task-progress', {
          retryTaskCount: retryTaskIds.length,
        })
        trace.finish({
          outcome: 'reuse-existing',
          existingTaskCount: existingTaskIds.length,
          retryTaskCount: retryTaskIds.length,
          startId: existingBlock.startId,
        })
        return existingBlock
      }

      const tasks = await this.loadTasks(normalizedTaskIds)
      trace.step('load-tasks', {
        foundAllTasks: Boolean(tasks),
        loadedTaskCount: tasks?.length ?? 0,
      })
      if (!tasks) {
        trace.finish({
          outcome: 'missing-or-terminal-task',
        })
        return null
      }
      const autoProgressCandidates = await this.resolveAutoProgressCandidates(tasks)
      trace.step('resolve-auto-progress-candidates', {
        autoProgressCount: autoProgressCandidates.length,
      })

      const [primaryTask] = tasks
      if (!primaryTask) {
        trace.finish({
          outcome: 'missing-primary-task',
        })
        return null
      }

      const block = await this.tbSvc.startBlock(
        primaryTask.title,
        config,
        undefined,
        { taskIds: normalizedTaskIds },
        {
          traceId: trace.traceId,
          trigger: 'TaskTimerService.startBlockForTasks',
          source: 'TaskTimerService',
        },
      )
      trace.step('tb-start-block', {
        startId: block.startId,
        blockTaskCount: resolveActiveBlockTaskIds(block).length,
      })
      const requiredTaskAssociationLog = this.ensureStartAssociationLog(
        block.taskAssociationLog ?? [],
        block.startId,
        normalizedTaskIds,
      )
      const updatedBlock = await this.tbSvc.updateActiveBlock({
        taskIds: normalizedTaskIds,
        taskAssociationLog: requiredTaskAssociationLog,
      })
      trace.step('tb-update-active-block', {
        requiredAssociationCount: requiredTaskAssociationLog.length,
        updated: Boolean(updatedBlock),
      })
      if (!updatedBlock) {
        throw new Error('Failed to persist active block association')
      }
      for (const candidate of autoProgressCandidates) {
        await this.taskSvc.transitionTask(candidate.task.id, candidate.nextStatus)
      }
      trace.step('transition-auto-progress-tasks', {
        autoProgressCount: autoProgressCandidates.length,
      })
      for (const task of tasks) {
        emitTaskLinked(task.id, task.title, block.startId, block.name)
      }
      trace.step('emit-task-linked', {
        linkedTaskCount: tasks.length,
      })

      const finalBlock = await this.tbSvc.loadActiveBlock() ?? block
      trace.step('load-final-active-block', {
        startId: finalBlock.startId,
      })
      trace.finish({
        outcome: 'started',
        autoProgressCount: autoProgressCandidates.length,
        linkedTaskCount: tasks.length,
        startId: finalBlock.startId,
      })
      return finalBlock
    } catch (error) {
      trace.fail(error)
      throw error
    }
  }

  async addTaskToBlock(taskId: string): Promise<void> {
    const normalizedTaskId = taskId.trim()
    if (!normalizedTaskId) return
    const trace = new PerfTrace('TaskTimerService addTaskToBlock', {
      taskId: normalizedTaskId,
    })

    try {
      const activeBlock = await this.tbSvc.loadActiveBlock()
      trace.step('load-active-block', {
        hasActiveBlock: Boolean(activeBlock),
      })
      if (!activeBlock) {
        trace.finish({
          outcome: 'no-active-block',
        })
        return
      }

      const task = await this.taskSvc.getTask(normalizedTaskId)
      trace.step('load-task', {
        foundTask: Boolean(task),
        status: task?.status ?? null,
      })
      if (!task) {
        trace.finish({
          outcome: 'missing-task',
        })
        return
      }
      if (task.status === 'completed' || task.status === 'cancelled') {
        trace.finish({
          outcome: 'terminal-task',
          status: task.status,
        })
        return
      }

      const existingTaskIds = resolveActiveBlockTaskIds(activeBlock)
      if (existingTaskIds.includes(normalizedTaskId)) {
        await this.reconcileAssociatedTaskProgress([normalizedTaskId])
        trace.step('reconcile-associated-task-progress', {
          existingTaskCount: existingTaskIds.length,
        })
        trace.finish({
          outcome: 'already-associated',
          existingTaskCount: existingTaskIds.length,
          startId: activeBlock.startId,
        })
        return
      }
      const dependencyCheck = await this.taskSvc.checkDependenciesMet(normalizedTaskId)
      const hardBlocking = dependencyCheck.blocking.filter((dependency) => dependency.type === 'hard')
      trace.step('check-dependencies', {
        hardBlockingCount: hardBlocking.length,
      })
      if (hardBlocking.length > 0) {
        const blockingIds = hardBlocking.map((dependency) => dependency.taskId).join(', ')
        throw new Error(`Cannot associate task to active block: hard dependencies not met [${blockingIds}]`)
      }

      const updatedBlock = await this.tbSvc.updateActiveBlock({
        taskIds: [...existingTaskIds, normalizedTaskId],
        taskAssociationLog: this.appendAssociationEvent(
          activeBlock.taskAssociationLog ?? [],
          activeBlock.startId,
          normalizedTaskId,
          'associated',
        ),
      })
      trace.step('update-active-block', {
        existingTaskCount: existingTaskIds.length,
        updated: Boolean(updatedBlock),
      })
      if (!updatedBlock) {
        throw new Error('Failed to persist active block association')
      }
      const nextStatus = this.resolveAutoProgressStatus(task.status)
      if (nextStatus) {
        await this.taskSvc.transitionTask(task.id, nextStatus)
      }
      trace.step('transition-task', {
        nextStatus: nextStatus ?? null,
      })
      emitTaskLinked(normalizedTaskId, task.title, activeBlock.startId, activeBlock.name)
      trace.step('emit-task-linked', {
        startId: activeBlock.startId,
      })
      trace.finish({
        outcome: 'associated',
        startId: activeBlock.startId,
        nextStatus: nextStatus ?? null,
        taskCount: existingTaskIds.length + 1,
      })
    } catch (error) {
      trace.fail(error)
      throw error
    }
  }

  async removeTaskFromBlock(taskId: string): Promise<void> {
    const normalizedTaskId = taskId.trim()
    if (!normalizedTaskId) return
    const trace = new PerfTrace('TaskTimerService removeTaskFromBlock', {
      taskId: normalizedTaskId,
    })

    try {
      const activeBlock = await this.tbSvc.loadActiveBlock()
      trace.step('load-active-block', {
        hasActiveBlock: Boolean(activeBlock),
      })
      if (!activeBlock) {
        trace.finish({
          outcome: 'no-active-block',
        })
        return
      }

      const existingTaskIds = resolveActiveBlockTaskIds(activeBlock)
      if (!existingTaskIds.includes(normalizedTaskId)) {
        trace.finish({
          outcome: 'task-not-linked',
          existingTaskCount: existingTaskIds.length,
          startId: activeBlock.startId,
        })
        return
      }
      const task = await this.taskSvc.getTask(normalizedTaskId)
      trace.step('load-task', {
        foundTask: Boolean(task),
        status: task?.status ?? null,
      })

      await this.tbSvc.updateActiveBlock({
        taskIds: existingTaskIds.filter((existingTaskId) => existingTaskId !== normalizedTaskId),
        taskAssociationLog: this.appendAssociationEvent(
          activeBlock.taskAssociationLog ?? [],
          activeBlock.startId,
          normalizedTaskId,
          'disassociated',
        ),
      })
      trace.step('update-active-block', {
        existingTaskCount: existingTaskIds.length,
        nextTaskCount: existingTaskIds.length - 1,
      })
      emitTaskUnlinked(normalizedTaskId, task?.title ?? normalizedTaskId, activeBlock.startId, activeBlock.name)
      trace.step('emit-task-unlinked', {
        startId: activeBlock.startId,
      })
      trace.finish({
        outcome: 'disassociated',
        existingTaskCount: existingTaskIds.length,
        nextTaskCount: existingTaskIds.length - 1,
        startId: activeBlock.startId,
      })
    } catch (error) {
      trace.fail(error)
      throw error
    }
  }

  async onBlockEndForTask(
    taskId: string,
    blockId: string,
  ): Promise<void> {
    await this.onBlockEndForTasks([taskId], blockId)
  }

  async onBlockEndForTasks(taskIds: string[], blockId: string): Promise<void> {
    const normalizedTaskIds = Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)))
    const allBlocks = await this.tbSvc.loadTimeBlocks()
    const completedBlock = allBlocks.find((block) => block.id === blockId || block.startId === blockId) ?? null
    const persistedBlockId = completedBlock?.startId ?? blockId
    const relatedTaskIds = completedBlock
      ? resolveTimeBlockRelatedTaskIds(completedBlock)
      : normalizedTaskIds

    for (const taskId of relatedTaskIds) {
      const task = await this.taskSvc.getTask(taskId)
      if (!task) continue

      const existingIds = task.timeBlockIds ?? []
      const equivalentBlockIds = new Set(
        [blockId, persistedBlockId, completedBlock?.id]
          .filter((candidate): candidate is string => Boolean(candidate)),
      )
      const normalizedExistingIds = Array.from(
        new Set(
          existingIds.map((existingId) => equivalentBlockIds.has(existingId) ? persistedBlockId : existingId),
        ),
      )
      if (!normalizedExistingIds.includes(persistedBlockId)) {
        normalizedExistingIds.push(persistedBlockId)
      }
      if (
        normalizedExistingIds.length !== existingIds.length
        || normalizedExistingIds.some((existingId, index) => existingId !== existingIds[index])
      ) {
        await this.taskSvc.updateTask(taskId, {
          timeBlockIds: normalizedExistingIds,
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

    const allBlocks = await this.tbSvc.loadTimeBlocks()
    let totalMs = 0
    for (const block of allBlocks) {
      if (blockIds.includes(block.startId)) {
        totalMs += calculateTaskAssociationDurationMs(block, taskId)
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

  private async resolveAutoProgressCandidates(
    tasks: TaskNode[],
  ): Promise<Array<{ task: TaskNode; nextStatus: TaskStatus }>> {
    const candidates: Array<{ task: TaskNode; nextStatus: TaskStatus }> = []

    for (const task of tasks) {
      const nextStatus = this.resolveAutoProgressStatus(task.status)
      if (!nextStatus) {
        continue
      }

      const dependencyCheck = await this.taskSvc.checkDependenciesMet(task.id)
      const hardBlocking = dependencyCheck.blocking.filter((dependency) => dependency.type === 'hard')
      if (hardBlocking.length > 0) {
        const blockingIds = hardBlocking.map((dependency) => dependency.taskId).join(', ')
        throw new Error(`Cannot transition to in_progress: hard dependencies not met [${blockingIds}]`)
      }

      candidates.push({ task, nextStatus })
    }

    return candidates
  }

  private async reconcileAssociatedTaskProgress(taskIds: string[]): Promise<void> {
    const normalizedTaskIds = Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)))
    if (normalizedTaskIds.length === 0) {
      return
    }

    for (const taskId of normalizedTaskIds) {
      const task = await this.taskSvc.getTask(taskId)
      if (!task || task.status === 'completed' || task.status === 'cancelled') {
        continue
      }

      const [candidate] = await this.resolveAutoProgressCandidates([task])
      if (candidate) {
        await this.taskSvc.transitionTask(candidate.task.id, candidate.nextStatus)
      }
    }
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
