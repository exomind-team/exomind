/**
 * Device Pairing 模块
 * 现代化设备配对流程管理，支持状态机、超时处理、事件回调
 *
 * @module pairing
 */

import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 配对状态枚举
 * 状态机: idle → discovering → generating_code → waiting_confirm → paired → error
 */
export enum PairingState {
  Idle = 'idle',
  Discovering = 'discovering',
  GeneratingCode = 'generating_code',
  WaitingConfirm = 'waiting_confirm',
  Paired = 'paired',
  Error = 'error',
}

/**
 * 配对模式
 */
export enum PairingMode {
  /**
   * 作为发起方：生成配对码，等待对方确认
   */
  Initiator = 'initiator',
  /**
   * 作为接收方：输入配对码，确认配对请求
   */
  Receiver = 'receiver',
}

/**
 * 发现设备接口
 */
export interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  type: 'desktop' | 'mobile';
  publicKey?: string;
}

/**
 * 已配对设备接口
 */
export interface PairedDevice extends DiscoveredDevice {
  pairedAt: string;
  confirmed: boolean;
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
  expiresAt: string;
}

/**
 * 配对配置
 */
export interface PairingConfig {
  /** 配对码长度 */
  codeLength: number;
  /** 配对超时时间（毫秒） */
  timeout: number;
  /** 最大重试次数 */
  maxRetries: number;
}

/**
 * 默认配对配置
 */
export const DEFAULT_PAIRING_CONFIG: PairingConfig = {
  codeLength: 6,
  timeout: 30000, // 30秒
  maxRetries: 3,
};

/**
 * 配对结果
 */
export interface PairingResult {
  success: boolean;
  device?: PairedDevice;
  error?: string;
  code?: string;
}

/**
 * 配对事件载荷
 */
export interface PairingEventPayload {
  /**
   * 设备发现事件
   */
  deviceDiscovered: { device: DiscoveredDevice };
  /**
   * 配对请求已创建
   */
  requestCreated: { code: string; expiresAt: string };
  /**
   * 收到配对请求
   */
  requestReceived: { request: PairingRequest };
  /**
   * 配对确认
   */
  confirmed: { device: PairedDevice };
  /**
   * 配对拒绝
   */
  rejected: { reason?: string };
  /**
   * 配对超时
   */
  timeout: { reason: string };
  /**
   * 状态变更
   */
  stateChanged: { previousState: PairingState; currentState: PairingState };
  /**
   * 错误事件
   */
  error: { error: string };
}

/**
 * 配对事件类型（使用 camelCase 值以匹配 Payload）
 */
export enum PairingEventType {
  DeviceDiscovered = 'deviceDiscovered',
  RequestCreated = 'requestCreated',
  RequestReceived = 'requestReceived',
  Confirmed = 'confirmed',
  Rejected = 'rejected',
  Timeout = 'timeout',
  StateChanged = 'stateChanged',
  Error = 'error',
}

/**
 * 配对事件监听器类型
 */
export type PairingEventListener<K extends PairingEventType = PairingEventType> = (
  payload: PairingEventPayload[K]
) => void;

// ============================================================================
// 配对管理器
// ============================================================================

/**
 * 配对管理器
 * 封装设备配对全流程
 */
export class PairingManager {
  // 单例实例
  private static instance: PairingManager | null = null;

  // 状态管理
  private state: PairingState = PairingState.Idle;
  private config: PairingConfig;

  // 配对数据
  private currentCode: string = '';
  private pairedDevices: Map<string, PairedDevice> = new Map();

  // 超时处理
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private discoveryTimer: ReturnType<typeof setTimeout> | null = null;

  // 事件总线
  private eventListeners: Map<PairingEventType, Set<PairingEventListener>> = new Map();

  // 发现设备列表
  private discoveredDevices: Map<string, DiscoveredDevice> = new Map();

  // 私有构造函数（单例模式）
  private constructor(config: Partial<PairingConfig> = {}) {
    this.config = { ...DEFAULT_PAIRING_CONFIG, ...config };
  }

  // ============================================================================
  // 单例模式
  // ============================================================================

  /**
   * 获取单例实例
   */
  static getInstance(config?: Partial<PairingConfig>): PairingManager {
    if (!PairingManager.instance) {
      PairingManager.instance = new PairingManager(config);
    }
    return PairingManager.instance;
  }

  /**
   * 销毁单例实例
   */
  static destroyInstance(): void {
    if (PairingManager.instance) {
      PairingManager.instance.cleanup();
      PairingManager.instance = null;
    }
  }

  // ============================================================================
  // 状态管理
  // ============================================================================

  /**
   * 获取当前状态
   */
  getState(): PairingState {
    return this.state;
  }

  /**
   * 检查是否处于活跃配对状态
   */
  isPairing(): boolean {
    return (
      this.state === PairingState.Discovering ||
      this.state === PairingState.GeneratingCode ||
      this.state === PairingState.WaitingConfirm
    );
  }

  /**
   * 检查是否已配对
   */
  isPaired(): boolean {
    return this.state === PairingState.Paired;
  }

  // ============================================================================
  // 设备发现
  // ============================================================================

  /**
   * 开始发现设备
   */
  async startDiscovery(): Promise<void> {
    if (this.state === PairingState.Discovering) {
      return;
    }

    this.setState(PairingState.Discovering);
    this.discoveredDevices.clear();

    try {
      await invoke('start_device_discovery');
    } catch (error) {
      this.handleError('Discovery failed', error);
    }
  }

  /**
   * 停止发现设备
   */
  stopDiscovery(): void {
    if (this.discoveryTimer) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = null;
    }

    try {
      invoke('stop_device_discovery');
    } catch (error) {
      console.error('Stop discovery error:', error);
    }

    if (this.state === PairingState.Discovering) {
      this.setState(PairingState.Idle);
    }
  }

  /**
   * 添加发现的设备
   */
  addDiscoveredDevice(device: DiscoveredDevice): void {
    this.discoveredDevices.set(device.id, device);
    this.emit(PairingEventType.DeviceDiscovered, { device });
  }

  /**
   * 获取发现的设备列表
   */
  getDiscoveredDevices(): DiscoveredDevice[] {
    return Array.from(this.discoveredDevices.values());
  }

  // ============================================================================
  // 配对流程 - 发起方
  // ============================================================================

  /**
   * 生成配对码（作为发起方）
   */
  async generatePairingCode(deviceName: string, publicKey: string): Promise<string> {
    if (this.isPairing()) {
      throw new Error('Already in pairing process');
    }

    this.setState(PairingState.GeneratingCode);

    try {
      // 调用后端生成配对码
      const code = await invoke<string>('generate_pairing_code', {
        deviceName,
        deviceIp: '', // 后端会填充本地IP
        publicKey,
      });

      this.currentCode = code;

      // 计算过期时间
      const expiresAt = new Date(Date.now() + this.config.timeout).toISOString();

      // 设置超时定时器
      this.startTimeoutTimer();

      this.setState(PairingState.WaitingConfirm);

      // 发送请求创建事件
      this.emit(PairingEventType.RequestCreated, { code, expiresAt });

      return code;
    } catch (error) {
      this.handleError('Failed to generate pairing code', error);
      throw error;
    }
  }

  /**
   * 取消当前配对
   */
  async cancelPairing(): Promise<void> {
    this.clearTimeoutTimer();

    if (this.currentCode) {
      try {
        await invoke('cancel_pairing', { code: this.currentCode });
      } catch (error) {
        console.error('Cancel pairing error:', error);
      }
    }

    this.currentCode = '';

    if (this.isPairing()) {
      this.setState(PairingState.Idle);
    }
  }

  // ============================================================================
  // 配对流程 - 接收方
  // ============================================================================

  /**
   * 处理收到的配对请求
   */
  handlePairingRequest(request: PairingRequest): void {
    this.emit(PairingEventType.RequestReceived, { request });
  }

  /**
   * 确认配对（作为接收方）
   */
  async confirmPairing(code: string, accept: boolean = true): Promise<PairingResult> {
    if (!accept) {
      this.emit(PairingEventType.Rejected, {});
      this.setState(PairingState.Idle);
      return { success: false };
    }

    try {
      const result = await invoke<{
        success: boolean;
        device?: PairedDevice;
        error?: string;
      }>('confirm_pairing', { code, accept: true });

      if (result.success) {
        this.clearTimeoutTimer();

        if (result.device) {
          this.pairedDevices.set(result.device.id, result.device);
          this.setState(PairingState.Paired);
          this.emit(PairingEventType.Confirmed, { device: result.device });

          return { success: true, device: result.device };
        }
      }

      return { success: false, error: result.error };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.handleError('Confirm pairing failed', error);
      return { success: false, error: errorMessage };
    }
  }

  // ============================================================================
  // 已配对设备管理
  // ============================================================================

  /**
   * 获取所有已配对设备
   */
  async getPairedDevices(): Promise<PairedDevice[]> {
    try {
      const devices = await invoke<PairedDevice[]>('get_paired_devices');
      this.pairedDevices.clear();
      devices.forEach(d => this.pairedDevices.set(d.id, d));
      return devices;
    } catch (error) {
      console.error('Get paired devices error:', error);
      return [];
    }
  }

  /**
   * 移除已配对设备
   */
  async removeDevice(deviceId: string): Promise<boolean> {
    try {
      const result = await invoke<{ success: boolean }>('remove_paired_device', {
        device_id: deviceId,
      });

      if (result.success) {
        this.pairedDevices.delete(deviceId);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Remove device error:', error);
      return false;
    }
  }

  /**
   * 检查设备是否已配对
   */
  isDevicePaired(deviceId: string): boolean {
    return this.pairedDevices.has(deviceId);
  }

  // ============================================================================
  // 事件系统
  // ============================================================================

  /**
   * 订阅事件
   */
  on<K extends PairingEventType>(
    eventType: K,
    listener: PairingEventListener<K>
  ): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener as PairingEventListener);

    return () => this.off(eventType, listener);
  }

  /**
   * 取消订阅
   */
  off<K extends PairingEventType>(
    eventType: K,
    listener: PairingEventListener<K>
  ): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(listener as PairingEventListener);
    }
  }

  /**
   * 发布事件
   */
  private emit<K extends PairingEventType>(
    eventType: K,
    payload: PairingEventPayload[K]
  ): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch (error) {
          console.error(`Pairing event listener error: ${eventType}`, error);
        }
      });
    }
  }

  // ============================================================================
  // 内部方法
  // ============================================================================

  /**
   * 设置状态
   */
  private setState(newState: PairingState): void {
    if (this.state === newState) {
      return;
    }

    const previousState = this.state;
    this.state = newState;

    this.emit(PairingEventType.StateChanged, {
      previousState,
      currentState: newState,
    });
  }

  /**
   * 启动超时定时器
   */
  private startTimeoutTimer(): void {
    this.clearTimeoutTimer();

    this.timeoutTimer = setTimeout(() => {
      this.handleTimeout();
    }, this.config.timeout);
  }

  /**
   * 清除超时定时器
   */
  private clearTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /**
   * 处理超时
   */
  private handleTimeout(): void {
    this.clearTimeoutTimer();

    const reason = 'Pairing timeout';
    this.emit(PairingEventType.Timeout, { reason });

    this.currentCode = '';

    this.setState(PairingState.Error);

    // 延迟后恢复空闲状态
    setTimeout(() => {
      if (this.state === PairingState.Error) {
        this.setState(PairingState.Idle);
      }
    }, 2000);
  }

  /**
   * 处理错误
   */
  private handleError(message: string, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.emit(PairingEventType.Error, { error: `${message}: ${errorMessage}` });
    this.setState(PairingState.Error);

    this.currentCode = '';

    // 延迟后恢复空闲状态
    setTimeout(() => {
      if (this.state === PairingState.Error) {
        this.setState(PairingState.Idle);
      }
    }, 2000);
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.clearTimeoutTimer();
    this.stopDiscovery();
    this.eventListeners.clear();
    this.discoveredDevices.clear();
  }
}

// ============================================================================
// 导出
// ============================================================================

/**
 * 获取配对管理器默认实例
 */
export function getPairingManager(config?: Partial<PairingConfig>): PairingManager {
  return PairingManager.getInstance(config);
}

/**
 * 销毁配对管理器实例
 */
export function destroyPairingManager(): void {
  PairingManager.destroyInstance();
}
