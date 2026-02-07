/**
 * WebSocket 模块导出
 * @module ws
 */

// 认证模块
export * from './auth';

// 协议定义
export * from './protocol';

// 客户端实现
export * from './client';

// 便捷函数
export {
  getWSClient,
  destroyWSClient,
  WSConnectionState,
  WSMessageType,
  WSClientEventType,
  DEFAULT_WS_CONFIG,
} from './client';
