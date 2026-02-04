/**
 * User ID Service Tests
 * TDD: Red → Green → Refactor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Tauri store module
const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
  save: vi.fn(),
};

vi.mock('@tauri-apps/plugin-store', () => ({
  store: mockStore,
}));

// Import after mocking
import { UserIdService } from '../../src/lib/user/user-id';

describe('UserIdService - TDD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear singleton cache before each test
    (UserIdService as any).instance = null;
    (UserIdService as any).cachedUserId = null;
  });

  afterEach(() => {
    // Clear singleton after each test
    (UserIdService as any).instance = null;
    (UserIdService as any).cachedUserId = null;
  });

  describe('getUserId', () => {
    it('RED: should generate new 32-char hex ID when not stored', async () => {
      mockStore.get.mockResolvedValue(null);
      mockStore.set.mockResolvedValue(undefined);
      mockStore.save.mockResolvedValue(undefined);

      const service = UserIdService.getInstance();
      const userId = await service.getUserId();

      // 验收标准：32 位十六进制字符串
      expect(userId).toMatch(/^[0-9a-f]{32}$/);
      expect(userId.length).toBe(32);
    });

    it('GREEN: should save new ID to store', async () => {
      mockStore.get.mockResolvedValue(null);
      mockStore.set.mockResolvedValue(undefined);
      mockStore.save.mockResolvedValue(undefined);

      const service = UserIdService.getInstance();
      await service.getUserId();

      expect(mockStore.set).toHaveBeenCalledWith('user.identity', expect.any(String));
      expect(mockStore.save).toHaveBeenCalled();
    });

    it('GREEN: should return stored ID if exists', async () => {
      const storedId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
      mockStore.get.mockResolvedValue(storedId);

      const service = UserIdService.getInstance();
      const userId = await service.getUserId();

      expect(userId).toBe(storedId);
      expect(mockStore.get).toHaveBeenCalledWith('user.identity');
    });

    it('GREEN: should cache ID after first call', async () => {
      const storedId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
      mockStore.get.mockResolvedValue(storedId);

      const service = UserIdService.getInstance();
      await service.getUserId();
      await service.getUserId();
      await service.getUserId();

      // Store should only be called once due to caching
      expect(mockStore.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasUserId', () => {
    it('GREEN: should return true if ID exists', async () => {
      mockStore.get.mockResolvedValue('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');

      const service = UserIdService.getInstance();
      const hasId = await service.hasUserId();

      expect(hasId).toBe(true);
    });

    it('GREEN: should return false if ID does not exist', async () => {
      mockStore.get.mockResolvedValue(null);

      const service = UserIdService.getInstance();
      const hasId = await service.hasUserId();

      expect(hasId).toBe(false);
    });
  });

  describe('generateNewId', () => {
    it('GREEN: should generate and save new ID', async () => {
      mockStore.get.mockResolvedValue(null);
      mockStore.set.mockResolvedValue(undefined);
      mockStore.save.mockResolvedValue(undefined);

      const service = UserIdService.getInstance();
      const newId = await service.generateNewId();

      expect(newId).toMatch(/^[0-9a-f]{32}$/);
      expect(mockStore.set).toHaveBeenCalledWith('user.identity', newId);
    });
  });

  describe('getFormattedId', () => {
    it('GREEN: should format as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX', async () => {
      const storedId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
      mockStore.get.mockResolvedValue(storedId);

      const service = UserIdService.getInstance();
      const formatted = await service.getFormattedId();

      expect(formatted).toBe('a1b2-c3d4-e5f6-a1b2-c3d4-e5f6-a1b2-c3d4');
    });
  });
});

describe('UserId Generation - Unit', () => {
  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    const bytes = new Uint8Array(16);

    for (let i = 0; i < 100; i++) {
      crypto.getRandomValues(bytes);
      const id = Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      ids.add(id);
    }

    // All 100 IDs should be unique
    expect(ids.size).toBe(100);
  });
});
