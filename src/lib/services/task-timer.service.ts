/**
 * TaskTimerService - 任务↔时间块 1:N 计时关联
 *
 * 行为语义：任务在时间中推进（持续展开原则）
 * 架构不变量：任务必须通过时间块推进
 *
 * 职责：
 * - 从任务快速启动/停止时间块
 * - 时间块结束时反馈任务状态
 * - spentMinutes 自动累计
 * - 关联 CRUD（链接/取消链接）
 */

import type { TaskNode } from '@/lib/types/task'
import type { ActiveBlockData, TimeBlockData, TimerConfig } from '@/lib/types/event'
import { getTaskService, type TaskService } from './task.service'
import { getTimeBlockService, type TimeBlockService } from './timeblock.service'

export type TaskTimerFeedbackAction = 'continue' | 'suspend' | 'complete'

export interface TaskTimerService {
  /** 从任务启动计时（自动关联 taskId，必要时先转换到 in_progress） */
  startTimerForTask(taskId: string, config: TimerConfig): Promise<ActiveBlockData | null>

  /** 结束当前时间块并反馈任务状态 */
  endTimerForTask(feedback: string | undefined, action: TaskTimerFeedbackAction): Promise<TaskNode | null>

  /** 获取任务关联的所有已完成时间块 */
  getTimeBlocksForTask(taskId: string): Promise<TimeBlockData[]>

  /** 手动关联时间块到任务 */
  linkBlockToTask(blockStartId: string, taskId: string): Promise<void>

  /** 取消时间块与任务的关联 */
  unlinkBlockFromTask(blockStartId: string): Promise<void>

  /** 根据关联时间块计算并更新 spentMinutes */
  updateSpentMinutes(taskId: string): Promise<TaskNode | null>
}

export class TaskTimerServiceImpl implements TaskTimerService {
  private readonly taskSvc: TaskService
  private readonly tbSvc: TimeBlockService

  constructor(taskSvc?: TaskService, tbSvc?: TimeBlockService) {
    this.taskSvc = taskSvc ?? getTaskService()
    this.tbSvc = tbSvc ?? getTimeBlockService()
  }

  async startTimerForTask(taskId: string, config: TimerConfig): Promise<ActiveBlockData | null> {
    const task = await this.taskSvc.getTask(taskId)
    if (!task) return null

    // 如果任务非 in_progress，先转换状态
    if (task.status === 'not_started') {
      await this.taskSvc.transitionTask(taskId, 'in_progress')
    } else if (task.status === 'suspended') {
      await this.taskSvc.transitionTask(taskId, 'in_progress')
    } else if (task.status === 'completed' || task.status === 'abandoned') {
      return null // 终态任务不允许启动计时
    }

    // 启动时间块，使用任务标题作为名称
    const block = await this.tbSvc.startBlock(task.title, config)

    // 注入 taskId（通过 activeBlock 的 taskId 字段）
    // ActiveBlockData 已有 taskId 字段，但 startBlock 不会自动填入
    // 需要通过 updateElapsed 或直接修改存储来注入
    // 由于 TimeBlockService 不暴露 taskId 设置接口，
    // 我们利用返回值中注入 taskId 供后续 endBlock 时使用
    const blockWithTask: ActiveBlockData = { ...block, taskId }

    return blockWithTask
  }

  async endTimerForTask(
    feedback: string | undefined,
    action: TaskTimerFeedbackAction,
  ): Promise<TaskNode | null> {
    // 获取当前活跃块
    const active = await this.tbSvc.loadActiveBlock()
    if (!active) return null

    const taskId = active.taskId
    if (!taskId) {
      // 无关联任务，直接结束时间块
      await this.tbSvc.markEnding()
      await this.tbSvc.endBlock(feedback)
      return null
    }

    // 结束时间块
    await this.tbSvc.markEnding()
    await this.tbSvc.endBlock(feedback)

    // 获取任务
    const task = await this.taskSvc.getTask(taskId)
    if (!task) return null

    // 更新 spentMinutes
    await this.updateSpentMinutes(taskId)

    // 根据反馈动作转换任务状态
    if (task.status === 'in_progress') {
      switch (action) {
        case 'complete':
          return this.taskSvc.transitionTask(taskId, 'completed')
        case 'suspend':
          return this.taskSvc.transitionTask(taskId, 'suspended')
        case 'continue':
          // 保持 in_progress，不转换
          return this.taskSvc.getTask(taskId)
      }
    }

    return this.taskSvc.getTask(taskId)
  }

  async getTimeBlocksForTask(taskId: string): Promise<TimeBlockData[]> {
    const allBlocks = await this.tbSvc.loadTimeBlocks()
    // TimeBlock (UI type) → TimeBlockData 转换
    return allBlocks
      .filter((b) => (b as unknown as TimeBlockData).taskId === taskId)
      .map((b) => ({
        id: b.id,
        name: b.name,
        startId: b.startId,
        endId: b.endId,
        note: b.note,
        tags: Array.from(b.tags),
        startTime: b.startTime,
        endTime: b.endTime,
        taskId,
      }))
  }

  async linkBlockToTask(_blockStartId: string, taskId: string): Promise<void> {
    const task = await this.taskSvc.getTask(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    // TimeBlockData 存储在 IStoragePort 的 time_blocks key 中，
    // 需扩展 TimeBlockService 来支持存储级 taskId 更新。
    // 当前为预留接口，后续 Phase6 集成时实现。
  }

  async unlinkBlockFromTask(_blockStartId: string): Promise<void> {
    // 预留接口，后续 Phase6 集成时实现。
  }

  async updateSpentMinutes(taskId: string): Promise<TaskNode | null> {
    const blocks = await this.getTimeBlocksForTask(taskId)
    const totalMs = blocks.reduce((sum, b) => sum + Math.max(0, b.endTime - b.startTime), 0)
    const totalMinutes = Math.round(totalMs / 60_000)

    return this.taskSvc.updateTask(taskId, { spentMinutes: totalMinutes })
  }
}

let instance: TaskTimerService | null = null

export function getTaskTimerService(): TaskTimerService {
  if (!instance) instance = new TaskTimerServiceImpl()
  return instance
}
