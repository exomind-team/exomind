/**
 * TimeBlock 模块 - 类型定义
 *
 * 基于 MVP-ARCHITECTURE.md 文档
 * @module timeblock/types
 */

import { createUuidV4 } from '../utils/uuid';

// ============================================================================
// 基础类型
// ============================================================================

export type UUID = string;
export type Timestamp = number;
export type Tag = string;
export type NoteContent = string;

export interface JSONObject {
  [key: string]: unknown;
}

export type JSONValue = string | number | boolean | null | JSONObject | JSONValue[];

// ============================================================================
// Event 类型
// ============================================================================

/**
 * 事件
 * 基于 MVP-ARCHITECTURE.md 2.1 Event 定义
 */
export interface Event {
  /** 唯一标识 */
  id: UUID;
  /** 发生时间 */
  timestamp: Timestamp;
  /** 记录内容 */
  content: NoteContent;
  /** 主题标签 */
  tags: Set<Tag>;
  /** 扩展元数据 */
  meta?: JSONObject;
}

/**
 * 事件实现
 */
export class EventImpl implements Event {
  readonly id: UUID;
  readonly timestamp: Timestamp;
  private _content: NoteContent;
  private _tags: Set<Tag>;
  private _meta?: JSONObject;

  constructor(content: NoteContent, tags?: Tag[], meta?: JSONObject) {
    this.id = createUuidV4();
    this.timestamp = Date.now();
    this._content = content;
    this._tags = new Set(tags || []);
    this._meta = meta;
  }

  get content(): NoteContent {
    return this._content;
  }

  get tags(): Set<Tag> {
    return this._tags;
  }

  get meta(): JSONObject | undefined {
    return this._meta;
  }

  /** 序列化 */
  toJSON(): JSONObject {
    return {
      id: this.id,
      timestamp: this.timestamp,
      content: this._content,
      tags: Array.from(this._tags),
      meta: this._meta,
    };
  }

  /** 从 JSON 恢复 */
  static fromJSON(json: JSONObject): EventImpl {
    const event = new EventImpl(
      String(json.content),
      (json.tags as Tag[]) || []
    );
    // 通过 unknown 中转绕过只读检查
    const data = event as unknown as Record<string, unknown>;
    data.id = json.id;
    data.timestamp = json.timestamp;
    data._meta = json.meta;
    return event;
  }
}

// ============================================================================
// TimeBlock 类型
// ============================================================================

/**
 * 时间块
 * 基于 MVP-ARCHITECTURE.md 2.2 TimeBlock 定义
 */
export interface TimeBlock {
  /** 唯一标识 */
  id: UUID;
  /** 块名称 */
  name: string;
  /** 个人记录 */
  note?: string;
  /** 开始事件 ID */
  startId: UUID;
  /** 结束事件 ID */
  endId?: UUID;
  /** 主题标签 */
  tags: Set<Tag>;
  /** 扩展元数据 */
  meta?: JSONObject;
}

/**
 * 时间块实现
 */
export class TimeBlockImpl implements TimeBlock {
  readonly id: UUID;
  name: string;
  note?: string;
  readonly startId: UUID;
  endId?: UUID;
  private _tags: Set<Tag>;
  private _meta?: JSONObject;

  constructor(name: string, startId: UUID, tags?: Tag[], note?: string) {
    this.id = createUuidV4();
    this.name = name;
    this.startId = startId;
    this._tags = new Set(tags || []);
    this.note = note;
  }

  get tags(): Set<Tag> {
    return this._tags;
  }

  get meta(): JSONObject | undefined {
    return this._meta;
  }

  set meta(value: JSONObject | undefined) {
    this._meta = value;
  }

  /** 获取开始事件时间戳（供查询使用） */
  getStartTimestamp(): Timestamp {
    return 0; // 由外部事件映射提供
  }

  /** 序列化 */
  toJSON(): JSONObject {
    return {
      id: this.id,
      name: this.name,
      note: this.note,
      startId: this.startId,
      endId: this.endId,
      tags: Array.from(this._tags),
      meta: this._meta,
    };
  }

  /** 从 JSON 恢复 */
  static fromJSON(json: JSONObject): TimeBlockImpl {
    const block = new TimeBlockImpl(
      String(json.name),
      json.startId as UUID,
      (json.tags as Tag[]) || [],
      json.note as string | undefined
    );
    // 通过 unknown 中转绕过只读检查
    const data = block as unknown as Record<string, unknown>;
    data.id = json.id;
    data.endId = json.endId;
    data._meta = json.meta;
    return block;
  }
}

// ============================================================================
// PlannedTimeBlock 类型
// ============================================================================

/**
 * 计划中时间块
 * 基于 MVP-ARCHITECTURE.md 2.3 PlannedTimeBlock 定义
 *
 * 用途：跟踪当前活跃但未结束的时间块
 */
export interface PlannedTimeBlock {
  /** 引用开始事件 */
  startId: UUID;
  /** 块名称 */
  name: string;
  /** 主题标签 */
  tags: Set<Tag>;
  /** 扩展元数据 */
  meta?: JSONObject;
}

// ============================================================================
// 时间块状态（用于持久化版本）
// ============================================================================

/**
 * 时间块状态
 */
export enum TimeBlockStatus {
  Pending = 'pending',       // 待执行
  InProgress = 'in_progress', // 执行中
  Completed = 'completed',    // 已完成
  Cancelled = 'cancelled',   // 已取消
}

/**
 * 时间块类型
 */
export enum TimeBlockType {
  Work = 'work',           // 工作
  Rest = 'rest',           // 休息
  Meeting = 'meeting',      // 会议
  Exercise = 'exercise',    // 锻炼
  Learning = 'learning',    // 学习
  Custom = 'custom',       // 自定义
}

/**
 * 持久化时间块（兼容旧版）
 */
export interface PersistentTimeBlock {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  status: TimeBlockStatus;
  type: TimeBlockType;
  labelIds?: string[];
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}
