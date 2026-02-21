/**
 * EventLog 格式定义
 * 最小实现使测试通过
 */

// 事件类型
export type EventType = 
  | 'device_register'
  | 'device_online'
  | 'device_offline'
  | 'message_send'
  | 'message_delivered'
  | 'message_failed';

// EventLog 接口
export interface EventLog {
  id: string;
  type: EventType;
  content: string;
  device_id: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// 创建 EventLog
export function createEventLog(
  type: EventType,
  content: string,
  device_id: string
): EventLog {
  return {
    id: crypto.randomUUID(),
    type,
    content,
    device_id,
    timestamp: new Date().toISOString(),
  };
}
