/**
 * P2P 模块导出
 *
 * @module p2p
 */

// 类型定义
export * from './types';

// 管理器
export { P2PManager, getP2PManager, destroyP2PManager } from './manager';

// 事件类型导出
export {
  P2PEventType,
  type P2PEventPayload,
  type P2PEventListener,
} from './types';

// 状态枚举导出
export {
  P2PConnectionState,
  PeerConnectionStatus,
} from './types';

// 配置导出
export type { P2PConfig } from './types';
export { DEFAULT_P2P_CONFIG } from './types';
