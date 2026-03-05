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
}

// 事件类型（UI 使用）
export interface Event {
  id: UUID;
  timestamp: Timestamp;
  content: string;
  tags: Set<Tag>;
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
  taskId?: string;  // Phase4: 关联任务 ID
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
