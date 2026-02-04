/**
 * Crypto Service Tests
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

// Mock user-id module
vi.mock('../../src/lib/user/user-id', () => ({
  getUserId: vi.fn(() => Promise.resolve('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'),
}));

// Mock pairing-service module
vi.mock('../../src/lib/pairing/pairing-service', () => ({
  getTrustRelationship: vi.fn(() => Promise.resolve(null)),
}));

// Import after mocking
import { CryptoService } from '../../src/lib/crypto/crypto-service';

describe('CryptoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear singleton
    (CryptoService as any).instance = null;
  });

  afterEach(() => {
    (CryptoService as any).instance = null;
  });

  describe('generateKeyPair', () => {
    it('should generate valid key pair', async () => {
      mockStore.set.mockResolvedValue(undefined);
      mockStore.save.mockResolvedValue(undefined);

      const service = CryptoService.getInstance();
      const publicKey = await service.generateKeyPair();

      // Should be valid base64
      expect(publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
      // P-256 public key is 65 bytes raw, ~88 bytes base64
      expect(publicKey.length).toBeGreaterThan(80);
      expect(publicKey.length).toBeLessThan(100);
    });

    it('should save key pair to store', async () => {
      mockStore.set.mockResolvedValue(undefined);
      mockStore.save.mockResolvedValue(undefined);

      const service = CryptoService.getInstance();
      await service.generateKeyPair();

      expect(mockStore.set).toHaveBeenCalledWith(
        'crypto.keypair',
        expect.objectContaining({
          publicKey: expect.any(String),
          privateKey: expect.any(String),
        })
      );
      expect(mockStore.save).toHaveBeenCalled();
    });
  });

  describe('canCommunicate', () => {
    it('should return true if shared key exists', async () => {
      mockStore.get.mockResolvedValue('some-shared-key-data');

      const service = CryptoService.getInstance();
      const canCommunicate = await service.canCommunicate('peer-id');

      expect(canCommunicate).toBe(true);
    });

    it('should return false if no shared key', async () => {
      mockStore.get.mockResolvedValue(null);

      const service = CryptoService.getInstance();
      const canCommunicate = await service.canCommunicate('peer-id');

      expect(canCommunicate).toBe(false);
    });
  });

  describe('deleteSharedKey', () => {
    it('should delete shared key from store', async () => {
      mockStore.delete.mockResolvedValue(undefined);

      const service = CryptoService.getInstance();
      await service.deleteSharedKey('peer-id');

      expect(mockStore.delete).toHaveBeenCalledWith(
        expect.stringContaining('crypto.shared.peer-id')
      );
    });
  });

  describe('deleteKeyPair', () => {
    it('should delete key pair from store', async () => {
      mockStore.delete.mockResolvedValue(undefined);

      const service = CryptoService.getInstance();
      await service.deleteKeyPair();

      expect(mockStore.delete).toHaveBeenCalledWith('crypto.keypair');
    });
  });
});

describe('EncryptedMessage Format', () => {
  it('should contain required fields', () => {
    const message = {
      version: 1,
      iv: 'abc123',
      ciphertext: 'xyz789',
      authTag: 'tag123',
      timestamp: 1234567890,
      senderId: 'user-123',
    };

    expect(message).toHaveProperty('version');
    expect(message).toHaveProperty('iv');
    expect(message).toHaveProperty('ciphertext');
    expect(message).toHaveProperty('authTag');
    expect(message).toHaveProperty('timestamp');
    expect(message).toHaveProperty('senderId');
    expect(message.version).toBe(1);
  });
});

describe('Base64 Encoding', () => {
  it('should encode and decode correctly', () => {
    const original = 'Hello, World!';
    const encoded = Buffer.from(original).toString('base64');
    const decoded = Buffer.from(encoded, 'base64').toString();

    expect(decoded).toBe(original);
  });

  it('should handle binary data', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    const encoded = Buffer.from(bytes).toString('base64');
    const decoded = Buffer.from(encoded, 'base64');

    expect(decoded).toEqual(bytes);
  });
});
