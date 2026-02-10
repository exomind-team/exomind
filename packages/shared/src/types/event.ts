/**
 * EventLog Types - 事件日志类型定义
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
  BLOCK_FEEDBACK: 'block_feedback' as Tag,
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
export interface ActiveBlockData {
  startId: UUID;
  name: string;
  mode: 'countup' | 'countdown';
  targetMinutes?: number;
  elapsed: number;
  startTime: Timestamp;
  paused: boolean;
  pausedAt?: Timestamp;
}

// 计时器配置
export type TimerMode = 'countup' | 'countdown';

export interface TimerConfig {
  mode: TimerMode;
  minutes?: number;
}

// 创建事件选项
export interface CreateEventOptions {
  content: NoteContent;
  tags?: Set<Tag>;
}
