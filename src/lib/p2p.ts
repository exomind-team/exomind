/**
 * P2P 模块
 * 现代化 P2P 连接状态管理，准备 libp2p 集成架构
 *
 * @module p2p
 */

// 导出类型定义（从 p2p/types.ts）
export * from './p2p/types';

// 导出管理器（从 p2p/manager.ts）
export { P2PManager, getP2PManager, destroyP2PManager } from './p2p/manager';

// 重新导出便捷函数（保持向后兼容）
export {
  getDevices,
  removeDevice,
  generatePairingCode,
  confirmPairing,
  getPairingRequests,
  connectToPeer,
  disconnectFromPeer,
  getConnectionStatus,
  disconnectAll,
  getLocalIp,
  onStateChanged,
  onPeerConnected,
  onPeerDisconnected,
  onError,
} from './p2p/manager';

// 直接调用 Tauri 命令（绕过 Manager）
export {
  invokeGetDevices,
  invokeRemoveDevice,
  invokeGetConnectionStatus,
} from './p2p/manager';
