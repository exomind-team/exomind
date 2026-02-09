import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  PairingManager,
  PairingState,
  PairingEventMap,
  PairedDevice,
  getPairingManager,
  resetPairingManager,
} from '../../src/lib/sync/device-pairing';
import { DiscoveredDevice } from '../../src/lib/sync/device-discovery';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

vi.stubGlobal('localStorage', localStorageMock);

// Mock device for tests
const mockDevice: DiscoveredDevice = {
  id: 'test-device-1',
  name: 'Test Device',
  ip: '192.168.1.100',
  port: 8080,
  type: 'desktop',
};

describe('PairingManager', () => {
  let pairingManager: PairingManager;

  beforeEach(() => {
    // 重置单例
    resetPairingManager();

    // 创建新的 PairingManager 实例
    pairingManager = new PairingManager({
      timeoutMs: 5000, // 5秒超时，便于测试
      codeLength: 6,
      codeCharset: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      autoDiscover: false,
    });

    // 模拟 localStorage 返回空
    localStorageMock.getItem.mockReturnValue(null);

    // 加载已配对设备
    pairingManager.loadPairedDevices();
  });

  afterEach(() => {
    pairingManager.reset();
    vi.clearAllMocks();
  });

  // =========================================================================
  // 构造函数和配置测试
  // =========================================================================

  describe('constructor and config', () => {
    it('should initialize with default config', () => {
      const manager = new PairingManager();
      const config = manager.getConfig();

      expect(config.timeoutMs).toBe(30000);
      expect(config.codeLength).toBe(6);
      expect(config.codeCharset).toBe('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      expect(config.autoDiscover).toBe(false);
    });

    it('should accept custom config', () => {
      const manager = new PairingManager({
        timeoutMs: 60000,
        codeLength: 8,
        autoDiscover: true,
      });
      const config = manager.getConfig();

      expect(config.timeoutMs).toBe(60000);
      expect(config.codeLength).toBe(8);
      expect(config.autoDiscover).toBe(true);
    });

    it('should update config', () => {
      pairingManager.updateConfig({ timeoutMs: 120000 });
      expect(pairingManager.getConfig().timeoutMs).toBe(120000);
    });
  });

  // =========================================================================
  // 状态管理测试
  // =========================================================================

  describe('state management', () => {
    it('should start in idle state', () => {
      expect(pairingManager.getState()).toBe('idle');
    });

    it('should report isActive as false in idle state', () => {
      expect(pairingManager.isActive()).toBe(false);
    });

    it('should report isPaired as false in idle state', () => {
      expect(pairingManager.isPaired()).toBe(false);
    });

    it('should report canCancel as false in idle state', () => {
      expect(pairingManager.canCancel()).toBe(false);
    });
  });

  // =========================================================================
  // 配对码生成测试
  // =========================================================================

  describe('pairing code generation', () => {
    it('should generate code with correct length', () => {
      const code = pairingManager.generateCode();
      expect(code).toHaveLength(6);
    });

    it('should generate uppercase alphanumeric codes', () => {
      const code = pairingManager.generateCode();
      expect(code).toMatch(/^[0-9A-Z]+$/);
    });

    it('should generate unique codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(pairingManager.generateCode());
      }
      // 99-100% uniqueness expected
      expect(codes.size).toBeGreaterThan(90);
    });

    it('should validate correct code format', () => {
      expect(pairingManager.validateCodeFormat('ABC123')).toBe(true);
      expect(pairingManager.validateCodeFormat('123456')).toBe(true);
      expect(pairingManager.validateCodeFormat('XYZ789')).toBe(true);
    });

    it('should reject invalid code format', () => {
      expect(pairingManager.validateCodeFormat('ABC')).toBe(false); // too short
      expect(pairingManager.validateCodeFormat('ABC1234')).toBe(false); // too long
      expect(pairingManager.validateCodeFormat('abc123')).toBe(false); // lowercase
      expect(pairingManager.validateCodeFormat('AB@#$%')).toBe(false); // invalid chars
    });
  });

  // =========================================================================
  // 配对流程测试
  // =========================================================================

  describe('pairing flow', () => {
    it('should start pairing and generate code', async () => {
      const code = await pairingManager.startPairing(mockDevice);

      expect(code).toHaveLength(6);
      expect(pairingManager.getState()).toBe('pairing');
      expect(pairingManager.getPendingCode()).toBe(code);
    });

    it('should not allow starting pairing when already active', async () => {
      await pairingManager.startPairing(mockDevice);

      await expect(pairingManager.startPairing(mockDevice)).rejects.toThrow(
        'Cannot start pairing: current state is pairing'
      );
    });

    it('should emit cancelled event when pairing is cancelled', async () => {
      const cancelledHandler = vi.fn();
      pairingManager.on('cancelled', cancelledHandler as any);

      await pairingManager.startPairing(mockDevice);
      expect(pairingManager.canCancel()).toBe(true);

      await pairingManager.cancelPairing('User cancelled');

      expect(cancelledHandler).toHaveBeenCalledTimes(1);
      expect(cancelledHandler).toHaveBeenCalledWith({ reason: 'User cancelled' });
    });

    it('should not allow cancelling when not active', async () => {
      await expect(pairingManager.cancelPairing()).rejects.toThrow(
        'Cannot cancel: current state is idle'
      );
    });

    it('should reset correctly', async () => {
      await pairingManager.startPairing(mockDevice);
      expect(pairingManager.isActive()).toBe(true);

      pairingManager.reset();

      expect(pairingManager.isActive()).toBe(false);
      expect(pairingManager.getState()).toBe('idle');
      expect(pairingManager.getPendingCode()).toBeNull();
    });
  });

  // =========================================================================
  // 确认配对测试
  // =========================================================================

  describe('confirm pairing', () => {
    it('should start confirming state', async () => {
      await pairingManager.startConfirming(mockDevice, 'ABC123');

      expect(pairingManager.getState()).toBe('confirming');
    });

    it('should reject invalid code format when starting confirm', async () => {
      await expect(pairingManager.startConfirming(mockDevice, 'ABC'))
        .rejects.toThrow('Invalid pairing code format');
    });

    it('should confirm pairing successfully and emit paired event', async () => {
      const pairedHandler = vi.fn();
      pairingManager.on('paired', pairedHandler as any);

      await pairingManager.startConfirming(mockDevice, 'ABC123');
      const result = await pairingManager.confirmPairing(true);

      expect(result).toBe(true);
      expect(pairedHandler).toHaveBeenCalledTimes(1);
      expect(pairedHandler).toHaveBeenCalledWith({
        device: expect.objectContaining({ id: mockDevice.id }),
      });
    });

    it('should emit cancelled event when rejected', async () => {
      const cancelledHandler = vi.fn();
      pairingManager.on('cancelled', cancelledHandler as any);

      await pairingManager.startConfirming(mockDevice, 'ABC123');
      const result = await pairingManager.confirmPairing(false);

      expect(result).toBe(false);
      expect(cancelledHandler).toHaveBeenCalledTimes(1);
      expect(cancelledHandler).toHaveBeenCalledWith({ reason: 'User rejected pairing' });
    });

    it('should not allow confirm when not in confirming state', async () => {
      await expect(pairingManager.confirmPairing(true)).rejects.toThrow(
        'Cannot confirm: not in confirming state'
      );
    });
  });

  // =========================================================================
  // 事件系统测试
  // =========================================================================

  describe('event system', () => {
    it('should register and emit events', async () => {
      const handler = vi.fn();
      const unsubscribe = pairingManager.on('paired', handler as any);

      await pairingManager.startConfirming(mockDevice, 'ABC123');
      await pairingManager.confirmPairing(true);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        device: expect.objectContaining({
          id: mockDevice.id,
        }),
      });

      unsubscribe();
    });

    it('should support multiple event handlers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      pairingManager.on('paired', handler1 as any);
      pairingManager.on('paired', handler2 as any);

      await pairingManager.startConfirming(mockDevice, 'ABC123');
      await pairingManager.confirmPairing(true);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should support removing event handlers', async () => {
      const handler = vi.fn();

      pairingManager.on('paired', handler as any);
      pairingManager.off('paired');

      await pairingManager.startConfirming(mockDevice, 'ABC123');
      await pairingManager.confirmPairing(true);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should emit timeout event', async () => {
      const timeoutHandler = vi.fn();

      // 使用更短的超时
      const manager = new PairingManager({ timeoutMs: 10 });
      manager.on('timeout', timeoutHandler as any);

      await manager.startPairing(mockDevice);
      const pendingCode = manager.getPendingCode();

      // 等待超时触发
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(timeoutHandler).toHaveBeenCalledTimes(1);
      expect(timeoutHandler).toHaveBeenCalledWith({ code: pendingCode });
    });

    it('should emit error event for invalid code format', async () => {
      const errorHandler = vi.fn();

      const manager = new PairingManager();
      manager.on('error', errorHandler as any);

      await manager.startConfirming(mockDevice, 'INVALID!').catch(() => {});

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith({
        reason: 'Invalid pairing code format',
        code: 'INVALID!',
      });
    });
  });

  // =========================================================================
  // 已配对设备管理测试
  // =========================================================================

  describe('paired devices management', () => {
    it('should start with empty paired list', () => {
      expect(pairingManager.getPairedDevices()).toEqual([]);
    });

    it('should add paired device', () => {
      const device: PairedDevice = {
        ...mockDevice,
        pairedAt: Date.now(),
        confirmed: true,
      };

      pairingManager.addPairedDevice(device);
      const devices = pairingManager.getPairedDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0].id).toBe(mockDevice.id);
    });

    it('should not add duplicate devices', () => {
      const device: PairedDevice = {
        ...mockDevice,
        pairedAt: Date.now(),
        confirmed: true,
      };

      pairingManager.addPairedDevice(device);
      pairingManager.addPairedDevice(device);

      expect(pairingManager.getPairedDevices()).toHaveLength(1);
    });

    it('should remove paired device', () => {
      const device: PairedDevice = {
        ...mockDevice,
        pairedAt: Date.now(),
        confirmed: true,
      };

      pairingManager.addPairedDevice(device);
      expect(pairingManager.removePairedDevice(mockDevice.id)).toBe(true);
      expect(pairingManager.getPairedDevices()).toHaveLength(0);
    });

    it('should return false when removing non-existent device', () => {
      expect(pairingManager.removePairedDevice('non-existent')).toBe(false);
    });

    it('should check if device is paired', () => {
      const device: PairedDevice = {
        ...mockDevice,
        pairedAt: Date.now(),
        confirmed: true,
      };

      expect(pairingManager.isDevicePaired(mockDevice.id)).toBe(false);
      pairingManager.addPairedDevice(device);
      expect(pairingManager.isDevicePaired(mockDevice.id)).toBe(true);
    });

    it('should persist paired devices', () => {
      const device: PairedDevice = {
        ...mockDevice,
        pairedAt: Date.now(),
        confirmed: true,
      };

      pairingManager.addPairedDevice(device);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'pairedDevices',
        expect.any(String)
      );
    });

    it('should load paired devices from storage', () => {
      const storedDevices = JSON.stringify([
        {
          id: 'stored-device',
          name: 'Stored Device',
          ip: '192.168.1.200',
          port: 8080,
          type: 'mobile',
          pairedAt: Date.now(),
          confirmed: true,
        },
      ]);
      localStorageMock.getItem.mockReturnValue(storedDevices);

      pairingManager.loadPairedDevices();

      expect(pairingManager.isDevicePaired('stored-device')).toBe(true);
    });
  });

  // =========================================================================
  // 超时管理测试
  // =========================================================================

  describe('timeout management', () => {
    it('should return 0 when no active request', () => {
      expect(pairingManager.getRemainingTimeout()).toBe(0);
    });

    it('should return remaining timeout during pairing', async () => {
      const manager = new PairingManager({ timeoutMs: 10000 });
      await manager.startPairing(mockDevice);

      const remaining = manager.getRemainingTimeout();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(10000);
    });
  });

  // =========================================================================
  // 单例模式测试
  // =========================================================================

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const manager1 = getPairingManager();
      const manager2 = getPairingManager();

      expect(manager1).toBe(manager2);
    });

    it('should reset singleton correctly', () => {
      const manager1 = getPairingManager();
      resetPairingManager();
      const manager2 = getPairingManager();

      expect(manager1).not.toBe(manager2);
    });
  });

  // =========================================================================
  // 配对码验证测试
  // =========================================================================

  describe('code validation', () => {
    it('should validate matching code', async () => {
      const code = await pairingManager.startPairing(mockDevice);
      expect(pairingManager.validateCode(code)).toBe(true);
    });

    it('should reject non-matching code', async () => {
      await pairingManager.startPairing(mockDevice);
      expect(pairingManager.validateCode('WRONG')).toBe(false);
    });

    it('should be case insensitive for validation', async () => {
      const code = await pairingManager.startPairing(mockDevice);
      expect(pairingManager.validateCode(code.toLowerCase())).toBe(true);
    });
  });

  // =========================================================================
  // 状态转换测试
  // =========================================================================

  describe('state transitions', () => {
    it('should transition from idle to pairing', async () => {
      expect(pairingManager.getState()).toBe('idle');
      await pairingManager.startPairing(mockDevice);
      expect(pairingManager.getState()).toBe('pairing');
    });

    it('should emit pairing event when starting pairing', async () => {
      const pairingHandler = vi.fn();
      pairingManager.on('pairing', pairingHandler as any);

      await pairingManager.startPairing(mockDevice);

      expect(pairingHandler).toHaveBeenCalledTimes(1);
      expect(pairingHandler).toHaveBeenCalledWith({
        code: pairingManager.getPendingCode(),
        expiresIn: pairingManager.getConfig().timeoutMs,
      });
    });

    it('should emit confirming event when starting confirmation', async () => {
      const confirmingHandler = vi.fn();
      pairingManager.on('confirming', confirmingHandler as any);

      await pairingManager.startConfirming(mockDevice, 'ABC123');

      expect(confirmingHandler).toHaveBeenCalledTimes(1);
      expect(confirmingHandler).toHaveBeenCalledWith({
        device: mockDevice,
        code: 'ABC123',
      });
    });
  });
});

// =========================================================================
// 配对状态类型测试
// =========================================================================

describe('PairingState types', () => {
  it('should have all required states', () => {
    const states: PairingState[] = [
      'idle',
      'discovering',
      'generating',
      'pairing',
      'confirming',
      'paired',
      'error',
      'timeout',
      'cancelled',
    ];

    states.forEach(state => {
      expect(state).toBeDefined();
    });
  });

  it('should support all event map types', () => {
    // Verify event map structure
    const eventMap: PairingEventMap = {
      idle: null,
      discovering: { devices: [] },
      generating: null,
      pairing: { code: 'ABC123', expiresIn: 30000 },
      confirming: { device: mockDevice, code: 'ABC123' },
      paired: { device: mockDevice as PairedDevice },
      error: { reason: 'error' },
      timeout: { code: 'ABC123' },
      cancelled: { reason: 'cancelled' },
    };

    expect(eventMap.pairing.code).toBe('ABC123');
    expect(eventMap.confirming.code).toBe('ABC123');
  });
});
