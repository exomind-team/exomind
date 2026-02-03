/**
 * WebSocket 消息协议定义
 * 
 * ExoMind 设备间通信的消息格式规范
 */

// ============== 消息类型 ==============
export type ProtocolMessageType = 
  | 'auth'        // 认证
  | 'auth_ok'     // 认证成功
  | 'auth_fail'   // 认证失败
  | 'ping'        // 心跳
  | 'pong'        // 心跳响应
  | 'send'        // 发送消息
  | 'broadcast'   // 广播消息
  | 'deliver'     // 送达确认
  | 'sync'        // 同步请求
  | 'sync_resp';  // 同步响应

// ============== 基础消息结构 ==============
export interface ProtocolMessage {
  type: ProtocolMessageType;
  from_device: string;
  to_device?: string;
  payload: Record<string, unknown>;
  timestamp: string;
  message_id?: string;
}

// ============== 认证消息 ==============
export interface AuthMessage {
  type: 'auth';
  password_hash: string;
  device_id: string;
  device_name: string;
}

// ============== 发送消息 ==============
export interface SendMessage {
  type: 'send';
  message_id: string;
  content: string;
  timestamp: string;
}

// ============== 广播消息 ==============
export interface BroadcastMessage {
  type: 'broadcast';
  message_id: string;
  content: string;
  timestamp: string;
}

// ============== 送达确认 ==============
export interface DeliverMessage {
  type: 'deliver';
  message_id: string;
  timestamp: string;
}

// ============== 同步消息 ==============
export interface SyncMessage {
  type: 'sync';
  device_id: string;
  last_sync_time?: string;
}

export interface SyncRespMessage {
  type: 'sync_resp';
  messages: ProtocolMessage[];
  timestamp: string;
}

// ============== 心跳消息 ==============
export interface PingMessage {
  type: 'ping';
  timestamp: string;
}

export interface PongMessage {
  type: 'pong';
  timestamp: string;
}

// ============== 认证响应 ==============
export interface AuthOkMessage {
  type: 'auth_ok';
  device_id: string;
  timestamp: string;
}

export interface AuthFailMessage {
  type: 'auth_fail';
  reason: string;
  timestamp: string;
}

// ============== 序列化工具 ==============
export function serializeMessage(msg: ProtocolMessage): string {
  return JSON.stringify(msg);
}

export function deserializeMessage(data: string): ProtocolMessage {
  return JSON.parse(data) as ProtocolMessage;
}
