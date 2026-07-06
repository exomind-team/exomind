/**
 * Sync Store 单元测试
 *
 * 测试用例：
 * - 初始状态
 * - 登录/注册/登出
 * - 连接/断开连接
 * - 同步状态管理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashPasswordWithSalt } from '@/adapters/crypto-adapter';

// Mock localStorage
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
    Object.keys(mockLocalStorageData).forEach(key => delete mockLocalStorageData[key]);
  }),
  length: 0,
  key: vi.fn((index: number) => Object.keys(mockLocalStorageData)[index] ?? null),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

// 动态导入被测试模块
let useSyncStore: ReturnType<typeof import('@/ui/stores/sync-store').useSyncStore>;

describe('SyncStore', () => {
  beforeEach(async () => {
    // 清空 mock 数据
    Object.keys(mockLocalStorageData).forEach(key => delete mockLocalStorageData[key]);
    vi.clearAllMocks();
    vi.resetModules();

    // 重置 mock 数据
    mockLocalStorageData['exomind:users'] = JSON.stringify([]);

    // 动态导入模块
    const module = await import('@/ui/stores/sync-store');
    useSyncStore = module.useSyncStore;
  });

  describe('初始状态', () => {
    it('应该返回正确的初始状态', () => {
      const store = useSyncStore.getState();

      expect(store.status.state).toBe('disconnected');
      expect(store.status.lastSync).toBeNull();
      expect(store.status.pendingChanges).toBe(0);
      expect(store.status.conflictCount).toBe(0);
      expect(store.status.syncMode).toBe('realtime');
      expect(store.status.pollInterval).toBe(5);
      expect(store.credentials).toBeNull();
      expect(store.isLoggedIn).toBe(true);
      expect(store.currentUser).toBe('默认档案');
      expect((store as typeof store & { activeProfileId?: string | null }).activeProfileId).toBe('profile-default');
      expect(store.conflicts).toEqual([]);
    });

    it('没有激活档案 session 时不应保留旧 currentUser', async () => {
      const profileModule = await import('@/lib/profile/profile-storage');
      profileModule.createLocalProfile({
        slug: 'exomind',
        displayName: 'Hailay',
      });
      profileModule.setProfileSession({
        version: 1,
        activeProfileId: null,
        unlockedProfileIds: [],
      });

      vi.resetModules();
      const module = await import('@/ui/stores/sync-store');
      const store = module.useSyncStore.getState();

      expect(store.isLoggedIn).toBe(false);
      expect(store.currentUser).toBeNull();
      expect((store as typeof store & { activeProfileId?: string | null }).activeProfileId).toBeNull();
      expect(store.credentials).toBeNull();
    });
  });

  describe('setStatus', () => {
    it('应该更新状态', () => {
      const { setStatus } = useSyncStore.getState();

      setStatus({ state: 'connecting' });

      const { status } = useSyncStore.getState();
      expect(status.state).toBe('connecting');
    });

    it('应该合并状态而不是替换', () => {
      const { setStatus } = useSyncStore.getState();

      setStatus({ state: 'connecting' });
      setStatus({ state: 'connected' });

      const { status } = useSyncStore.getState();
      expect(status.state).toBe('connected');
      expect(status.syncMode).toBe('realtime'); // 保持原始值
    });
  });

  describe('setCredentials', () => {
    it('应该设置凭据', () => {
      const { setCredentials } = useSyncStore.getState();

      const credentials = {
        username: 'testuser',
        passwordHash: 'hash123',
        deviceName: 'Test Device',
        deviceType: 'desktop' as const,
        platform: 'Windows',
      };

      setCredentials(credentials);

      const { credentials: storedCredentials } = useSyncStore.getState();
      expect(storedCredentials).toEqual(credentials);
    });

    it('应该支持清除凭据', () => {
      const { setCredentials } = useSyncStore.getState();

      setCredentials({
        username: 'testuser',
        passwordHash: 'hash123',
        deviceName: 'Test Device',
        deviceType: 'desktop' as const,
        platform: 'Windows',
      });
      setCredentials(null);

      const { credentials } = useSyncStore.getState();
      expect(credentials).toBeNull();
    });
  });

  describe('register', () => {
    it('应该注册新用户', async () => {
      const { register } = useSyncStore.getState();

      await register('newuser', 'password123');

      // 验证 legacy users mirror（旧 users 镜像）仍写入 localStorage
      const storedUsers = JSON.parse(mockLocalStorageData['exomind:users']);
      expect(storedUsers.length).toBe(1);
      expect(storedUsers[0].username).toBe('newuser');
      expect(storedUsers[0].passwordHash).toBeTruthy();

      // 验证 canonical profile storage（规范档案存储）也已创建
      const profileModule = await import('@/lib/profile/profile-storage');
      const profiles = profileModule.listLocalProfiles();
      expect(profiles.map((profile) => profile.slug)).toEqual(['default', 'newuser']);
    });

    it('应该拒绝空用户名', async () => {
      const { register } = useSyncStore.getState();

      await expect(register('', 'password123')).rejects.toThrow('用户名和密码不能为空');
    });

    it('应该拒绝包含空格的用户名', async () => {
      const { register } = useSyncStore.getState();

      await expect(register('bad user', 'password123')).rejects.toThrow('用户名不能包含空格');
      await expect(register(' baduser', 'password123')).rejects.toThrow('用户名不能包含空格');
      await expect(register('baduser ', 'password123')).rejects.toThrow('用户名不能包含空格');
    });

    it('应该拒绝空密码', async () => {
      const { register } = useSyncStore.getState();

      await expect(register('username', '')).rejects.toThrow('用户名和密码不能为空');
    });

    it('应该拒绝短密码', async () => {
      const { register } = useSyncStore.getState();

      await expect(register('username', '12345')).rejects.toThrow('密码长度至少6位');
    });

    it('应该拒绝已存在的用户名', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        { username: 'existing', passwordHash: 'hash' },
      ]);

      const { register } = useSyncStore.getState();

      await expect(register('existing', 'password123')).rejects.toThrow('用户名已存在');
    });

    it('应该支持多个用户注册', async () => {
      const { register } = useSyncStore.getState();

      await register('user1', 'password123');
      await register('user2', 'password456');

      const storedUsers = JSON.parse(mockLocalStorageData['exomind:users']);
      expect(storedUsers.length).toBe(2);
      expect(storedUsers[0].username).toBe('user1');
      expect(storedUsers[1].username).toBe('user2');
    });

    it('注册时应该包含 createdAt', async () => {
      const { register } = useSyncStore.getState();

      const before = Date.now();
      await register('testuser', 'password123');
      const after = Date.now();

      const storedUsers = JSON.parse(mockLocalStorageData['exomind:users']);
      const createdAt = new Date(storedUsers[0].createdAt).getTime();
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe('login', () => {
    it('应该登录成功并激活本地档案', async () => {
      const passwordHash = await hashPasswordWithSalt('password123');
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash,
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login } = useSyncStore.getState();

      await login('testuser', 'password123');

      const state = useSyncStore.getState() as typeof useSyncStore.getState extends () => infer T ? T & { activeProfileId?: string | null } : never;
      const profileModule = await import('@/lib/profile/profile-storage');
      const activeProfile = profileModule.getActiveProfile();

      const { isLoggedIn, currentUser } = state;
      expect(isLoggedIn).toBe(true);
      expect(currentUser).toBe('testuser');
      expect(state.activeProfileId).toBeTruthy();
      expect(activeProfile?.slug).toBe('testuser');
    });

    it('纯本地登录后不应该自动设置远端同步凭据', async () => {
      const passwordHash = await hashPasswordWithSalt('password123');
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash,
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login } = useSyncStore.getState();

      await login('testuser', 'password123');

      const { credentials } = useSyncStore.getState();
      expect(credentials).toBeNull();
    });

    it('应该拒绝不存在的用户', async () => {
      const { login } = useSyncStore.getState();

      await expect(login('nonexistent', 'password123')).rejects.toThrow('用户不存在');
    });

    it('应该拒绝错误的密码', async () => {
      const passwordHash = await hashPasswordWithSalt('password123');
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash,
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login } = useSyncStore.getState();

      await expect(login('testuser', 'wrongpassword')).rejects.toThrow('密码错误');
    });

    it('应该拒绝空用户名', async () => {
      const { login } = useSyncStore.getState();

      await expect(login('', 'password123')).rejects.toThrow('用户名和密码不能为空');
    });

    it('应该拒绝包含空格的用户名', async () => {
      const { login } = useSyncStore.getState();

      await expect(login('bad user', 'password123')).rejects.toThrow('用户名不能包含空格');
      await expect(login(' baduser', 'password123')).rejects.toThrow('用户名不能包含空格');
      await expect(login('baduser ', 'password123')).rejects.toThrow('用户名不能包含空格');
    });
  });

  describe('logout', () => {
    it.skip('应该登出并清除状态', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login, logout } = useSyncStore.getState();
      await login('testuser', 'password123');

      await logout();

      const { isLoggedIn, currentUser, credentials, status } = useSyncStore.getState();
      expect(isLoggedIn).toBe(false);
      expect(currentUser).toBeNull();
      expect(credentials).toBeNull();
      expect(status.state).toBe('disconnected');
    });
  });

  describe('连接管理', () => {
    it('未登录时连接应该失败', async () => {
      await useSyncStore.getState().logout();
      const { connect } = useSyncStore.getState();

      await expect(connect('http://localhost:5984')).rejects.toThrow('未登录，请先登录');
    });

    it.skip('应该连接成功', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login, connect } = useSyncStore.getState();
      await login('testuser', 'password123');

      await connect('http://localhost:5984');

      const { status } = useSyncStore.getState();
      expect(status.state).toBe('connected');
    });

    it.skip('连接时应该触发同步', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login, connect } = useSyncStore.getState();
      await login('testuser', 'password123');

      await connect('http://localhost:5984');

      // 验证同步被调用（需要 mock PouchSyncAdapter）
    });

    it.skip('连接失败应该设置错误状态', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login, connect } = useSyncStore.getState();
      await login('testuser', 'password123');

      await expect(connect('http://localhost:5984')).rejects.toThrow('Connection refused');
    });

    it.skip('应该断开连接', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login, connect, disconnect } = useSyncStore.getState();
      await login('testuser', 'password123');
      await connect('http://localhost:5984');

      await disconnect();

      const { status } = useSyncStore.getState();
      expect(status.state).toBe('disconnected');
    });
  });

  describe('同步方法', () => {
    it.skip('syncEvents 应该更新状态', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login, connect, syncEvents } = useSyncStore.getState();
      await login('testuser', 'password123');
      await connect('http://localhost:5984');

      const result = await syncEvents();

      expect(result.success).toBe(true);
      const { status } = useSyncStore.getState();
      expect(status.state).toBe('connected');
      expect(status.lastSync).not.toBeNull();
    });

    it.skip('syncEvents 失败应该设置错误状态', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login, connect, syncEvents } = useSyncStore.getState();
      await login('testuser', 'password123');
      await connect('http://localhost:5984');

      await expect(syncEvents()).rejects.toThrow('Sync failed');
    });

    it.skip('syncConfig 应该更新状态', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login, connect, syncConfig } = useSyncStore.getState();
      await login('testuser', 'password123');
      await connect('http://localhost:5984');

      const result = await syncConfig();

      expect(result.success).toBe(true);
      const { status } = useSyncStore.getState();
      expect(status.state).toBe('connected');
    });

    it.skip('getConflicts 应该更新冲突列表', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const mockConflicts = [
        { id: 'conflict-1', docId: 'doc-1', docType: 'event', local: {}, remote: {}, resolved: false },
      ];

      const { login, connect, getConflicts } = useSyncStore.getState();
      await login('testuser', 'password123');
      await connect('http://localhost:5984');

      const conflicts = await getConflicts();

      expect(conflicts).toEqual(mockConflicts);
      const { conflictCount } = useSyncStore.getState().status;
      expect(conflictCount).toBe(1);
    });

    it.skip('resolveConflict 应该调用适配器', async () => {
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'testuser',
          passwordHash: '$pbkdf2$salt123$hash456',
          createdAt: new Date().toISOString(),
        },
      ]);

      const { login, connect, resolveConflict } = useSyncStore.getState();
      await login('testuser', 'password123');
      await connect('http://localhost:5984');

      await resolveConflict('doc-1', 'local');
    });
  });

  describe('设备信息检测', () => {
    it('应该检测桌面设备', async () => {
      // 模拟桌面 UA
      Object.defineProperty(globalThis.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        configurable: true,
      });

      const { register } = useSyncStore.getState();
      await register('testuser', 'password123');

      // 验证用户已创建（设备信息在凭据中）
      const storedUsers = JSON.parse(mockLocalStorageData['exomind:users']);
      expect(storedUsers.length).toBe(1);
    });
  });

  describe('持久化', () => {
    it('应该从 profile + identity-link 重建登录状态与远端凭据', async () => {
      const passwordHash = await hashPasswordWithSalt('password123');
      mockLocalStorageData['exomind:profiles:index'] = JSON.stringify(['profile-persisteduser']);
      mockLocalStorageData['exomind:profiles:profile-persisteduser:meta'] = JSON.stringify({
        profileId: 'profile-persisteduser',
        slug: 'persisteduser',
        displayName: 'Persisted User',
        createdAt: '2026-03-07T10:00:00.000Z',
        updatedAt: '2026-03-07T10:00:00.000Z',
        authMode: 'password',
        state: 'active',
        defaultSyncPolicy: 'auto-sync-when-linked',
      });
      mockLocalStorageData['exomind:profiles:profile-persisteduser:secret'] = JSON.stringify({
        profileId: 'profile-persisteduser',
        localPasswordHash: passwordHash,
        updatedAt: '2026-03-07T10:00:00.000Z',
      });
      mockLocalStorageData['exomind:profile-session'] = JSON.stringify({
        version: 1,
        activeProfileId: 'profile-persisteduser',
        unlockedProfileIds: ['profile-persisteduser'],
      });
      mockLocalStorageData['exomind:identity-links:index'] = JSON.stringify(['link-persisteduser']);
      mockLocalStorageData['exomind:identity-links:meta:link-persisteduser'] = JSON.stringify({
        linkId: 'link-persisteduser',
        profileId: 'profile-persisteduser',
        providerId: 'self-hosted-sync',
        remoteIdentityId: 'rid-persisteduser',
        remoteIdentityKey: 'space-persisteduser',
        authMode: 'basic',
        status: 'linked',
        syncMode: 'realtime',
        linkedAt: '2026-03-07T10:00:00.000Z',
      });
      mockLocalStorageData['exomind:identity-links:secret:link-persisteduser'] = JSON.stringify({
        linkId: 'link-persisteduser',
        authType: 'basic',
        authUsername: 'cloud-user',
        authSecret: 'remote-secret',
        updatedAt: '2026-03-07T10:00:00.000Z',
      });

      vi.resetModules();
      const module = await import('@/ui/stores/sync-store');
      const persistedStore = module.useSyncStore.getState();

      expect(persistedStore.isLoggedIn).toBe(true);
      expect(persistedStore.currentUser).toBe('Persisted User');
      expect(persistedStore.credentials?.remoteIdentityKey).toBe('space-persisteduser');
      expect(persistedStore.credentials?.authSecret).toBe('remote-secret');
      expect(persistedStore.credentials?.localProfileId).toBe('profile-persisteduser');
    });

    it('应该迁移 legacy sync-store.credentials 到 identity-link，并且不再持久化机密', async () => {
      const passwordHash = await hashPasswordWithSalt('password123');
      mockLocalStorageData['exomind:users'] = JSON.stringify([
        {
          username: 'legacyuser',
          passwordHash,
          createdAt: '2026-03-07T10:00:00.000Z',
        },
      ]);
      mockLocalStorageData['exomind:sync-store'] = JSON.stringify({
        state: {
          isLoggedIn: true,
          currentUser: 'legacyuser',
          credentials: {
            username: 'legacy-cloud-user',
            passwordHash: 'legacy-remote-secret',
            providerId: 'legacy-sync',
            remoteIdentityId: 'rid-legacyuser',
            remoteIdentityKey: 'space-legacyuser',
            authType: 'basic',
            authUsername: 'legacy-cloud-user',
            authSecret: 'legacy-remote-secret',
            deviceName: 'Legacy Device',
            deviceType: 'desktop',
            platform: 'Windows',
          },
        },
        version: 0,
      });

      vi.resetModules();
      const module = await import('@/ui/stores/sync-store');
      const state = module.useSyncStore.getState();
      const identityModule = await import('@/lib/profile/identity-link-storage');
      const profileModule = await import('@/lib/profile/profile-storage');
      const profile = profileModule.findProfileByLoginName('legacyuser');

      expect(profile).toBeTruthy();
      expect(identityModule.getPreferredIdentityLink(profile!.profileId)?.remoteIdentityKey).toBe('space-legacyuser');
      expect(state.credentials?.authSecret).toBe('legacy-remote-secret');
      expect(JSON.parse(mockLocalStorageData['exomind:sync-store'] || '{"state":{}}')).toEqual({ state: {} });
    });
  });
});
