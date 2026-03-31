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

export interface TaskEventMetadata extends EventMetadata {
  taskId: UUID;
  taskTitle: string;
}

export interface TaskTransitionEventMetadata extends TaskEventMetadata {
  fromStatus: string;
  toStatus: string;
}

export interface TaskLinkEventMetadata extends TaskEventMetadata {
  blockId: UUID;
  blockName?: string;
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
  TASK_CREATED: 'task_created' as Tag,
  TASK_STARTED: 'task_started' as Tag,
  TASK_RESUMED: 'task_resumed' as Tag,
  TASK_SUSPENDED: 'task_suspended' as Tag,
  TASK_COMPLETED: 'task_completed' as Tag,
  TASK_CANCELLED: 'task_cancelled' as Tag,
  TASK_LINKED: 'task_linked' as Tag,
  TASK_UNLINKED: 'task_unlinked' as Tag,
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
export type BlockType = 'active' | 'gap';

export type BlockTransitionType = 'start' | 'pause' | 'resume' | 'feedback_start' | 'feedback_submit' | 'end';

export interface BlockTransition {
  type: BlockTransitionType;
  at: Timestamp;
  actorId?: string;
}

export interface TimeBlockData {
  id: UUID;
  name: string;
  startId: UUID;
  endId: UUID;
  note?: string;
  tags: string[];
  startTime: Timestamp;
  endTime: Timestamp;
  /** 'active' = 用户主动触发, 'gap' = 自动间隙。缺省视为 'active'（向后兼容） */
  blockType?: BlockType;
  transitions?: BlockTransition[];
  /** 结束时仍关联的任务快照；历史全集请看 taskAssociationLog */
  taskIds?: UUID[];
  taskStatusOutcomes?: Record<string, string>;
  /** 关联历史日志：可回放”曾关联过哪些任务”以及后续计算任务出现程度 */
  taskAssociationLog?: BlockTaskAssociationEvent[];
  sourcePlannedBlockId?: UUID;
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
  blockType?: BlockType;
  /** 结束时仍关联的任务快照；历史全集请看 taskAssociationLog */
  taskIds?: UUID[];
  taskStatusOutcomes?: Record<string, string>;
  /** 关联历史日志：可回放“曾关联过哪些任务”以及后续计算任务出现程度 */
  taskAssociationLog?: BlockTaskAssociationEvent[];
  sourcePlannedBlockId?: UUID;
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
  /** 'active' = 用户主动触发, 'gap' = 自动间隙。缺省视为 'active'（向后兼容） */
  blockType?: BlockType;
  transitions?: BlockTransition[];
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
  /** 当前仍关联的任务快照 */
  taskIds: UUID[];
  /** 运行期关联历史：不仅能恢复当前关联，也能保留“曾经关联过”的任务全集 */
  taskAssociationLog: BlockTaskAssociationEvent[];
  sourcePlannedBlockId?: UUID;
  /** @deprecated Use taskIds. Kept for deserialization compat only. */
  taskId?: UUID;
}

export type RhythmPresetKey = 'pomodoro_25_5' | 'focus_45_10' | 'focus_45_15';

export interface RhythmPresetData {
  key: RhythmPresetKey;
  label: string;
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakAfterWorkSegments: number;
}

export type PlannedSegmentKind = 'work' | 'break';
export type BreakWindowKind = 'short' | 'long';
export type TodayPlannerSegmentStatus = 'pending' | 'active' | 'completed';

export interface PlannedSegmentData {
  id: UUID;
  windowId: UUID;
  kind: PlannedSegmentKind;
  breakKind?: BreakWindowKind;
  title: string;
  plannedStartAt: Timestamp;
  plannedEndAt: Timestamp;
  linkedTaskIds: UUID[];
  order: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TodayPlannerSegment extends PlannedSegmentData {
  status: TodayPlannerSegmentStatus;
  sourceTimeBlockId?: UUID;
}

export interface TodayPlannerWindow {
  id: UUID;
  date: string;
  title?: string;
  plannedStartAt: Timestamp;
  plannedEndAt: Timestamp;
  rhythmPreset: RhythmPresetData;
  segments: TodayPlannerSegment[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TodayPlannerSnapshot {
  date: string;
  windows: TodayPlannerWindow[];
}

export interface CreateSchedulingWindowInput {
  date: string;
  title?: string;
  plannedStartAt: Timestamp;
  plannedEndAt: Timestamp;
  rhythmPresetKey: RhythmPresetKey;
}

export interface UpdatePlannedSegmentInput {
  title?: string;
  linkedTaskIds?: UUID[];
}

export interface ReflowSchedulingWindowInput {
  anchorSegmentId: UUID;
  actualEndAt: Timestamp;
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

/**
 * 历史语义：只要任务曾在该时间块内被关联过一次，就属于时间块的“关联任务全集”。
 * 这组数据适用于时间块详情、历史回顾、统计等“曾经关联过哪些任务”的场景。
 *
 * 注意：它不同于 taskIds / 当前关联快照。一个任务即使后来被移除，
 * 仍然应该保留在这个历史全集里，后续才能进一步计算“出现程度”。
 */
export function resolveEverAssociatedTaskIdsFromLog(
  taskAssociationLog: BlockTaskAssociationEvent[] | undefined,
): UUID[] {
  if (!taskAssociationLog?.length) return [];

  const orderedTaskIds: UUID[] = [];
  const seenTaskIds = new Set<UUID>();
  for (const event of taskAssociationLog) {
    if (event.action !== 'associated') {
      continue;
    }
    const normalizedTaskId = event.taskId.trim();
    if (!normalizedTaskId || seenTaskIds.has(normalizedTaskId)) {
      continue;
    }
    seenTaskIds.add(normalizedTaskId);
    orderedTaskIds.push(normalizedTaskId);
  }

  return orderedTaskIds;
}

/**
 * 快照语义：返回当前仍关联 / 结束时仍关联的任务集合。
 * 这组数据适用于 active block 当前状态、结束时状态回写、运行中增删关联等场景。
 */
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

/**
 * 历史语义：返回时间块历史上曾关联过的所有任务。
 *
 * 优先使用 taskAssociationLog，因为它保留了完整的关联历史；
 * 如果没有日志，再退回到 taskIds / legacy taskId 快照。
 */
export function resolveTimeBlockRelatedTaskIds(
  block: { taskId?: UUID; taskIds?: UUID[]; taskAssociationLog?: BlockTaskAssociationEvent[] } | null | undefined,
): UUID[] {
  if (!block) return [];

  const taskIdsFromLog = resolveEverAssociatedTaskIdsFromLog(block.taskAssociationLog);
  if (taskIdsFromLog.length > 0) {
    return taskIdsFromLog;
  }
  if (block.taskIds?.length) {
    return normalizeTaskIdList(block.taskIds);
  }
  return block.taskId ? normalizeTaskIdList([block.taskId]) : [];
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

/**
 * 返回某个任务在时间块中“实际处于关联状态”的时长。
 *
 * - 若存在 taskAssociationLog，则以关联/取消关联事件回放区间
 * - 若不存在日志，则退回为“只要被认为相关联，就记整段时间块时长”
 */
export function calculateTaskAssociationDurationMs(
  block: { startTime: number; endTime: number; taskId?: UUID; taskIds?: UUID[]; taskAssociationLog?: BlockTaskAssociationEvent[] } | null | undefined,
  taskId: UUID,
): number {
  if (!block) return 0;

  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) return 0;

  const totalBlockMs = Math.max(0, block.endTime - block.startTime);
  if (totalBlockMs === 0) return 0;

  const relevantEvents = (block.taskAssociationLog ?? [])
    .filter((event) => event.taskId.trim() === normalizedTaskId)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (relevantEvents.length === 0) {
    return resolveTimeBlockRelatedTaskIds(block).includes(normalizedTaskId) ? totalBlockMs : 0;
  }

  let activeSince: number | null = null;
  let totalMs = 0;
  for (const event of relevantEvents) {
    if (event.action === 'associated') {
      if (activeSince === null) {
        activeSince = Math.max(block.startTime, event.timestamp);
      }
      continue;
    }

    if (activeSince !== null) {
      totalMs += Math.max(0, Math.min(block.endTime, event.timestamp) - activeSince);
      activeSince = null;
    }
  }

  if (activeSince !== null) {
    totalMs += Math.max(0, block.endTime - activeSince);
  }

  return Math.min(totalMs, totalBlockMs);
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
