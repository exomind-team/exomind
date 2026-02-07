/**
 * P2P 连接管理器
 * 现代化 P2P 连接状态管理，准备 libp2p 集成架构
 */

import { invoke } from '@tauri-apps/api/core';
import {
  P2PConnectionState,
  PeerConnectionStatus,
  PeerInfo,
  ConnectionResult,
  ConnectionStatus,
  P2PConfig,
  DEFAULT_P2P_CONFIG,
  P2PEventType,
  P2PEventPayload,
  P2PEventListener,
  RustDevice,
  RustPairingRequest,
  RustConnectionStatus,
} from './types';

// ============================================================================
// 事件总线
// ============================================================================

/**
 * P2P 事件总线
 * 支持事件订阅和发布
 */
class P2PEventBus {
  private listeners: Map<P2PEventType, Set<P2PEventListener>> = new Map();

  /**
   * 订阅事件
   */
  on<K extends P2PEventType>(
    eventType: K,
    listener: P2PEventListener<K>
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener as P2PEventListener);

    // 返回取消订阅函数
    return () => this.off(eventType, listener);
  }

  /**
   * 取消订阅
   */
  off<K extends P2PEventType>(
    eventType: K,
    listener: P2PEventListener<K>
  ): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.delete(listener as P2PEventListener);
    }
  }

  /**
   * 发布事件
   */
  emit<K extends P2PEventType>(
    eventType: K,
    payload: P2PEventPayload[K]
  ): void {
    const listeners = this.listeners.get(eventType);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch (error) {
          console.error(`P2P event listener error: ${eventType}`, error);
        }
      });
    }
  }

  /**
   * 清除所有监听器
   */
  clear(): void {
    this.listeners.clear();
  }
}

// ============================================================================
// P2P 管理器
// ============================================================================

/**
 * P2P 连接管理器
 * 封装 P2P 连接逻辑，支持：
 * - 连接状态机管理
 * - 连接事件回调
 * - 重连机制
 * - libp2p 预留接口
 */
export class P2PManager {
  // 单例实例
  private static instance: P2PManager | null = null;

  // 状态管理
  private currentState: P2PConnectionState = P2PConnectionState.Disconnected;
  private peers: Map<string, PeerInfo> = new Map();
  private config: P2PConfig;
  private eventBus: P2PEventBus = new P2PEventBus();

  // 重连状态
  private retryCount: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 私有构造函数（单例模式）
   */
  private constructor(config: Partial<P2PConfig> = {}) {
    this.config = { ...DEFAULT_P2P_CONFIG, ...config };
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: Partial<P2PConfig>): P2PManager {
    if (!P2PManager.instance) {
      P2PManager.instance = new P2PManager(config);
    }
    return P2PManager.instance;
  }

  /**
   * 销毁单例实例（主要用于测试）
   */
  static destroyInstance(): void {
    if (P2PManager.instance) {
      P2PManager.instance.disconnectAll();
      P2PManager.instance.eventBus.clear();
      P2PManager.instance = null;
    }
  }

  // ============================================================================
  // 状态管理
  // ============================================================================

  /**
   * 获取当前连接状态
   */
  getState(): P2PConnectionState {
    return this.currentState;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.currentState === P2PConnectionState.Connected;
  }

  /**
   * 检查是否正在连接
   */
  isConnecting(): boolean {
    return this.currentState === P2PConnectionState.Connecting;
  }

  /**
   * 获取所有已连接的 peers
   */
  getConnectedPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).filter(
      (peer) => peer.status === PeerConnectionStatus.Connected
    );
  }

  /**
   * 获取 peer 数量
   */
  getPeerCount(): number {
    return this.peers.size;
  }

  // ============================================================================
  // 事件系统
  // ============================================================================

  /**
   * 订阅连接状态变更事件
   */
  onStateChanged(listener: P2PEventListener<P2PEventType.StateChanged>): () => void {
    return this.eventBus.on(P2PEventType.StateChanged, listener);
  }

  /**
   * 订阅 peer 连接事件
   */
  onPeerConnected(listener: P2PEventListener<P2PEventType.PeerConnected>): () => void {
    return this.eventBus.on(P2PEventType.PeerConnected, listener);
  }

  /**
   * 订阅 peer 断开事件
   */
  onPeerDisconnected(listener: P2PEventListener<P2PEventType.PeerDisconnected>): () => void {
    return this.eventBus.on(P2PEventType.PeerDisconnected, listener);
  }

  /**
   * 订阅错误事件
   */
  onError(listener: P2PEventListener<P2PEventType.Error>): () => void {
    return this.eventBus.on(P2PEventType.Error, listener);
  }

  /**
   * 订阅任意事件
   */
  on<K extends P2PEventType>(
    eventType: K,
    listener: P2PEventListener<K>
  ): () => void {
    return this.eventBus.on(eventType, listener);
  }

  // ============================================================================
  // 连接操作
  // ============================================================================

  /**
   * 连接到 peer
   */
  async connect(peerId: string): Promise<ConnectionResult> {
    // 检查状态
    if (this.currentState === P2PConnectionState.Connecting) {
      return { success: false, error: 'Already connecting' };
    }

    // 如果已连接，直接返回成功
    if (this.peers.has(peerId)) {
      const peer = this.peers.get(peerId)!;
      if (peer.status === PeerConnectionStatus.Connected) {
        return { success: true };
      }
    }

    // 更新状态
    this.setState(P2PConnectionState.Connecting);

    try {
      // 调用后端连接
      const result = await invoke<ConnectionResult>('connect_to_peer', { peerId });

      if (result.success) {
        // 添加到 peers 列表
        const peerInfo: PeerInfo = {
          peerId,
          ip: '',
          status: PeerConnectionStatus.Connected,
          connectedAt: new Date().toISOString(),
        };
        this.peers.set(peerId, peerInfo);

        // 更新状态
        this.setState(P2PConnectionState.Connected);

        // 发送连接成功事件
        this.eventBus.emit(P2PEventType.PeerConnected, peerInfo);

        // 重置重试计数
        this.retryCount = 0;

        return { success: true };
      } else {
        // 连接失败
        this.handleConnectionError(peerId, result.error || 'Unknown error');
        return { success: false, error: result.error };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.handleConnectionError(peerId, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 断开与 peer 的连接
   */
  async disconnect(peerId: string): Promise<ConnectionResult> {
    try {
      const result = await invoke<ConnectionResult>('disconnect_from_peer', { peerId });

      if (result.success) {
        // 从列表中移除
        const removed = this.peers.delete(peerId);

        if (removed) {
          // 发送断开事件
          this.eventBus.emit(P2PEventType.PeerDisconnected, { peerId });
        }

        // 如果没有 peers 了，更新全局状态
        if (this.peers.size === 0) {
          this.setState(P2PConnectionState.Disconnected);
        }

        return { success: true };
      }

      return { success: false, error: result.error };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      await invoke('disconnect_all');
    } catch (error) {
      console.error('Disconnect all failed:', error);
    }

    // 清除所有 peers
    const peerIds = Array.from(this.peers.keys());
    this.peers.clear();

    // 发送断开事件
    peerIds.forEach((peerId) => {
      this.eventBus.emit(P2PEventType.PeerDisconnected, { peerId });
    });

    // 更新状态
    this.setState(P2PConnectionState.Disconnected);
    this.retryCount = 0;
  }

  // ============================================================================
  // 查询操作
  // ============================================================================

  /**
   * 获取连接状态
   */
  async getStatus(): Promise<ConnectionStatus> {
    try {
      const result = await invoke<RustConnectionStatus>('get_connection_status');

      // 同步本地状态
      this.peers.clear();
      result.peers.forEach((peer) => {
        this.peers.set(peer.peer_id, {
          peerId: peer.peer_id,
          ip: peer.ip,
          status: peer.status as PeerConnectionStatus,
        });
      });

      return {
        isConnected: result.is_connected,
        state: this.currentState,
        peerCount: result.peer_count,
        peers: this.getConnectedPeers(),
        lastError: result.last_error,
      };
    } catch (error) {
      return {
        isConnected: false,
        state: this.currentState,
        peerCount: 0,
        peers: [],
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取本地 IP
   */
  async getLocalIp(): Promise<string> {
    return invoke('get_local_ip_with_random_port');
  }

  // ============================================================================
  // 配对操作
  // ============================================================================

  /**
   * 获取所有已配对设备
   */
  async getDevices(): Promise<RustDevice[]> {
    return invoke<RustDevice[]>('get_paired_devices');
  }

  /**
   * 移除已配对设备
   */
  async removeDevice(id: string): Promise<{ success: boolean }> {
    return invoke('remove_paired_device', { device_id: id });
  }

  /**
   * 生成配对码
   */
  async generatePairingCode(
    deviceName: string,
    publicKey: string
  ): Promise<string> {
    const ip = await this.getLocalIp();
    return invoke('generate_pairing_code', {
      deviceName,
      deviceIp: ip,
      publicKey,
    });
  }

  /**
   * 确认配对
   */
  async confirmPairing(code: string, accept: boolean = true): Promise<boolean> {
    return invoke('confirm_pairing', { code, accept });
  }

  /**
   * 获取待处理的配对请求
   */
  async getPairingRequests(): Promise<RustPairingRequest[]> {
    return invoke<RustPairingRequest[]>('get_pairing_requests');
  }

  // ============================================================================
  // 内部方法
  // ============================================================================

  /**
   * 设置连接状态（内部方法）
   */
  private setState(newState: P2PConnectionState): void {
    if (this.currentState === newState) {
      return;
    }

    const previousState = this.currentState;
    this.currentState = newState;

    // 发送状态变更事件
    this.eventBus.emit(P2PEventType.StateChanged, {
      previousState,
      currentState: newState,
    });
  }

  /**
   * 处理连接错误
   */
  private handleConnectionError(peerId: string, error: string): void {
    // 更新 peer 状态
    const existingPeer = this.peers.get(peerId);
    if (existingPeer) {
      existingPeer.status = PeerConnectionStatus.Failed;
      this.peers.set(peerId, existingPeer);
    }

    // 发送错误事件
    this.eventBus.emit(P2PEventType.Error, { error });

    // 如果启用了自动重连，尝试重连
    if (this.config.autoReconnect && this.retryCount < this.config.maxRetries) {
      this.scheduleReconnect(peerId);
    } else if (!this.config.autoReconnect || this.retryCount >= this.config.maxRetries) {
      // 如果没有自动重连或已达到最大重试次数，更新状态
      this.setState(P2PConnectionState.Error);
    }
  }

  /**
   * 计划重连
   */
  private scheduleReconnect(peerId: string): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.retryCount++;
    const delay = this.config.retryInterval * Math.pow(2, this.retryCount - 1);

    console.log(`Scheduling reconnect for ${peerId} in ${delay}ms (retry ${this.retryCount})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect(peerId);
    }, delay);
  }
}

// ============================================================================
// 导出默认实例
// ============================================================================

/**
 * 获取 P2P 管理器默认实例
 */
export function getP2PManager(config?: Partial<P2PConfig>): P2PManager {
  return P2PManager.getInstance(config);
}

/**
 * 销毁 P2P 管理器实例（主要用于测试）
 */
export function destroyP2PManager(): void {
  P2PManager.destroyInstance();
}

// ============================================================================
// 便捷函数导出（供 p2p.ts 重新导出）
// ============================================================================

export async function getDevices(): Promise<RustDevice[]> {
  return getP2PManager().getDevices() as Promise<RustDevice[]>;
}

export async function removeDevice(id: string): Promise<{ success: boolean }> {
  return getP2PManager().removeDevice(id);
}

export async function generatePairingCode(
  deviceName: string,
  publicKey: string
): Promise<string> {
  return getP2PManager().generatePairingCode(deviceName, publicKey);
}

export async function confirmPairing(
  code: string,
  accept: boolean = true
): Promise<boolean> {
  return getP2PManager().confirmPairing(code, accept);
}

export async function getPairingRequests(): Promise<RustPairingRequest[]> {
  return getP2PManager().getPairingRequests() as Promise<RustPairingRequest[]>;
}

export async function connectToPeer(peerId: string): Promise<ConnectionResult> {
  return getP2PManager().connect(peerId);
}

export async function disconnectFromPeer(
  peerId: string
): Promise<ConnectionResult> {
  return getP2PManager().disconnect(peerId);
}

export async function getConnectionStatus(): Promise<ConnectionStatus> {
  const status = await getP2PManager().getStatus();
  return {
    connected: status.isConnected,
    peerCount: status.peerCount,
  };
}

export async function disconnectAll(): Promise<void> {
  return getP2PManager().disconnectAll();
}

export async function getLocalIp(): Promise<string> {
  return getP2PManager().getLocalIp();
}

export function onStateChanged(
  callback: (payload: P2PEventPayload[P2PEventType.StateChanged]) => void
): () => void {
  return getP2PManager().onStateChanged(callback);
}

export function onPeerConnected(
  callback: (payload: P2PEventPayload[P2PEventType.PeerConnected]) => void
): () => void {
  return getP2PManager().onPeerConnected(callback);
}

export function onPeerDisconnected(
  callback: (payload: P2PEventPayload[P2PEventType.PeerDisconnected]) => void
): () => void {
  return getP2PManager().onPeerDisconnected(callback);
}

export function onError(
  callback: (payload: P2PEventPayload[P2PEventType.Error]) => void
): () => void {
  return getP2PManager().onError(callback);
}

export async function invokeGetDevices(): Promise<RustDevice[]> {
  return invoke<RustDevice[]>('get_paired_devices');
}

export async function invokeRemoveDevice(id: string): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('remove_paired_device', { device_id: id });
}

export async function invokeGetConnectionStatus(): Promise<RustConnectionStatus> {
  return invoke<RustConnectionStatus>('get_connection_status');
}
