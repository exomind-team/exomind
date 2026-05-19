import type { EventData } from "../../types/event";

export type EventLogAppendInput = Omit<EventData, "timestamp">;

export interface EventLogListOptions {
  limit?: number;
  sinceId?: string;
  sinceTimestamp?: number;
  untilTimestamp?: number;
}

export type EventLogListSemantics = "full_snapshot" | "incremental_batch";

export interface EventLogListResult {
  events: EventData[];
  semantics: EventLogListSemantics;
  snapshotRevision?: string | null;
}

export interface EventLogImportResult {
  imported: number;
  skipped: number;
  total: number;
}

/**
 * IEventLogPort - 事件日志能力接口
 *
 * L2 定义，L3 Service 消费。
 * 通过 Port 层屏蔽 Web/Tauri 的底层存储差异。
 */
export interface IEventLogPort {
  /**
   * 列出所有事件（建议按时间倒序）
   */
  listEvents(options?: EventLogListOptions): Promise<EventData[]>;

  /**
   * 列出事件并显式返回结果语义（快照 / 增量）
   */
  listEventsDetailed(
    options?: EventLogListOptions,
  ): Promise<EventLogListResult>;

  /**
   * 追加一条事件
   */
  appendEvent(event: EventLogAppendInput): Promise<EventData>;

  /**
   * 追加原始事件（保留外部 timestamp）
   */
  appendRawEvent(event: EventData): Promise<EventData>;

  /**
   * 从 JSON 批量导入事件
   */
  importEventsFromJson?(
    json: string,
    strategy: "merge" | "overwrite",
  ): Promise<EventLogImportResult>;

  /**
   * 读取单条事件
   */
  getEvent(id: string): Promise<EventData | null>;

  /**
   * 清空所有事件
   */
  clearEvents(): Promise<void>;
}
