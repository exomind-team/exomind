import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tauri IPC calls
const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

describe('P2P IPC Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Device Management', () => {
    it('should invoke get_paired_devices command', async () => {
      const { getDevices } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue([
        { id: '1', name: 'Test Device', status: 'online' }
      ]);

      const result = await getDevices();

      expect(mockInvoke).toHaveBeenCalledWith('get_paired_devices');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Device');
    });

    it('should invoke remove_paired_device command', async () => {
      const { removeDevice } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue({ success: true });

      const result = await removeDevice('device-123');

      expect(mockInvoke).toHaveBeenCalledWith('remove_paired_device', { device_id: 'device-123' });
      expect(result.success).toBe(true);
    });
  });

  describe('Pairing', () => {
    it('should invoke generate_pairing_code command', async () => {
      const { generatePairingCode } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue('ABC123');
      mockInvoke.mockResolvedValueOnce('192.168.1.100');

      const result = await generatePairingCode('My Device', 'public-key-xyz');

      expect(mockInvoke).toHaveBeenCalledWith('get_local_ip_with_random_port');
      expect(mockInvoke).toHaveBeenCalledWith('generate_pairing_code', {
        deviceName: 'My Device',
        deviceIp: '192.168.1.100',
        publicKey: 'public-key-xyz',
      });
      expect(result).toBe('ABC123');
    });

    it('should invoke confirm_pairing command', async () => {
      const { confirmPairing } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue({ success: true, device: { id: '1', name: 'New Device' } });

      const result = await confirmPairing('ABC123', true);

      expect(mockInvoke).toHaveBeenCalledWith('confirm_pairing', { code: 'ABC123', accept: true });
      expect(result.success).toBe(true);
    });

    it('should invoke confirm_pairing with reject option', async () => {
      const { confirmPairing } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue({ success: false });

      const result = await confirmPairing('ABC123', false);

      expect(mockInvoke).toHaveBeenCalledWith('confirm_pairing', { code: 'ABC123', accept: false });
      expect(result.success).toBe(false);
    });
  });

  describe('Connection', () => {
    it('should invoke connect_to_peer command', async () => {
      const { connectToPeer } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue({ success: true });

      const result = await connectToPeer('peer-id-123');

      expect(mockInvoke).toHaveBeenCalledWith('connect_to_peer', { peerId: 'peer-id-123' });
      expect(result.success).toBe(true);
    });

    it('should invoke disconnect_from_peer command', async () => {
      const { disconnectFromPeer } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue({ success: true });

      const result = await disconnectFromPeer('peer-id-123');

      expect(mockInvoke).toHaveBeenCalledWith('disconnect_from_peer', { peerId: 'peer-id-123' });
      expect(result.success).toBe(true);
    });
  });

  describe('Connection Status', () => {
    it('should invoke get_connection_status command', async () => {
      const { getConnectionStatus } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue({
        is_connected: true,
        state: 'connected',
        peer_count: 3,
        peers: [
          { peer_id: 'p1', ip: '192.168.1.1', status: 'connected' },
          { peer_id: 'p2', ip: '192.168.1.2', status: 'connected' },
          { peer_id: 'p3', ip: '192.168.1.3', status: 'connected' },
        ]
      });

      const result = await getConnectionStatus();

      expect(mockInvoke).toHaveBeenCalledWith('get_connection_status');
      expect(result.connected).toBe(true);
      expect(result.peerCount).toBe(3);
    });

    it('should return disconnected when not connected', async () => {
      const { getConnectionStatus } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue({
        is_connected: false,
        state: 'disconnected',
        peer_count: 0,
        peers: []
      });

      const result = await getConnectionStatus();

      expect(result.connected).toBe(false);
      expect(result.peerCount).toBe(0);
    });
  });
});
