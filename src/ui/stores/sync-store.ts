/**
 * 同步状态 Store
 *
 * 使用 Zustand 管理同步相关的状态
 * 集成 PouchSyncAdapter 实现真正的同步逻辑
 * 集成 CryptoAdapter 实现密码哈希（SPEC-302）
 *
 * 注意：PouchSyncAdapter 使用动态导入，避免在应用启动时加载 PouchDB
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DeviceType,
  type SyncStatus,
  type SyncCredentials,
  type SyncResult,
  type Conflict,
} from '@/environment/interfaces/sync.port';
import {
  hashPasswordWithSalt,
  verifyPassword,
} from '@/adapters/crypto-adapter';
import {
  createLocalProfile,
  ensureProfileStorageMigrated,
  findProfileByLoginName,
  getActiveProfile,
  getProfileSession,
  getProfileSecret,
  setProfileSession,
} from '@/lib/profile/profile-storage';
import type { LocalProfile } from '@/lib/profile/types';
import {
  createIdentityLink,
  getIdentityLinkSecret,
  getPreferredIdentityLink,
  listIdentityLinks,
  revokeIdentityLink,
} from '@/lib/profile/identity-link-storage';

// 类型延迟导入（不实际加载模块）
import type { PouchSyncAdapter } from '@/adapters/pouch-sync';

// 存储动态导入的适配器实例
let syncAdapter: PouchSyncAdapter | null = null;
const USERNAME_WHITESPACE_PATTERN = /\s/;
const SYNC_STORE_KEY = 'exomind:sync-store';
const DEFAULT_PROFILE_SESSION = {
  version: 1 as const,
  activeProfileId: null,
  unlockedProfileIds: [] as string[],
};

type PersistedSyncStorePayload = {
  state?: {
    isLoggedIn?: boolean;
    currentUser?: string | null;
    activeProfileId?: string | null;
    credentials?: Partial<SyncCredentials> | null;
  };
  isLoggedIn?: boolean;
  currentUser?: string | null;
  activeProfileId?: string | null;
  credentials?: Partial<SyncCredentials> | null;
};

function readLegacyUsersMirror(): Array<{ username: string; passwordHash: string; createdAt: string }> {
  try {
    return JSON.parse(localStorage.getItem('exomind:users') || '[]');
  } catch {
    return [];
  }
}

function writeLegacyUsersMirror(users: Array<{ username: string; passwordHash: string; createdAt: string }>): void {
  localStorage.setItem('exomind:users', JSON.stringify(users));
}

// 动态导入 PouchSyncAdapter（浏览器兼容）
async function loadSyncAdapter(): Promise<typeof import('@/adapters/pouch-sync')> {
  const module = await import('@/adapters/pouch-sync');
  return module;
}

// 初始化同步适配器（在用户登录后调用）
export async function initSyncAdapter(): Promise<PouchSyncAdapter> {
  if (!syncAdapter) {
    const module = await loadSyncAdapter();
    syncAdapter = new module.PouchSyncAdapter();
  }
  return syncAdapter;
}

function getDeviceInfo(): { deviceName: string; deviceType: DeviceType; platform: string } {
  if (typeof window === 'undefined') {
    return {
      deviceName: 'Server',
      deviceType: DeviceType.SERVER,
      platform: 'Node.js',
    };
  }

  const ua = navigator.userAgent;

  let deviceType: DeviceType;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    deviceType = DeviceType.TABLET;
  } else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
    deviceType = DeviceType.PHONE;
  } else {
    deviceType = DeviceType.DESKTOP;
  }

  let platform = navigator.platform;
  if (/Android/.test(ua)) platform = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) platform = 'iOS';
  else if (/Mac/.test(ua)) platform = 'macOS';
  else if (/Win/.test(ua)) platform = 'Windows';
  else if (/Linux/.test(ua)) platform = 'Linux';

  const storedName = localStorage.getItem('exomind:deviceName');
  const deviceName = storedName || `${platform} Device`;

  return { deviceName, deviceType, platform };
}

function buildCredentialsFromLinkedIdentity(profileId: string, fallbackUsername: string): SyncCredentials | null {
  const link = getPreferredIdentityLink(profileId);
  if (!link) {
    return null;
  }

  const secret = getIdentityLinkSecret(link.linkId);
  const deviceInfo = getDeviceInfo();
  return {
    localProfileId: profileId,
    username: link.remoteIdentityKey || fallbackUsername,
    passwordHash: secret?.authSecret || '',
    providerId: link.providerId,
    remoteIdentityId: link.remoteIdentityId,
    remoteIdentityKey: link.remoteIdentityKey,
    authType: secret?.authType || link.authMode,
    authUsername: secret?.authUsername,
    authSecret: secret?.authSecret,
    deviceName: deviceInfo.deviceName,
    deviceType: deviceInfo.deviceType,
    platform: deviceInfo.platform,
  };
}

function readPersistedSyncStore(): PersistedSyncStorePayload | null {
  try {
    const raw = localStorage.getItem(SYNC_STORE_KEY);
    return raw ? JSON.parse(raw) as PersistedSyncStorePayload : null;
  } catch {
    return null;
  }
}

function migrateLegacySyncCredentialsToIdentityLink(activeProfile: LocalProfile | null): void {
  if (!activeProfile) {
    return;
  }

  const persisted = readPersistedSyncStore();
  const legacyCredentials = persisted?.state?.credentials || persisted?.credentials;
  if (!legacyCredentials || getPreferredIdentityLink(activeProfile.profileId)) {
    return;
  }

  const remoteIdentityKey = legacyCredentials.remoteIdentityKey?.trim() || legacyCredentials.username?.trim();
  if (!remoteIdentityKey) {
    return;
  }

  createIdentityLink({
    profileId: activeProfile.profileId,
    providerId: legacyCredentials.providerId || 'legacy-sync-store',
    remoteIdentityId: legacyCredentials.remoteIdentityId || remoteIdentityKey,
    remoteIdentityKey,
    authType: legacyCredentials.authType || (legacyCredentials.authSecret || legacyCredentials.passwordHash ? 'basic' : 'none'),
    authUsername: legacyCredentials.authUsername || legacyCredentials.username,
    authSecret: legacyCredentials.authSecret || legacyCredentials.passwordHash,
  });
}

function clearLegacySyncStorePersist(): void {
  try {
    localStorage.removeItem(SYNC_STORE_KEY);
  } catch {
    // ignore storage cleanup failures
  }
}

export function resolveRemoteSyncKey(credentials: SyncCredentials | null): string | null {
  const candidate = credentials?.remoteIdentityKey || credentials?.username;
  if (typeof candidate !== 'string') {
    return null;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

interface SyncState {
  // 状态
  status: SyncStatus;
  credentials: SyncCredentials | null;
  isLoggedIn: boolean;
  currentUser: string | null;
  activeProfileId: string | null;
  conflicts: Conflict[];

  // Actions
  setStatus: (status: Partial<SyncStatus>) => void;
  setCredentials: (credentials: SyncCredentials | null) => void;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  linkRemoteIdentity: (input: {
    providerId: string;
    remoteIdentityId: string;
    remoteIdentityKey: string;
    authType: 'none' | 'basic' | 'token';
    authUsername?: string;
    authSecret?: string;
  }) => Promise<void>;
  unlinkRemoteIdentity: () => Promise<void>;
  logout: () => Promise<void>;
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  syncEvents: () => Promise<SyncResult>;
  syncConfig: () => Promise<SyncResult>;
  getConflicts: () => Promise<Conflict[]>;
  resolveConflict: (docId: string, resolution: 'local' | 'remote' | 'merge') => Promise<void>;
}

function validateAuthInput(username: string, password: string): void {
  if (!username || !password) {
    throw new Error('用户名和密码不能为空');
  }
  if (USERNAME_WHITESPACE_PATTERN.test(username)) {
    throw new Error('用户名不能包含空格');
  }
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => {
      ensureProfileStorageMigrated();
      const initialSession = getProfileSession();
      const initialActiveProfile = getActiveProfile();
      migrateLegacySyncCredentialsToIdentityLink(initialActiveProfile);
      const initialCredentials = initialActiveProfile
        ? buildCredentialsFromLinkedIdentity(initialActiveProfile.profileId, initialActiveProfile.slug)
        : null;
      clearLegacySyncStorePersist();

      return ({
      // 初始状态
      status: {
        state: 'disconnected',
        lastSync: null,
        pendingChanges: 0,
        conflictCount: 0,
        syncMode: 'realtime',
        pollInterval: 5,
      },
      credentials: initialCredentials,
      isLoggedIn: Boolean(
        initialSession.activeProfileId
        && initialSession.unlockedProfileIds.includes(initialSession.activeProfileId)
      ),
      currentUser: initialActiveProfile?.displayName || initialActiveProfile?.slug || null,
      activeProfileId: initialSession.activeProfileId,
      conflicts: [],

      // 更新状态
      setStatus: (newStatus) => {
        set((state) => ({
          status: { ...state.status, ...newStatus },
        }));
      },

      setCredentials: (credentials) => {
        set({ credentials });
      },

      // 登录
      async login(username: string, password: string) {
        validateAuthInput(username, password);
        ensureProfileStorageMigrated();

        const profile = findProfileByLoginName(username);
        if (!profile) {
          throw new Error('用户不存在');
        }

        const secret = getProfileSecret(profile.profileId);
        const isValid = secret?.localPasswordHash
          ? await verifyPassword(password, secret.localPasswordHash)
          : password.length === 0;
        if (!isValid) {
          throw new Error('密码错误');
        }

        setProfileSession({
          version: 1,
          activeProfileId: profile.profileId,
          unlockedProfileIds: [profile.profileId],
        });

        set({
          isLoggedIn: true,
          currentUser: profile.displayName || profile.slug,
          activeProfileId: profile.profileId,
          credentials: buildCredentialsFromLinkedIdentity(profile.profileId, profile.slug),
        });
      },

      // 注册
      async register(username: string, password: string) {
        validateAuthInput(username, password);
        ensureProfileStorageMigrated();

        if (password.length < 6) {
          throw new Error('密码长度至少6位');
        }

        if (findProfileByLoginName(username)) {
          throw new Error('用户名已存在');
        }

        // 使用 SPEC-302 的密码哈希
        const passwordHash = await hashPasswordWithSalt(password);
        const createdProfile = createLocalProfile({
          slug: username,
          displayName: username,
          localPasswordHash: passwordHash,
        });

        // 兼容旧 users mirror（旧 users 镜像）
        const users = readLegacyUsersMirror();
        const newUser = {
          username,
          passwordHash,
          createdAt: createdProfile.createdAt,
        };
        users.push(newUser);
        writeLegacyUsersMirror(users);
      },

      async linkRemoteIdentity(input) {
        const { activeProfileId, isLoggedIn } = get();
        if (!isLoggedIn || !activeProfileId) {
          throw new Error('请先打开本地档案');
        }

        const activeProfile = getActiveProfile();
        createIdentityLink({
          profileId: activeProfileId,
          providerId: input.providerId,
          remoteIdentityId: input.remoteIdentityId || input.remoteIdentityKey,
          remoteIdentityKey: input.remoteIdentityKey,
          authType: input.authType,
          authUsername: input.authUsername,
          authSecret: input.authSecret,
        });

        set({
          credentials: buildCredentialsFromLinkedIdentity(activeProfileId, activeProfile?.slug || input.remoteIdentityKey),
        });
      },

      async unlinkRemoteIdentity() {
        const { activeProfileId } = get();
        if (!activeProfileId) {
          return;
        }

        const links = listIdentityLinks(activeProfileId).filter((link) => link.status === 'linked');
        links.forEach((link) => revokeIdentityLink(link.linkId));

        await get().disconnect();
        set({ credentials: null });
      },

      // 退出登录
      async logout() {
        // 先断开连接
        await get().disconnect();
        setProfileSession(DEFAULT_PROFILE_SESSION);

        set({
          isLoggedIn: false,
          currentUser: null,
          activeProfileId: null,
          credentials: null,
          status: {
            state: 'disconnected',
            lastSync: null,
            pendingChanges: 0,
            conflictCount: 0,
            syncMode: 'realtime',
            pollInterval: 5,
          },
        });
      },

      // 连接
      async connect(url: string) {
        const { credentials, isLoggedIn, activeProfileId } = get();
        if (!isLoggedIn || !activeProfileId) {
          throw new Error('未登录，请先登录');
        }
        if (!credentials) {
          throw new Error('当前档案未连接远端同步身份');
        }

        set({
          status: {
            ...get().status,
            state: 'connecting',
          },
        });

        try {
          // 初始化适配器（动态加载 PouchDB）
          const adapter = await initSyncAdapter();
          await adapter.connect(url, credentials);

          set({
            status: {
              ...get().status,
              state: 'connected',
            },
          });

          // 尝试同步事件和配置
          await adapter.syncEvents();
          await adapter.syncConfig();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '连接失败';
          set({
            status: {
              ...get().status,
              state: 'error',
              error: errorMessage,
            },
          });
          throw error;
        }
      },

      // 断开连接
      async disconnect() {
        try {
          // 尝试初始化并断开
          const adapter = await initSyncAdapter();
          await adapter.disconnect();
        } catch {
          // 忽略断开连接时的错误（可能还未初始化）
        }

        set({
          status: {
            state: 'disconnected',
            lastSync: null,
            pendingChanges: 0,
            conflictCount: 0,
            syncMode: 'realtime',
            pollInterval: 5,
          },
        });
      },

      // 同步事件
      async syncEvents() {
        set({
          status: {
            ...get().status,
            state: 'syncing',
          },
        });

        try {
          const adapter = await initSyncAdapter();
          const result = await adapter.syncEvents();

          // 更新冲突计数
          const conflicts = await adapter.getConflicts();

          set({
            status: {
              ...get().status,
              state: 'connected',
              lastSync: Date.now(),
              pendingChanges: 0,
              conflictCount: conflicts.length,
            },
            conflicts,
          });

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '同步失败';
          set({
            status: {
              ...get().status,
              state: 'error',
              error: errorMessage,
            },
          });
          throw error;
        }
      },

      // 同步配置
      async syncConfig() {
        set({
          status: {
            ...get().status,
            state: 'syncing',
          },
        });

        try {
          const adapter = await initSyncAdapter();
          const result = await adapter.syncConfig();

          // 更新冲突计数
          const conflicts = await adapter.getConflicts();

          set({
            status: {
              ...get().status,
              state: 'connected',
              lastSync: Date.now(),
              conflictCount: conflicts.length,
            },
            conflicts,
          });

          return result;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '同步失败';
          set({
            status: {
              ...get().status,
              state: 'error',
              error: errorMessage,
            },
          });
          throw error;
        }
      },

      // 获取冲突列表
      async getConflicts() {
        try {
          const adapter = await initSyncAdapter();
          const conflicts = await adapter.getConflicts();

          set({
            conflicts,
            status: {
              ...get().status,
              conflictCount: conflicts.length,
            },
          });

          return conflicts;
        } catch {
          return [];
        }
      },

      // 解决冲突
      async resolveConflict(docId: string, resolution: 'local' | 'remote' | 'merge') {
        try {
          const adapter = await initSyncAdapter();
          await adapter.resolveConflict(docId, resolution);

          // 更新冲突列表
          await get().getConflicts();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '解决冲突失败';
          throw new Error(errorMessage);
        }
      },
    });
    },
    {
      name: 'exomind:sync-store',
      partialize: () => ({}),
    }
  )
);
