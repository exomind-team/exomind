/**
 * Sync 模块 - 统一导出
 *
 * 注意：WebSocket 功能现在由 @/lib/ws/client.ts 提供
 */

// 消息存储（包含 SyncMessage 类型）
export * from './message-storage';

// 导出 SyncMessage 类型供其他模块使用
export type { SyncMessage } from './message-storage';

// 设备配对
export * from './device-pairing';

// 离线支持
export { OfflineQueue } from './offline';
