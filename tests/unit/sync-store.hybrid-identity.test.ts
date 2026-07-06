import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('sync-store hybrid identity（混合式身份兼容门面）', () => {
  beforeEach(() => {
    Object.keys(mockLocalStorageData).forEach((key) => delete mockLocalStorageData[key]);
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('register creates local profile instead of relying only on legacy users（注册创建本地档案）', async () => {
    const syncModule = await import('@/ui/stores/sync-store');
    const profileModule = await import('@/lib/profile/profile-storage');

    await syncModule.useSyncStore.getState().register('newuser', 'password123');

    const profiles = profileModule.listLocalProfiles();
    expect(profiles.map((profile) => profile.slug)).toEqual(['default', 'newuser']);
  });

  it('login activates a profile and derives currentUser from active profile（登录激活档案）', async () => {
    const syncModule = await import('@/ui/stores/sync-store');
    const profileModule = await import('@/lib/profile/profile-storage');

    await syncModule.useSyncStore.getState().register('exomind', 'password123');
    await syncModule.useSyncStore.getState().login('exomind', 'password123');

    const state = syncModule.useSyncStore.getState();
    expect(state.isLoggedIn).toBe(true);
    expect(state.currentUser).toBe('exomind');
    expect(profileModule.getActiveProfile()?.slug).toBe('exomind');
  });

  it('connect fails when active profile has no linked remote identity（未绑定远端身份时禁止连接）', async () => {
    const syncModule = await import('@/ui/stores/sync-store');

    await syncModule.useSyncStore.getState().register('local-only', 'password123');
    await syncModule.useSyncStore.getState().login('local-only', 'password123');

    await expect(syncModule.useSyncStore.getState().connect('http://localhost:5984')).rejects.toThrow(
      '当前档案未连接远端同步身份'
    );
  });

  it('linking remote identity derives sync credentials from link secret（远端绑定后生成同步凭据）', async () => {
    const syncModule = await import('@/ui/stores/sync-store');

    await syncModule.useSyncStore.getState().register('remote-user', 'password123');
    await syncModule.useSyncStore.getState().login('remote-user', 'password123');

    const stateBefore = syncModule.useSyncStore.getState() as typeof syncModule.useSyncStore.getState extends () => infer T
      ? T & {
          linkRemoteIdentity?: (input: {
            providerId: string;
            remoteIdentityKey: string;
            displayName?: string;
            authType?: 'none' | 'basic' | 'token';
            authUsername?: string;
            authSecret?: string;
          }) => Promise<void>;
        }
      : never;

    await stateBefore.linkRemoteIdentity?.({
      providerId: 'self-hosted-sync',
      remoteIdentityKey: 'space-remote-user',
      displayName: 'Remote User Space',
      authType: 'basic',
      authUsername: 'remote-user-cloud',
      authSecret: 'remote-password',
    });

    const state = syncModule.useSyncStore.getState();
    expect(state.credentials?.remoteIdentityKey).toBe('space-remote-user');
    expect(state.credentials?.authUsername).toBe('remote-user-cloud');
    expect(state.credentials?.authSecret).toBe('remote-password');
  });
});
