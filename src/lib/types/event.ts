/**
 * EventLog Types - 事件日志类型定义
 *
 * 简化版本：使用普通对象而非类
 */

// 基础类型
export type UUID = string;
export type Timestamp = number;
export type NoteContent = string;
export type Tag = string;

export interface EventSourceMetadata {
  deviceId: string;
  deviceName: string;
  platform: string;
  app: 'ExoMind';
}

export interface EventMetadata {
  source?: EventSourceMetadata;
  [key: string]: unknown;
}

// 标签常量
export const SYSTEM_TAGS = {
  BLOCK_START: 'block_start' as Tag,
  BLOCK_END: 'block_end' as Tag,
  BLOCK_PAUSE: 'block_pause' as Tag,
  BLOCK_RESUME: 'block_resume' as Tag,
  BLOCK_FEEDBACK: 'block_feedback' as Tag,
  AGENT_FEEDBACK: 'agent_feedback' as Tag,
  NOTE: 'note' as Tag,
} as const;

// 事件数据类型（存储用）
export interface EventData {
  id: UUID;
  timestamp: Timestamp;
  content: string;
  tags: string[];
  metadata?: EventMetadata;
}

// 事件类型（UI 使用）
export interface Event {
  id: UUID;
  timestamp: Timestamp;
  content: string;
  tags: Set<Tag>;
  metadata?: EventMetadata;
}

export interface BlockTaskAssociationEvent {
  blockId: UUID;
  taskId: UUID;
  action: 'associated' | 'disassociated';
  timestamp: Timestamp;
  source: 'block_start' | 'manual';
}

// 时间块数据类型（存储用）
export interface TimeBlockData {
  id: UUID;
  name: string;
  startId: UUID;
  endId: UUID;
  note?: string;
  tags: string[];
  startTime: Timestamp;
  endTime: Timestamp;
  taskIds?: UUID[];
  taskStatusOutcomes?: Record<string, string>;
  taskAssociationLog?: BlockTaskAssociationEvent[];
}

// 时间块类型（UI 使用）
export interface TimeBlock {
  id: UUID;
  name: string;
  startId: UUID;
  endId: UUID;
  note?: string;
  tags: Set<Tag>;
  startTime: Timestamp;
  endTime: Timestamp;
  taskIds?: UUID[];
  taskStatusOutcomes?: Record<string, string>;
  taskAssociationLog?: BlockTaskAssociationEvent[];
}

// 活跃时间块（进行中）
export type ActiveBlockPhase =
  | 'running'
  | 'paused'
  | 'feedback_in_progress'
  | 'action_ended' // legacy phase value（兼容旧数据）
  | 'feedback_submitted';

export interface ActiveBlockData {
  startId: UUID;
  name: string;
  mode: 'countup' | 'countdown';
  targetMinutes?: number;
  /** 兼容旧结构：逐步迁移中，优先由锚点字段推导 */
  elapsed: number;
  /** 兼容旧结构：逐步迁移中 */
  updatedAt?: Timestamp;
  /** 状态机阶段（单调前进） */
  phase?: ActiveBlockPhase;
  /** 状态版本号（每次状态迁移递增） */
  version?: number;
  /** 写入来源端标识（用于并发可观测性与裁决） */
  actorId?: string;
  /** 最近一次状态迁移时刻 */
  lastTransitionAt?: Timestamp;
  /** 最近一次进入 running 的时刻 */
  lastResumedAt?: Timestamp;
  /** 已累计有效专注时长（不含当前 running 切片） */
  accumulatedRunMs?: number;
  /** 点击“开始”的时刻（行动结束） */
  startTime: Timestamp;
  /** 点击“结束”的时刻（行动结束） */
  actionEndedAt?: Timestamp;
  /** 反馈弹窗打开的时刻（通常与 actionEndedAt 一致） */
  feedbackStartedAt?: Timestamp;
  /** 反馈提交完成时刻（终态标记，防止并发回退） */
  feedbackSubmittedAt?: Timestamp;
  /** 累计暂停时长（毫秒） */
  pauseAccumulatedMs?: number;
  paused: boolean;
  pausedAt?: Timestamp;
  taskIds: UUID[];
  taskAssociationLog: BlockTaskAssociationEvent[];
  /** @deprecated Use taskIds. Kept for deserialization compat only. */
  taskId?: UUID;
}

// 计时器配置
export type TimerMode = 'countup' | 'countdown';

export interface TimerConfig {
  mode: TimerMode;
  minutes?: number;  // 倒计时时长（分钟）
}

// 创建事件选项
export interface CreateEventOptions {
  content: NoteContent;
  tags?: Set<Tag>;
}

function normalizeTaskIdList(taskIds: UUID[]): UUID[] {
  return Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)));
}

export function resolveAssociatedTaskIdsFromLog(
  taskAssociationLog: BlockTaskAssociationEvent[] | undefined,
): UUID[] {
  if (!taskAssociationLog?.length) return [];

  const orderedTaskIds: UUID[] = [];
  const activeTaskIds = new Set<UUID>();
  for (const event of taskAssociationLog) {
    const normalizedTaskId = event.taskId.trim();
    if (!normalizedTaskId) continue;
    if (event.action === 'associated') {
      if (!activeTaskIds.has(normalizedTaskId)) {
        orderedTaskIds.push(normalizedTaskId);
      }
      activeTaskIds.add(normalizedTaskId);
      continue;
    }
    activeTaskIds.delete(normalizedTaskId);
  }

  return orderedTaskIds.filter((taskId) => activeTaskIds.has(taskId));
}

export function resolveActiveBlockTaskIds(
  block: { taskId?: UUID; taskIds?: UUID[]; taskAssociationLog?: BlockTaskAssociationEvent[] } | null | undefined,
): UUID[] {
  if (!block) return [];
  if (block.taskIds?.length) {
    return normalizeTaskIdList(block.taskIds);
  }
  const taskIdsFromLog = resolveAssociatedTaskIdsFromLog(block.taskAssociationLog);
  if (taskIdsFromLog.length > 0) {
    return taskIdsFromLog;
  }
  return block.taskId ? normalizeTaskIdList([block.taskId]) : [];
}

export function normalizeActiveBlockTaskIds<T extends { taskId?: UUID; taskIds?: UUID[]; taskAssociationLog?: BlockTaskAssociationEvent[] }>(
  block: T,
): Omit<T, 'taskId' | 'taskIds'> & { taskIds: UUID[]; taskId?: undefined } {
  const taskIds = resolveActiveBlockTaskIds(block);

  const { taskId: _legacyTaskId, taskIds: _taskIds, ...rest } = block;
  return {
    ...rest,
    taskIds,
  };
}

export function normalizeTimeBlockTaskIds<T extends { taskIds?: UUID[] }>(
  block: T,
): T & { taskIds: UUID[] } {
  return {
    ...block,
    taskIds: block.taskIds ?? [],
  };
}
