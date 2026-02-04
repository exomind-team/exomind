/**
 * Pairing Service Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tauri store
const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  save: vi.fn(),
};

vi.mock('@tauri-apps/plugin/store', () => ({
  store: mockStore,
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => '550e8400-e29b-41d4-a716-446655440000'),
}));

// Mock user-id module
vi.mock('../../src/lib/user/user-id', () => ({
  getUserId: vi.fn(() => Promise.resolve('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')),
}));

// Import after mocking
import { PairingService, PairingErrorType } from '../../src/lib/pairing/pairing-service';

describe('PairingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear singleton
    (PairingService as any).instance = null;
    // Clear pairing lock
    mockStore.get.mockImplementation((key: string) => {
      if (key === 'pairing.lock') return Promise.resolve(null);
      if (key === 'pairing.session') return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    (PairingService as any).instance = null;
  });

  describe('startPairing', () => {
    it('should generate pairing code and session', async () => {
      const service = PairingService.getInstance();
      const result = await service.startPairing();

      expect(result).toHaveProperty('pairingId');
      expect(result).toHaveProperty('code');
      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.code.length).toBe(6);
    });

    it('should reject if pending pairing exists', async () => {
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'pairing.session') {
          return Promise.resolve({
            pairingId: 'existing',
            code: '123456',
            status: 'pending',
            expiresAt: Date.now() + 300000, // 5 minutes from now
          });
        }
        return Promise.resolve(null);
      });

      const service = PairingService.getInstance();

      await expect(service.startPairing()).rejects.toThrow('已有待确认的配对');
    });

    it('should reject if locked out', async () => {
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'pairing.lock') {
          return Promise.resolve({
            locked: true,
            unlockAt: Date.now() + 60000, // 1 minute from now
          });
        }
        return Promise.resolve(null);
      });

      const service = PairingService.getInstance();

      await expect(service.startPairing()).rejects.toThrow('尝试次数过多');
    });

    it('should save session to store', async () => {
      const service = PairingService.getInstance();
      await service.startPairing();

      expect(mockStore.set).toHaveBeenCalledWith(
        'pairing.session',
        expect.objectContaining({
          code: expect.any(String),
          status: 'pending',
        })
      );
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  describe('confirmPairing', () => {
    it('should confirm with correct code', async () => {
      const now = Date.now();
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'pairing.session') {
          return Promise.resolve({
            pairingId: '550e8400-e29b-41d4-a716-446655440000',
            code: '123456',
            initiatorId: 'peer-user-id',
            status: 'pending',
            expiresAt: now + 300000,
            attempts: 0,
          });
        }
        if (key === 'pairing.lock') return Promise.resolve(null);
        return Promise.resolve(null);
      });
      mockStore.delete.mockResolvedValue(undefined);
      mockStore.save.mockResolvedValue(undefined);

      const service = PairingService.getInstance();
      const result = await service.confirmPairing('123456');

      expect(result.pairedUserId).toBe('peer-user-id');
      expect(mockStore.delete).toHaveBeenCalledWith('pairing.session');
    });

    it('should reject with wrong code', async () => {
      const now = Date.now();
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'pairing.session') {
          return Promise.resolve({
            pairingId: '550e8400-e29b-41d4-a716-446655440000',
            code: '123456',
            initiatorId: 'peer-user-id',
            status: 'pending',
            expiresAt: now + 300000,
            attempts: 1,
          });
        }
        if (key === 'pairing.lock') return Promise.resolve(null);
        return Promise.resolve(null);
      });
      mockStore.set.mockResolvedValue(undefined);
      mockStore.save.mockResolvedValue(undefined);

      const service = PairingService.getInstance();

      await expect(service.confirmPairing('000000')).rejects.toThrow('配对码错误');
    });

    it('should reject expired code', async () => {
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'pairing.session') {
          return Promise.resolve({
            pairingId: '550e8400-e29b-41d4-a716-446655440000',
            code: '123456',
            initiatorId: 'peer-user-id',
            status: 'pending',
            expiresAt: Date.now() - 1000, // Already expired
          });
        }
        if (key === 'pairing.lock') return Promise.resolve(null);
        return Promise.resolve(null);
      });
      mockStore.delete.mockResolvedValue(undefined);

      const service = PairingService.getInstance();

      await expect(service.confirmPairing('123456')).rejects.toThrow('配对已过期');
    });

    it('should reject when already paired', async () => {
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'pairing.session') {
          return Promise.resolve({
            pairingId: '550e8400-e29b-41d4-a716-446655440000',
            code: '123456',
            initiatorId: 'peer-user-id',
            status: 'confirmed',
          });
        }
        if (key === 'pairing.lock') return Promise.resolve(null);
        return Promise.resolve(null);
      });

      const service = PairingService.getInstance();

      await expect(service.confirmPairing('123456')).rejects.toThrow('配对已完成');
    });

    it('should reject non-existent code', async () => {
      mockStore.get.mockResolvedValue(null);

      const service = PairingService.getInstance();

      await expect(service.confirmPairing('123456')).rejects.toThrow('配对码不存在');
    });

    it('should lock out after max attempts', async () => {
      const now = Date.now();
      mockStore.get.mockImplementation((key: string) => {
        if (key === 'pairing.session') {
          return Promise.resolve({
            pairingId: '550e8400-e29b-41d4-a716-446655440000',
            code: '123456',
            initiatorId: 'peer-user-id',
            status: 'pending',
            expiresAt: now + 300000,
            attempts: 2, // Already 2 attempts
          });
        }
        if (key === 'pairing.lock') return Promise.resolve(null);
        return Promise.resolve(null);
      });
      mockStore.set.mockResolvedValue(undefined);
      mockStore.save.mockResolvedValue(undefined);
      mockStore.delete.mockResolvedValue(undefined);

      const service = PairingService.getInstance();

      await expect(service.confirmPairing('000000')).rejects.toThrow('尝试次数过多');

      // Should set lock
      expect(mockStore.set).toHaveBeenCalledWith(
        'pairing.lock',
        expect.objectContaining({ locked: true })
      );
    });
  });

  describe('cancelPairing', () => {
    it('should clear pairing session', async () => {
      mockStore.delete.mockResolvedValue(undefined);

      const service = PairingService.getInstance();
      await service.cancelPairing();

      expect(mockStore.delete).toHaveBeenCalledWith('pairing.session');
    });
  });

  describe('getPairingStatus', () => {
    it('should return current session', async () => {
      const session = {
        pairingId: '550e8400-e29b-41d4-a716-446655440000',
        code: '123456',
        status: 'pending' as const,
        expiresAt: Date.now() + 300000,
      };
      mockStore.get.mockResolvedValue(session);

      const service = PairingService.getInstance();
      const status = await service.getPairingStatus();

      expect(status).toEqual(session);
    });

    it('should return null if no session', async () => {
      mockStore.get.mockResolvedValue(null);

      const service = PairingService.getInstance();
      const status = await service.getPairingStatus();

      expect(status).toBeNull();
    });
  });

  describe('hasPendingPairing', () => {
    it('should return true for pending session', async () => {
      mockStore.get.mockResolvedValue({
        pairingId: '550e8400-e29b-41d4-a716-446655440000',
        code: '123456',
        status: 'pending',
        expiresAt: Date.now() + 300000,
      });

      const service = PairingService.getInstance();
      const hasPending = await service.hasPendingPairing();

      expect(hasPending).toBe(true);
    });

    it('should return false for expired session', async () => {
      mockStore.get.mockResolvedValue({
        pairingId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'pending',
        expiresAt: Date.now() - 1000, // Expired
      });

      const service = PairingService.getInstance();
      const hasPending = await service.hasPendingPairing();

      expect(hasPending).toBe(false);
    });
  });
});

describe('Pairing Code Format', () => {
  it('should generate 6 digit code', () => {
    // Simulate the generation logic
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);
    const num = (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
    const code = (num % 1000000).toString().padStart(6, '0');

    expect(code).toHaveLength(6);
    expect(code).toMatch(/^\d{6}$/);
  });
});
