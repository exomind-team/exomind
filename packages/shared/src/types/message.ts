/**
 * Message Types - 统一消息类型定义
 *
 * 设计原则:
 * - timestamp: 使用 number (Unix ms) 便于比较和排序
 * - type: 使用字符串字面量便于序列化
 */

// ============== 消息方向 ==============
export type MessageDirection = 'outgoing' | 'incoming';

// ============== 消息状态 ==============
export type MessageStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

// ============== 消息类型 ==============
export type ChatMessageType = 'chat' | 'system';

// ============== 同步消息类型 ==============
export type SyncMessageType = 'AUTH' | 'SYNC_REQUEST' | 'SYNC_RESPONSE' | 'CHANGE' | 'ACK';

// ============== 协议消息类型 ==============
export type ProtocolMessageType =
  | 'auth'
  | 'auth_ok'
  | 'auth_fail'
  | 'ping'
  | 'pong'
  | 'send'
  | 'broadcast'
  | 'deliver'
  | 'sync'
  | 'sync_resp';

// ============== 基础消息结构 ==============
export interface BaseMessage {
  /** 唯一消息 ID: deviceId-timestamp-random */
  id: string;
  /** 发送方设备 ID */
  deviceId: string;
  /** 发送方用户 ID (认证后) */
  userId?: string;
  /** 消息内容 */
  content: string;
  /** Unix 时间戳 (毫秒) */
  timestamp: number;
}

// ============== 聊天消息 ==============
export interface ChatMessage extends BaseMessage {
  /** 消息类型 */
  type: ChatMessageType;
  /** 接收方设备 ID */
  receiverId?: string;
  /** 消息状态 */
  status: MessageStatus;
  /** 消息方向 */
  direction?: MessageDirection;
  /** 会话 ID (可选) */
  conversationId?: string;
  /** 元数据 (可选) */
  metadata?: Record<string, unknown>;
}

// ============== 同步消息 (协议层) ==============
export interface SyncMessage {
  type: SyncMessageType;
  payload: unknown;
  timestamp: number;
  deviceId: string;
}

// ============== 协议消息 (WebSocket 通信) ==============
export interface ProtocolMessage {
  type: ProtocolMessageType;
  from_device: string;
  to_device?: string;
  payload: Record<string, unknown>;
  timestamp: number;
  message_id?: string;
}

// ============== 数据库存储格式 ==============
export interface StoredMessage {
  id: string;
  deviceId: string;
  content: string;
  timestamp: number;
  type: string;
  status: string;
  metadata: string | null;
}

// ============== EventLog 格式 ==============
export interface EventLog {
  id: string;
  type: string;
  content: string;
  device_id: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ============== 消息转换函数 ==============

/**
 * 将 ProtocolMessage 转换为 ChatMessage
 */
export function protocolToChatMessage(
  protocol: ProtocolMessage,
  deviceId: string,
  direction: MessageDirection = 'incoming',
  status: MessageStatus = 'delivered'
): ChatMessage {
  return {
    id: protocol.message_id || `${deviceId}-${protocol.timestamp}-${Date.now()}`,
    deviceId: protocol.from_device,
    content: String(protocol.payload.content || ''),
    timestamp: protocol.timestamp,
    type: 'chat',
    receiverId: protocol.to_device,
    status,
    direction,
  };
}

/**
 * 将 ChatMessage 转换为 ProtocolMessage
 */
export function chatToProtocolMessage(
  chat: ChatMessage,
  toDevice?: string
): ProtocolMessage {
  return {
    type: 'send',
    from_device: chat.deviceId,
    to_device: toDevice,
    payload: {
      id: chat.id,
      content: chat.content,
      metadata: chat.metadata,
    },
    timestamp: chat.timestamp,
    message_id: chat.id,
  };
}

/**
 * 将 ChatMessage 转换为 SyncMessage
 */
export function chatToSyncMessage(
  chat: ChatMessage,
  syncType: SyncMessageType = 'CHANGE'
): SyncMessage {
  return {
    type: syncType,
    payload: {
      entity: 'message',
      data: chat,
    },
    timestamp: chat.timestamp,
    deviceId: chat.deviceId,
  };
}

/**
 * 将 SyncMessage 转换为 ChatMessage
 */
export function syncToChatMessage(
  sync: SyncMessage
): ChatMessage | null {
  if (sync.type !== 'CHANGE') return null;

  const payload = sync.payload as { entity: string; data: unknown };
  if (payload.entity !== 'message') return null;

  return payload.data as ChatMessage;
}

/**
 * 将 EventLog 转换为 ChatMessage
 */
export function eventLogToChatMessage(
  event: EventLog,
  localDeviceId: string
): ChatMessage {
  const isOutgoing = event.device_id === localDeviceId;
  return {
    id: (event.metadata?.messageId as string) || event.id,
    deviceId: event.device_id,
    content: event.content,
    timestamp: new Date(event.timestamp).getTime(),
    type: 'chat',
    receiverId: (event.metadata?.receiverId as string) || '',
    status: (event.metadata?.status as MessageStatus) || 'sent',
    direction: isOutgoing ? 'outgoing' : 'incoming',
  };
}

/**
 * 将 ChatMessage 转换为 EventLog
 */
export function chatToEventLog(
  message: ChatMessage
): EventLog {
  return {
    id: `evt-${message.id}`,
    type: 'message_send',
    content: message.content,
    device_id: message.deviceId,
    timestamp: new Date(message.timestamp).toISOString(),
    metadata: {
      messageId: message.id,
      receiverId: message.receiverId,
      status: message.status,
    },
  };
}
