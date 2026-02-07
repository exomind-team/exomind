/**
 * P2P 连接类型定义
 * 现代化 P2P 连接状态管理，准备 libp2p 集成架构
 */

// ============================================================================
// 连接状态机
// ============================================================================

/**
 * P2P 连接状态枚举
 * 状态机: disconnected → connecting → connected → error
 */
export enum P2PConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Error = 'error',
}

/**
 * Peer 连接状态
 */
export enum PeerConnectionStatus {
  Connecting = 'connecting',
  Connected = 'connected',
  Disconnected = 'disconnected',
  Failed = 'failed',
}

// ============================================================================
// 基础类型
// ============================================================================

/**
 * 设备信息
 */
export interface Device {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy';
  lastSeen?: string;
  ip?: string;
  publicKey?: string;
  pairedAt?: string;
}

/**
 * Peer 信息
 */
export interface PeerInfo {
  peerId: string;
  deviceId?: string;
  name?: string;
  ip: string;
  status: PeerConnectionStatus;
  connectedAt?: string;
  lastSeen?: string;
}

/**
 * 配对请求
 */
export interface PairingRequest {
  code: string;
  deviceName: string;
  deviceIp: string;
  publicKey: string;
  createdAt: string;
}

/**
 * 配对结果
 */
export interface PairingResult {
  success: boolean;
  device?: Device;
  error?: string;
}

// ============================================================================
// 连接管理类型
// ============================================================================

/**
 * 连接结果
 */
export interface ConnectionResult {
  success: boolean;
  error?: string;
}

/**
 * 连接状态响应
 */
export interface ConnectionStatus {
  isConnected: boolean;
  state: P2PConnectionState;
  peerCount: number;
  peers: PeerInfo[];
  lastError?: string;
}

/**
 * 连接配置
 */
export interface P2PConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔（毫秒） */
  retryInterval: number;
  /** 连接超时（毫秒） */
  connectionTimeout: number;
  /** 是否自动重连 */
  autoReconnect: boolean;
}

// ============================================================================
// 事件系统类型
// ============================================================================

/**
 * P2P 连接事件类型
 */
export enum P2PEventType {
  StateChanged = 'stateChanged',
  PeerConnected = 'peerConnected',
  PeerDisconnected = 'peerDisconnected',
  PeerFailed = 'peerFailed',
  Error = 'error',
  ConnectionTimeout = 'connectionTimeout',
}

/**
 * P2P 事件载荷
 */
export interface P2PEventPayload {
  [P2PEventType.StateChanged]: {
    previousState: P2PConnectionState;
    currentState: P2PConnectionState;
  };
  [P2PEventType.PeerConnected]: PeerInfo;
  [P2PEventType.PeerDisconnected]: { peerId: string };
  [P2PEventType.PeerFailed]: { peerId: string; error: string };
  [P2PEventType.Error]: { error: string };
  [P2PEventType.ConnectionTimeout]: { peerId?: string };
}

/**
 * P2P 事件监听器类型
 */
export type P2PEventListener<K extends P2PEventType = P2PEventType> = (
  payload: P2PEventPayload[K]
) => void;

// ============================================================================
// libp2p 预留接口类型
// ============================================================================

/**
 * libp2p 连接配置（预留）
 */
export interface Libp2pConfig {
  /** 节点 ID */
  peerId?: string;
  /** 监听地址 */
  listenAddresses: string[];
  /** 连接 manager 配置 */
  connectionManager?: {
    maxConnections: number;
    minConnections: number;
  };
  /** 中继配置 */
  relay?: {
    enabled: boolean;
    hopLimit?: number;
  };
}

/**
 * libp2p 连接信息（预留）
 */
export interface Libp2pConnectionInfo {
  multiaddr: string;
  protocol: string;
  direction: 'inbound' | 'outbound';
}

// ============================================================================
// 默认配置
// ============================================================================

/**
 * P2P 默认配置
 */
export const DEFAULT_P2P_CONFIG: P2PConfig = {
  maxRetries: 3,
  retryInterval: 1000,
  connectionTimeout: 30000,
  autoReconnect: false,
};
