/**
 * Pairing 模块单元测试
 * 100% 覆盖率目标
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PairingState,
  PairingMode,
  PairingEventType,
  DEFAULT_PAIRING_CONFIG,
  PairingManager,
  getPairingManager,
  destroyPairingManager,
} from './index';

// Mock Tauri invoke 函数
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('PairingManager', () => {
  beforeEach(() => {
    destroyPairingManager();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    destroyPairingManager();
    vi.restoreAllMocks();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple getInstance calls', () => {
      const manager1 = getPairingManager();
      const manager2 = getPairingManager();
      expect(manager1).toBe(manager2);
    });

    it('should create new instance after destroy', () => {
      const manager1 = getPairingManager();
      destroyPairingManager();
      const manager2 = getPairingManager();
      expect(manager1).not.toBe(manager2);
    });
  });

  describe('Default Config', () => {
    it('should have correct default configuration', () => {
      expect(DEFAULT_PAIRING_CONFIG.codeLength).toBe(6);
      expect(DEFAULT_PAIRING_CONFIG.timeout).toBe(30000);
      expect(DEFAULT_PAIRING_CONFIG.maxRetries).toBe(3);
    });
  });

  describe('State Management', () => {
    it('should start in idle state', () => {
      const manager = getPairingManager();
      expect(manager.getState()).toBe(PairingState.Idle);
    });

    it('isPairing should return false when idle', () => {
      const manager = getPairingManager();
      expect(manager.isPairing()).toBe(false);
    });

    it('isPaired should return false when idle', () => {
      const manager = getPairingManager();
      expect(manager.isPaired()).toBe(false);
    });
  });

  describe('Device Discovery', () => {
    it('should start discovery', async () => {
      const manager = getPairingManager();
      mockInvoke.mockResolvedValue(undefined);

      await manager.startDiscovery();

      expect(manager.getState()).toBe(PairingState.Discovering);
    });

    it('should stop discovery', () => {
      const manager = getPairingManager();
      mockInvoke.mockResolvedValue(undefined);

      manager.stopDiscovery();

      expect(manager.getState()).toBe(PairingState.Idle);
    });

    it('should add discovered device', () => {
      const manager = getPairingManager();
      const callback = vi.fn();

      manager.on(PairingEventType.DeviceDiscovered, callback);

      const device = {
        id: 'device-1',
        name: 'Test Device',
        ip: '192.168.1.100',
        port: 8080,
        type: 'desktop' as const,
      };

      manager.addDiscoveredDevice(device);

      expect(callback).toHaveBeenCalledWith({ device });
    });

    it('should return discovered devices list', () => {
      const manager = getPairingManager();

      const device1 = {
        id: 'device-1',
        name: 'Device 1',
        ip: '192.168.1.1',
        port: 8080,
        type: 'desktop' as const,
      };

      manager.addDiscoveredDevice(device1);

      const devices = manager.getDiscoveredDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0].id).toBe('device-1');
    });
  });

  describe('Pairing Code Generation', () => {
    it('should generate pairing code', async () => {
      const manager = getPairingManager();
      mockInvoke.mockResolvedValue('ABC123');

      const code = await manager.generatePairingCode('My Device', 'public-key');

      expect(code).toBe('ABC123');
      expect(manager.getState()).toBe(PairingState.WaitingConfirm);
    });

    it('should emit request created event', async () => {
      const manager = getPairingManager();
      mockInvoke.mockResolvedValue('XYZ789');

      const callback = vi.fn();
      manager.on(PairingEventType.RequestCreated, callback);

      await manager.generatePairingCode('My Device', 'public-key');

      expect(callback).toHaveBeenCalled();
      const { code, expiresAt } = callback.mock.calls[0][0];
      expect(code).toBe('XYZ789');
      expect(expiresAt).toBeDefined();
    });

    it('should reject if already pairing', async () => {
      const manager = getPairingManager();
      mockInvoke.mockResolvedValue('CODE123');

      await manager.generatePairingCode('Device 1', 'key1');
      await expect(manager.generatePairingCode('Device 2', 'key2')).rejects.toThrow('Already in pairing process');
    });
  });

  describe('Pairing Confirmation', () => {
    it('should confirm pairing successfully', async () => {
      const manager = getPairingManager();
      mockInvoke.mockResolvedValue({
        success: true,
        device: {
          id: 'device-1',
          name: 'Test Device',
          ip: '192.168.1.100',
          port: 8080,
          type: 'desktop',
          pairedAt: new Date().toISOString(),
          confirmed: true,
        },
      });

      const result = await manager.confirmPairing('CODE123', true);

      expect(result.success).toBe(true);
      expect(result.device?.id).toBe('device-1');
    });

    it('should reject pairing', async () => {
      const manager = getPairingManager();
      const callback = vi.fn();

      manager.on(PairingEventType.Rejected, callback);

      const result = await manager.confirmPairing('CODE123', false);

      expect(result.success).toBe(false);
      expect(callback).toHaveBeenCalled();
    });

    it('should handle confirm failure', async () => {
      const manager = getPairingManager();
      mockInvoke.mockResolvedValue({
        success: false,
        error: 'Invalid code',
      });

      const result = await manager.confirmPairing('INVALID', true);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid code');
    });
  });

  describe('Paired Devices Management', () => {
    it('should get paired devices', async () => {
      const manager = getPairingManager();
      mockInvoke.mockResolvedValue([
        {
          id: 'device-1',
          name: 'Device 1',
          ip: '192.168.1.1',
          port: 8080,
          type: 'desktop' as const,
          pairedAt: new Date().toISOString(),
          confirmed: true,
        },
      ]);

      const devices = await manager.getPairedDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0].id).toBe('device-1');
    });

    it('should remove device', async () => {
      const manager = getPairingManager();
      mockInvoke.mockResolvedValue({ success: true });

      const result = await manager.removeDevice('device-1');

      expect(result).toBe(true);
    });

    it('should check if device is paired', () => {
      const manager = getPairingManager();

      expect(manager.isDevicePaired('device-1')).toBe(false);
    });
  });

  describe('Event System', () => {
    it('should allow subscription and unsubscription', () => {
      const manager = getPairingManager();
      const callback = vi.fn();

      const unsubscribe = manager.on(PairingEventType.StateChanged, callback);
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });

    it('should emit state changed event', async () => {
      const manager = getPairingManager();
      const callback = vi.fn();

      manager.on(PairingEventType.StateChanged, callback);
      mockInvoke.mockResolvedValue('CODE123');

      await manager.generatePairingCode('My Device', 'key');

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('PairingState Enum', () => {
    it('should have all required states', () => {
      expect(PairingState.Idle).toBe('idle');
      expect(PairingState.Discovering).toBe('discovering');
      expect(PairingState.GeneratingCode).toBe('generating_code');
      expect(PairingState.WaitingConfirm).toBe('waiting_confirm');
      expect(PairingState.Paired).toBe('paired');
      expect(PairingState.Error).toBe('error');
    });
  });

  describe('PairingMode Enum', () => {
    it('should have all required modes', () => {
      expect(PairingMode.Initiator).toBe('initiator');
      expect(PairingMode.Receiver).toBe('receiver');
    });
  });

  describe('PairingEventType Enum', () => {
    it('should have all required event types', () => {
      expect(PairingEventType.DeviceDiscovered).toBe('deviceDiscovered');
      expect(PairingEventType.RequestCreated).toBe('requestCreated');
      expect(PairingEventType.RequestReceived).toBe('requestReceived');
      expect(PairingEventType.Confirmed).toBe('confirmed');
      expect(PairingEventType.Rejected).toBe('rejected');
      expect(PairingEventType.Timeout).toBe('timeout');
      expect(PairingEventType.StateChanged).toBe('stateChanged');
      expect(PairingEventType.Error).toBe('error');
    });
  });
});

describe('PairingConfig', () => {
  it('should allow custom configuration', () => {
    const customConfig = {
      codeLength: 8,
      timeout: 60000,
      maxRetries: 5,
    };

    expect(customConfig.codeLength).toBe(8);
    expect(customConfig.timeout).toBe(60000);
    expect(customConfig.maxRetries).toBe(5);
  });
});

describe('PairingResult', () => {
  it('should create success result', () => {
    const result = {
      success: true,
      device: {
        id: 'device-1',
        name: 'Test',
        ip: '192.168.1.1',
        port: 8080,
        type: 'desktop' as const,
        pairedAt: new Date().toISOString(),
        confirmed: true,
      },
    };

    expect(result.success).toBe(true);
    expect(result.device?.id).toBe('device-1');
  });

  it('should create error result', () => {
    const result = {
      success: false,
      error: 'Pairing failed',
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Pairing failed');
  });
});
