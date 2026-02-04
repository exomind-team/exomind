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
    it('should invoke get_devices command', async () => {
      const { getDevices } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue([
        { id: '1', name: 'Test Device', status: 'online' }
      ]);

      const result = await getDevices();

      expect(mockInvoke).toHaveBeenCalledWith('get_devices');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Device');
    });

    it('should invoke remove_device command', async () => {
      const { removeDevice } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue({ success: true });

      const result = await removeDevice('device-123');

      expect(mockInvoke).toHaveBeenCalledWith('remove_device', { id: 'device-123' });
      expect(result.success).toBe(true);
    });
  });

  describe('Pairing', () => {
    it('should invoke generate_pairing_code command', async () => {
      const { generatePairingCode } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue('ABC123');

      const result = await generatePairingCode();

      expect(mockInvoke).toHaveBeenCalledWith('generate_pairing_code');
      expect(result).toBe('ABC123');
    });

    it('should invoke confirm_pairing command', async () => {
      const { confirmPairing } = await import('@/lib/p2p');

      mockInvoke.mockResolvedValue({ success: true, device: { id: '1', name: 'New Device' } });

      const result = await confirmPairing('ABC123');

      expect(mockInvoke).toHaveBeenCalledWith('confirm_pairing', { code: 'ABC123' });
      expect(result.success).toBe(true);
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

      mockInvoke.mockResolvedValue({ connected: true, peerCount: 3 });

      const result = await getConnectionStatus();

      expect(mockInvoke).toHaveBeenCalledWith('get_connection_status');
      expect(result.connected).toBe(true);
      expect(result.peerCount).toBe(3);
    });
  });
});
