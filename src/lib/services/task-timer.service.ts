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

import type { ActiveBlockData, TimerConfig } from '@/lib/types/event'
import { getTaskService, type TaskService } from './task.service'
import { getTimeBlockService, type TimeBlockService } from './timeblock.service'

export interface TaskTimerService {
  /** 从任务快速启动一个时间块，自动关联 */
  startBlockForTask(taskId: string, config?: TimerConfig): Promise<ActiveBlockData | null>

  /** 时间块结束时回调：记录 blockId 关联（spentMinutes 动态计算，不持久化） */
  onBlockEndForTask(taskId: string, blockId: string): Promise<void>

  /** 获取任务关联的所有时间块 ID */
  getBlockIdsForTask(taskId: string): Promise<string[]>

  /** 计算任务已花费总时间（从关联时间块累计） */
  calculateSpentMinutes(taskId: string): Promise<number>
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
    const task = await this.taskSvc.getTask(taskId)
    if (!task) return null

    // 终态任务不允许启动计时
    if (task.status === 'completed' || task.status === 'abandoned') return null

    // 如果任务非 in_progress，先转换状态
    if (task.status === 'not_started') {
      await this.taskSvc.transitionTask(taskId, 'in_progress')
    } else if (task.status === 'suspended') {
      await this.taskSvc.transitionTask(taskId, 'in_progress')
    }

    // 启动时间块，使用任务标题作为名称，传入 taskId 标记关联
    const block = await this.tbSvc.startBlock(task.title, config, undefined, taskId)

    // 将 blockId 追加到 task.timeBlockIds
    const existingIds = task.timeBlockIds ?? []
    if (!existingIds.includes(block.startId)) {
      await this.taskSvc.updateTask(taskId, {
        timeBlockIds: [...existingIds, block.startId],
      })
    }

    return block
  }

  async onBlockEndForTask(
    taskId: string,
    blockId: string,
  ): Promise<void> {
    const task = await this.taskSvc.getTask(taskId)
    if (!task) return

    // 追加 blockId（避免重复）
    const existingIds = task.timeBlockIds ?? []
    if (!existingIds.includes(blockId)) {
      await this.taskSvc.updateTask(taskId, {
        timeBlockIds: [...existingIds, blockId],
      })
    }
  }

  async getBlockIdsForTask(taskId: string): Promise<string[]> {
    const task = await this.taskSvc.getTask(taskId)
    if (!task) return []
    return task.timeBlockIds ?? []
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
}

let instance: TaskTimerService | null = null

export function getTaskTimerService(): TaskTimerService {
  if (!instance) instance = new TaskTimerServiceImpl()
  return instance
}
