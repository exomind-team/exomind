import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLocalStorageData: Record<string, string> = {};

const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockLocalStorageData[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorageData[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorageData[key];
  }),
  clear: vi.fn(() => {
    Object.keys(mockLocalStorageData).forEach((key) => delete mockLocalStorageData[key]);
  }),
  key: vi.fn((index: number) => Object.keys(mockLocalStorageData)[index] ?? null),
  get length() {
    return Object.keys(mockLocalStorageData).length;
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

describe('profile-storage（本地档案存储）', () => {
  beforeEach(() => {
    Object.keys(mockLocalStorageData).forEach((key) => delete mockLocalStorageData[key]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('migrates legacy users and active sync state into profiles（迁移旧 users 与激活用户）', async () => {
    mockLocalStorageData['exomind:users'] = JSON.stringify([
      {
        username: 'alice',
        passwordHash: 'hash-alice',
        createdAt: '2026-03-01T10:00:00.000Z',
      },
      {
        username: 'bob',
        passwordHash: 'hash-bob',
        createdAt: '2026-03-02T10:00:00.000Z',
        lastLogin: '2026-03-03T10:00:00.000Z',
      },
    ]);
    mockLocalStorageData['exomind:sync-store'] = JSON.stringify({
      state: {
        isLoggedIn: true,
        currentUser: 'bob',
      },
      version: 0,
    });

    const module = await import('@/lib/profile/profile-storage');

    module.migrateLegacyProfileStorage();

    const profiles = module.listLocalProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles.map((item) => item.slug)).toEqual(['alice', 'bob']);
    expect(module.getActiveProfileId()).toBeTruthy();

    const activeProfile = module.getActiveProfile();
    expect(activeProfile?.slug).toBe('bob');

    const bobProfile = module.findProfileByLoginName('bob');
    expect(bobProfile?.displayName).toBe('bob');

    const bobSecret = module.getProfileSecret(bobProfile!.profileId);
    expect(bobSecret?.localPasswordHash).toBe('hash-bob');
  });

  it('creates local profile and persists meta + secret separately（创建档案并分别保存元数据和机密）', async () => {
    const module = await import('@/lib/profile/profile-storage');

    const profile = module.createLocalProfile({
      slug: 'hailay',
      displayName: 'Hailay',
      localPasswordHash: 'pbkdf2-hash',
    });

    expect(profile.profileId).toBeTruthy();
    expect(module.listLocalProfiles()).toHaveLength(1);

    const storedProfile = module.getLocalProfile(profile.profileId);
    expect(storedProfile?.slug).toBe('hailay');
    expect(storedProfile?.displayName).toBe('Hailay');

    const secret = module.getProfileSecret(profile.profileId);
    expect(secret?.localPasswordHash).toBe('pbkdf2-hash');
  });

  it('falls back to legacy currentUser when session not migrated（未迁移时回退旧 currentUser）', async () => {
    mockLocalStorageData['exomind:sync-store'] = JSON.stringify({
      state: {
        currentUser: 'legacy-user',
      },
      version: 0,
    });

    const module = await import('@/lib/profile/profile-storage');
    expect(module.getCurrentProfileOrLegacyId()).toBe('legacy-user');
  });
});
