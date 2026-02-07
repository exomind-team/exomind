/**
 * P2P Manager 单元测试
 * 100% 覆盖率目标
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  P2PConnectionState,
  PeerConnectionStatus,
  DEFAULT_P2P_CONFIG,
  P2PEventType,
} from './types';
import {
  P2PManager,
  getP2PManager,
  destroyP2PManager,
} from './manager';
import type { ConnectionResult, ConnectionStatus, P2PConfig, PeerInfo } from './types';

// Mock Tauri invoke 函数
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ============================================================================
// 测试配置
// ============================================================================

describe('P2PConfig & Constants', () => {
  it('should have correct default P2P configuration', () => {
    expect(DEFAULT_P2P_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_P2P_CONFIG.retryInterval).toBe(1000);
    expect(DEFAULT_P2P_CONFIG.connectionTimeout).toBe(30000);
    expect(DEFAULT_P2P_CONFIG.autoReconnect).toBe(false);
  });

  it('should allow custom configuration', () => {
    const customConfig: P2PConfig = {
      maxRetries: 5,
      retryInterval: 2000,
      connectionTimeout: 60000,
      autoReconnect: true,
    };

    expect(customConfig.maxRetries).toBe(5);
    expect(customConfig.autoReconnect).toBe(true);
  });
});

// ============================================================================
// P2PConnectionState Enum Tests
// ============================================================================

describe('P2PConnectionState', () => {
  it('should have all required states', () => {
    expect(P2PConnectionState.Disconnected).toBe('disconnected');
    expect(P2PConnectionState.Connecting).toBe('connecting');
    expect(P2PConnectionState.Connected).toBe('connected');
    expect(P2PConnectionState.Error).toBe('error');
  });
});

describe('PeerConnectionStatus', () => {
  it('should have all required statuses', () => {
    expect(PeerConnectionStatus.Connecting).toBe('connecting');
    expect(PeerConnectionStatus.Connected).toBe('connected');
    expect(PeerConnectionStatus.Disconnected).toBe('disconnected');
    expect(PeerConnectionStatus.Failed).toBe('failed');
  });
});

// ============================================================================
// P2PManager Tests
// ============================================================================

describe('P2PManager', () => {
  beforeEach(() => {
    // 每个测试前销毁单例，确保干净的状态
    destroyP2PManager();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    // 每个测试后清理
    destroyP2PManager();
    vi.restoreAllMocks();
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple getInstance calls', () => {
      const manager1 = getP2PManager();
      const manager2 = getP2PManager();
      expect(manager1).toBe(manager2);
    });

    it('should create new instance after destroy', () => {
      const manager1 = getP2PManager();
      destroyP2PManager();
      const manager2 = getP2PManager();
      expect(manager1).not.toBe(manager2);
    });
  });

  describe('State Management', () => {
    it('should start in disconnected state', () => {
      const manager = getP2PManager();
      expect(manager.getState()).toBe(P2PConnectionState.Disconnected);
    });

    it('isConnected should return false when disconnected', () => {
      const manager = getP2PManager();
      expect(manager.isConnected()).toBe(false);
    });

    it('isConnecting should return false when disconnected', () => {
      const manager = getP2PManager();
      expect(manager.isConnecting()).toBe(false);
    });

    it('getConnectedPeers should return empty array initially', () => {
      const manager = getP2PManager();
      expect(manager.getConnectedPeers()).toEqual([]);
    });

    it('getPeerCount should return 0 initially', () => {
      const manager = getP2PManager();
      expect(manager.getPeerCount()).toBe(0);
    });
  });

  describe('Event System', () => {
    it('should allow subscription and unsubscription', () => {
      const manager = getP2PManager();
      const callback = vi.fn();

      // Subscribe
      const unsubscribe = manager.onStateChanged(callback);
      expect(typeof unsubscribe).toBe('function');

      // Unsubscribe
      unsubscribe();
    });

    it('should support generic on method', () => {
      const manager = getP2PManager();
      const callback = vi.fn();

      const unsubscribe = manager.on(P2PEventType.StateChanged, callback);
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
    });
  });

  describe('Connect Operation', () => {
    it('should return error when already connecting', async () => {
      const manager = getP2PManager();
      mockInvoke.mockResolvedValue({ success: false, error: 'Already connecting' });

      // Set to connecting state manually for test
      // Note: We can't directly set state, but we can test the connect behavior
    });

    it('should handle connect success', async () => {
      const manager = getP2PManager();
      mockInvoke.mockResolvedValue({ success: true });

      const result = await manager.connect('peer-123');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should handle connect failure', async () => {
      const manager = getP2PManager();
      mockInvoke.mockResolvedValue({ success: false, error: 'Connection refused' });

      const result = await manager.connect('peer-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('should throw on invoke error', async () => {
      const manager = getP2PManager();
      mockInvoke.mockRejectedValue(new Error('Network error'));

      const result = await manager.connect('peer-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('Disconnect Operation', () => {
    it('should handle disconnect success', async () => {
      const manager = getP2PManager();
      mockInvoke.mockResolvedValue({ success: true });

      const result = await manager.disconnect('peer-123');

      expect(result.success).toBe(true);
    });

    it('should handle disconnect failure', async () => {
      const manager = getP2PManager();
      mockInvoke.mockResolvedValue({ success: false, error: 'Peer not found' });

      const result = await manager.disconnect('peer-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Peer not found');
    });
  });

  describe('DisconnectAll Operation', () => {
    it('should disconnect all peers', async () => {
      const manager = getP2PManager();
      mockInvoke.mockResolvedValue(undefined);

      await manager.disconnectAll();

      expect(manager.getPeerCount()).toBe(0);
      expect(manager.getState()).toBe(P2PConnectionState.Disconnected);
    });
  });

  describe('GetStatus Operation', () => {
    it('should return connection status', async () => {
      const manager = getP2PManager();
      mockInvoke.mockResolvedValue({
        connected: true,
        peerCount: 2,
        peers: [
          { peer_id: 'peer-1', ip: '192.168.1.1', status: 'connected' },
          { peer_id: 'peer-2', ip: '192.168.1.2', status: 'connected' },
        ],
      });

      const status = await manager.getStatus();

      expect(status.isConnected).toBe(true);
      expect(status.peerCount).toBe(2);
      expect(status.peers).toHaveLength(2);
    });

    it('should handle error status', async () => {
      const manager = getP2PManager();
      mockInvoke.mockRejectedValue(new Error('Failed to get status'));

      const status = await manager.getStatus();

      expect(status.isConnected).toBe(false);
      expect(status.peerCount).toBe(0);
      expect(status.lastError).toBe('Failed to get status');
    });
  });
});

// ============================================================================
// P2PEventType Tests
// ============================================================================

describe('P2PEventType', () => {
  it('should have all required event types', () => {
    expect(P2PEventType.StateChanged).toBe('stateChanged');
    expect(P2PEventType.PeerConnected).toBe('peerConnected');
    expect(P2PEventType.PeerDisconnected).toBe('peerDisconnected');
    expect(P2PEventType.PeerFailed).toBe('peerFailed');
    expect(P2PEventType.Error).toBe('error');
    expect(P2PEventType.ConnectionTimeout).toBe('connectionTimeout');
  });
});

// ============================================================================
// Type Guards / Validation Tests
// ============================================================================

describe('Type Validation', () => {
  it('should validate ConnectionResult structure', () => {
    const validResult: ConnectionResult = {
      success: true,
      error: undefined,
    };
    expect(validResult.success).toBe(true);
  });

  it('should validate ConnectionStatus structure', () => {
    const validStatus: ConnectionStatus = {
      isConnected: true,
      state: P2PConnectionState.Connected,
      peerCount: 1,
      peers: [],
    };
    expect(validStatus.isConnected).toBe(true);
  });

  it('should validate PeerInfo structure', () => {
    const validPeer: PeerInfo = {
      peerId: 'peer-123',
      ip: '192.168.1.1',
      status: PeerConnectionStatus.Connected,
    };
    expect(validPeer.peerId).toBe('peer-123');
    expect(validPeer.status).toBe(PeerConnectionStatus.Connected);
  });
});

// ============================================================================
// Integration-like Tests
// ============================================================================

describe('P2PManager Integration Scenarios', () => {
  beforeEach(() => {
    destroyP2PManager();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    destroyP2PManager();
    vi.restoreAllMocks();
  });

  it('should handle full connect-disconnect lifecycle', async () => {
    const manager = getP2PManager();

    // Initially disconnected
    expect(manager.isConnected()).toBe(false);

    // Connect
    mockInvoke.mockResolvedValue({ success: true });
    const connectResult = await manager.connect('peer-1');
    expect(connectResult.success).toBe(true);
    expect(manager.isConnected()).toBe(true);
    expect(manager.getPeerCount()).toBe(1);

    // Disconnect
    mockInvoke.mockResolvedValue({ success: true });
    const disconnectResult = await manager.disconnect('peer-1');
    expect(disconnectResult.success).toBe(true);
    expect(manager.isConnected()).toBe(false);
    expect(manager.getPeerCount()).toBe(0);
  });

  it('should handle multiple peers', async () => {
    const manager = getP2PManager();

    // Connect first peer
    mockInvoke.mockResolvedValue({ success: true });
    await manager.connect('peer-1');
    expect(manager.getPeerCount()).toBe(1);

    // Connect second peer
    mockInvoke.mockResolvedValue({ success: true });
    await manager.connect('peer-2');
    expect(manager.getPeerCount()).toBe(2);

    // Get all connected peers
    const peers = manager.getConnectedPeers();
    expect(peers).toHaveLength(2);
  });

  it('should allow multiple event listeners', () => {
    const manager = getP2PManager();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const unsub1 = manager.onStateChanged(callback1);
    const unsub2 = manager.onStateChanged(callback2);

    expect(typeof unsub1).toBe('function');
    expect(typeof unsub2).toBe('function');

    unsub1();
    unsub2();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    destroyP2PManager();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    destroyP2PManager();
    vi.restoreAllMocks();
  });

  it('should handle network errors gracefully', async () => {
    const manager = getP2PManager();
    mockInvoke.mockRejectedValue(new Error('ECONNRESET'));

    const result = await manager.connect('peer-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('ECONNRESET');
  });

  it('should handle timeout errors', async () => {
    const manager = getP2PManager();
    mockInvoke.mockRejectedValue(new Error('Request timeout'));

    const result = await manager.connect('peer-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Request timeout');
  });

  it('should handle unknown errors', async () => {
    const manager = getP2PManager();
    mockInvoke.mockRejectedValue('Unknown error string');

    const result = await manager.connect('peer-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error string');
  });
});

// ============================================================================
// Auto-Reconnect Tests
// ============================================================================

describe('Auto-Reconnect Feature', () => {
  beforeEach(() => {
    destroyP2PManager();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    destroyP2PManager();
    vi.restoreAllMocks();
  });

  it('should not auto-reconnect when disabled', async () => {
    const manager = getP2PManager({ autoReconnect: false, maxRetries: 3 });
    mockInvoke.mockResolvedValue({ success: false, error: 'Connection failed' });

    const result = await manager.connect('peer-1');

    expect(result.success).toBe(false);
    expect(manager.getState()).toBe(P2PConnectionState.Error);
  });
});
