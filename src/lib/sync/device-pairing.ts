import { DiscoveredDevice } from './device-discovery';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// 配对状态机定义
// ============================================================================

export type PairingState =
  | 'idle'           // 空闲状态，等待开始配对
  | 'discovering'    // 发现设备中
  | 'generating'     // 生成配对码
  | 'pairing'       // 等待对方确认配对
  | 'confirming'     // 等待用户确认
  | 'paired'        // 配对成功
  | 'error'         // 配对失败
  | 'timeout'       // 配对超时
  | 'cancelled';    // 配对取消

export interface PairingEventMap {
  'idle': null;
  'discovering': { devices: DiscoveredDevice[] };
  'generating': null;
  'pairing': { code: string; expiresIn: number };
  'confirming': { device: DiscoveredDevice; code: string };
  'paired': { device: PairedDevice };
  'error': { reason: string; code?: string };
  'timeout': { code: string };
  'cancelled': { reason?: string };
}

// ============================================================================
// 配对配置
// ============================================================================

export interface PairingConfig {
  /** 超时时间（毫秒），默认 30 秒 */
  timeoutMs: number;
  /** 配对码长度，默认 6 位 */
  codeLength: number;
  /** 配对码字符集，默认数字+大写字母 */
  codeCharset: string;
  /** 是否自动开始发现设备 */
  autoDiscover: boolean;
}

const DEFAULT_CONFIG: PairingConfig = {
  timeoutMs: 30_000,      // 30 秒
  codeLength: 6,
  codeCharset: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  autoDiscover: false,
};

// ============================================================================
// 配对数据模型
// ============================================================================

export interface PairingRequest {
  id: string;
  code: string;
  device: DiscoveredDevice;
  createdAt: number;
  expiresAt: number;
}

export interface PairedDevice extends DiscoveredDevice {
  pairedAt: number;
  confirmed: boolean;
  publicKey?: string;
}

// ============================================================================
// 事件监听器类型
// ============================================================================

export type PairingEventType = keyof PairingEventMap;

export type PairingEventHandler<E extends PairingEventType> =
  (data: PairingEventMap[E]) => void | Promise<void>;

export type PairingEventListeners = {
  [K in PairingEventType]?: PairingEventHandler<K>[];
};

// ============================================================================
// 配对管理器
// ============================================================================

export class PairingManager {
  private state: PairingState = 'idle';
  private config: PairingConfig;
  private listeners: PairingEventListeners = {};
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private currentRequest: PairingRequest | null = null;
  private pendingPairingCode: string | null = null;
  private pairedDevices: PairedDevice[] = [];

  constructor(config: Partial<PairingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // =========================================================================
  // 状态管理
  // =========================================================================

  /** 获取当前配对状态 */
  getState(): PairingState {
    return this.state;
  }

  /** 检查是否处于活跃配对状态 */
  isActive(): boolean {
    return ['discovering', 'generating', 'pairing', 'confirming'].includes(this.state);
  }

  /** 检查是否已配对 */
  isPaired(): boolean {
    return this.state === 'paired';
  }

  /** 检查是否可取消 */
  canCancel(): boolean {
    return ['discovering', 'generating', 'pairing', 'confirming'].includes(this.state);
  }

  // =========================================================================
  // 配对流程
  // =========================================================================

  /**
   * 开始配对流程（作为发起方）
   * @param device 目标设备
   */
  async startPairing(device: DiscoveredDevice): Promise<string> {
    if (this.isActive()) {
      throw new Error(`Cannot start pairing: current state is ${this.state}`);
    }

    // 生成配对码
    const code = this.generateCode();
    const now = Date.now();
    const request: PairingRequest = {
      id: uuidv4(),
      code,
      device,
      createdAt: now,
      expiresAt: now + this.config.timeoutMs,
    };

    this.currentRequest = request;
    this.pendingPairingCode = code;

    // 切换到 pairing 状态
    await this.transitionTo('pairing', { code, expiresIn: this.config.timeoutMs });

    // 启动超时计时器
    this.startTimeoutTimer();

    return code;
  }

  /**
   * 开始配对确认流程（作为接收方）
   * @param device 请求配对的设备
   * @param code 配对码
   */
  async startConfirming(device: DiscoveredDevice, code: string): Promise<void> {
    if (this.isActive()) {
      throw new Error(`Cannot start confirming: current state is ${this.state}`);
    }

    // 验证配对码格式
    if (!this.validateCodeFormat(code)) {
      await this.transitionTo('error', { reason: 'Invalid pairing code format', code });
      throw new Error('Invalid pairing code format');
    }

    const now = Date.now();
    const request: PairingRequest = {
      id: uuidv4(),
      code,
      device,
      createdAt: now,
      expiresAt: now + this.config.timeoutMs,
    };

    this.currentRequest = request;

    // 切换到 confirming 状态，等待用户确认
    await this.transitionTo('confirming', { device, code });

    // 启动超时计时器
    this.startTimeoutTimer();
  }

  /**
   * 确认配对
   * @param accept 是否接受配对
   */
  async confirmPairing(accept: boolean): Promise<boolean> {
    if (this.state !== 'confirming' || !this.currentRequest) {
      throw new Error('Cannot confirm: not in confirming state');
    }

    this.clearTimeoutTimer();

    // 保存状态用于测试验证
    const previousState = this.state;

    if (!accept) {
      await this.transitionTo('cancelled', { reason: 'User rejected pairing' });
      this.reset();
      return false;
    }

    // 创建设备记录
    const device: PairedDevice = {
      ...this.currentRequest.device,
      pairedAt: Date.now(),
      confirmed: true,
    };

    // 保存到已配对列表
    this.pairedDevices.push(device);

    // 持久化
    this.savePairedDevices();

    await this.transitionTo('paired', { device });
    this.reset();

    return true;
  }

  /**
   * 取消当前配对流程
   */
  async cancelPairing(reason?: string): Promise<void> {
    if (!this.canCancel()) {
      throw new Error(`Cannot cancel: current state is ${this.state}`);
    }

    this.clearTimeoutTimer();
    await this.transitionTo('cancelled', { reason });
    this.reset();
  }

  /**
   * 重置配对管理器
   */
  reset(): void {
    this.clearTimeoutTimer();
    this.currentRequest = null;
    this.pendingPairingCode = null;
    this.state = 'idle';
  }

  // =========================================================================
  // 配对码生成与验证
  // =========================================================================

  /** 生成配对码 */
  generateCode(): string {
    const { codeLength, codeCharset } = this.config;
    let code = '';
    const randomValues = new Uint32Array(codeLength);
    crypto.getRandomValues(randomValues);

    for (let i = 0; i < codeLength; i++) {
      code += codeCharset[randomValues[i] % codeCharset.length];
    }

    return code;
  }

  /** 验证配对码格式 */
  validateCodeFormat(code: string): boolean {
    if (code.length !== this.config.codeLength) {
      return false;
    }

    // 检查字符集
    const validChars = new Set(this.config.codeCharset);
    for (const char of code) {
      if (!validChars.has(char)) {
        return false;
      }
    }

    return true;
  }

  /** 验证配对码是否匹配 */
  validateCode(code: string): boolean {
    return this.pendingPairingCode === code.toUpperCase();
  }

  /** 获取当前配对码 */
  getPendingCode(): string | null {
    return this.pendingPairingCode;
  }

  // =========================================================================
  // 超时管理
  // =========================================================================

  /** 启动超时计时器 */
  private startTimeoutTimer(): void {
    this.clearTimeoutTimer();

    this.timeoutTimer = setTimeout(async () => {
      if (this.currentRequest) {
        await this.transitionTo('timeout', { code: this.currentRequest.code });
        this.reset();
      }
    }, this.config.timeoutMs);
  }

  /** 清除超时计时器 */
  private clearTimeoutTimer(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  /** 获取剩余超时时间（毫秒） */
  getRemainingTimeout(): number {
    if (!this.currentRequest) {
      return 0;
    }

    const remaining = this.currentRequest.expiresAt - Date.now();
    return Math.max(0, remaining);
  }

  // =========================================================================
  // 事件系统
  // =========================================================================

  /**
   * 注册事件监听器
   */
  on<K extends PairingEventType>(
    event: K,
    handler: PairingEventHandler<K>
  ): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(handler as PairingEventHandler<K>);

    // 返回取消监听器的函数
    return () => {
      this.off(event, handler);
    };
  }

  /**
   * 移除事件监听器
   */
  off<K extends PairingEventType>(
    event: K,
    handler?: PairingEventHandler<K>
  ): void {
    if (!this.listeners[event]) {
      return;
    }

    if (handler) {
      const index = this.listeners[event]!.findIndex(h => h === handler);
      if (index !== -1) {
        this.listeners[event]!.splice(index, 1);
      }
    } else {
      this.listeners[event] = [];
    }
  }

  /**
   * 触发事件
   */
  private async emit<K extends PairingEventType>(
    event: K,
    data: PairingEventMap[K]
  ): Promise<void> {
    const handlers = this.listeners[event] || [];
    for (const handler of handlers) {
      await handler(data);
    }
  }

  /**
   * 状态转换
   */
  private async transitionTo<K extends PairingState>(
    newState: K,
    data: PairingEventMap[K]
  ): Promise<void> {
    this.state = newState;
    await this.emit(newState, data);
  }

  // =========================================================================
  // 已配对设备管理
  // =========================================================================

  /** 获取所有已配对设备 */
  getPairedDevices(): PairedDevice[] {
    return [...this.pairedDevices];
  }

  /** 添加已配对设备 */
  addPairedDevice(device: PairedDevice): void {
    // 避免重复添加
    const exists = this.pairedDevices.some(d => d.id === device.id);
    if (!exists) {
      this.pairedDevices.push(device);
      this.savePairedDevices();
    }
  }

  /** 移除已配对设备 */
  removePairedDevice(deviceId: string): boolean {
    const index = this.pairedDevices.findIndex(d => d.id === deviceId);
    if (index !== -1) {
      this.pairedDevices.splice(index, 1);
      this.savePairedDevices();
      return true;
    }
    return false;
  }

  /** 检查设备是否已配对 */
  isDevicePaired(deviceId: string): boolean {
    return this.pairedDevices.some(d => d.id === deviceId);
  }

  /** 从本地存储加载已配对设备 */
  loadPairedDevices(): void {
    try {
      const stored = localStorage.getItem('pairedDevices');
      if (stored) {
        this.pairedDevices = JSON.parse(stored);
      }
    } catch {
      console.error('Failed to load paired devices from storage');
      this.pairedDevices = [];
    }
  }

  /** 保存已配对设备到本地存储 */
  private savePairedDevices(): void {
    try {
      localStorage.setItem('pairedDevices', JSON.stringify(this.pairedDevices));
    } catch {
      console.error('Failed to save paired devices to storage');
    }
  }

  // =========================================================================
  // 配置管理
  // =========================================================================

  /** 获取当前配置 */
  getConfig(): Readonly<PairingConfig> {
    return { ...this.config };
  }

  /** 更新配置 */
  updateConfig(config: Partial<PairingConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================================
// 单例导出
// ============================================================================

let _pairingManager: PairingManager | null = null;

export function getPairingManager(config?: Partial<PairingConfig>): PairingManager {
  if (!_pairingManager) {
    _pairingManager = new PairingManager(config);
    _pairingManager.loadPairedDevices();
  }
  return _pairingManager;
}

export function resetPairingManager(): void {
  if (_pairingManager) {
    _pairingManager.reset();
    _pairingManager = null;
  }
}
