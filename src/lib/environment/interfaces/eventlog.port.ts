import type { EventData } from '../../types/event';

export interface EventLogListOptions {
  limit?: number;
  sinceId?: string;
  sinceTimestamp?: number;
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
   * 追加一条事件
   */
  appendEvent(event: EventData): Promise<EventData>;

  /**
   * 读取单条事件
   */
  getEvent(id: string): Promise<EventData | null>;

  /**
   * 清空所有事件
   */
  clearEvents(): Promise<void>;
}
