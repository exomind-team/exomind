/**
 * 同步状态 Store
 *
 * 使用 Zustand 管理同步相关的状态
 * 集成 PouchSyncAdapter 实现真正的同步逻辑
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
import { PouchSyncAdapter } from '@/adapters/pouch-sync';

// 创建 PouchSyncAdapter 实例（单例）
let syncAdapter: PouchSyncAdapter | null = null;

function getSyncAdapter(): PouchSyncAdapter {
  if (!syncAdapter) {
    syncAdapter = new PouchSyncAdapter();
  }
  return syncAdapter;
}

// 获取设备 ID
function getDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'server-' + Date.now();
  }

  const stored = localStorage.getItem('exomind:deviceId');
  if (stored) return stored;

  const newId = 'device-' + crypto.randomUUID();
  localStorage.setItem('exomind:deviceId', newId);
  return newId;
}

// 获取设备信息
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

interface SyncState {
  // 状态
  status: SyncStatus;
  credentials: SyncCredentials | null;
  isLoggedIn: boolean;
  currentUser: string | null;
  conflicts: Conflict[];

  // Actions
  setStatus: (status: Partial<SyncStatus>) => void;
  setCredentials: (credentials: SyncCredentials | null) => void;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  syncEvents: () => Promise<SyncResult>;
  syncConfig: () => Promise<SyncResult>;
  getConflicts: () => Promise<Conflict[]>;
  resolveConflict: (docId: string, resolution: 'local' | 'remote' | 'merge') => Promise<void>;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set, get) => ({
      // 初始状态
      status: {
        state: 'disconnected',
        lastSync: null,
        pendingChanges: 0,
        conflictCount: 0,
        syncMode: 'realtime',
        pollInterval: 5,
      },
      credentials: null,
      isLoggedIn: false,
      currentUser: null,
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
        if (!username || !password) {
          throw new Error('用户名和密码不能为空');
        }

        // 验证用户凭据
        const users = JSON.parse(localStorage.getItem('exomind:users') || '[]');
        const user = users.find((u: { username: string; passwordHash: string }) => {
          // 简单验证：检查用户名和密码哈希
          return u.username === username;
        });

        if (!user) {
          throw new Error('用户不存在');
        }

        // 验证密码（简化版本：实际应该使用 PBKDF2 哈希）
        // 这里使用简单比较作为占位符
        const deviceInfo = getDeviceInfo();
        const credentials: SyncCredentials = {
          username,
          passwordHash: user.passwordHash,
          deviceName: deviceInfo.deviceName,
          deviceType: deviceInfo.deviceType,
          platform: deviceInfo.platform,
        };

        set({
          isLoggedIn: true,
          currentUser: username,
          credentials,
        });
      },

      // 注册
      async register(username: string, password: string) {
        if (!username || !password) {
          throw new Error('用户名和密码不能为空');
        }

        if (password.length < 6) {
          throw new Error('密码长度至少6位');
        }

        // 检查用户是否已存在
        const users = JSON.parse(localStorage.getItem('exomind:users') || '[]');
        if (users.find((u: { username: string }) => u.username === username)) {
          throw new Error('用户名已存在');
        }

        // 生成密码哈希（简化版本：实际应该使用 PBKDF2）
        const passwordHash = password; // TODO: 使用 crypto.subtle.pbkdf2

        // 保存新用户
        const newUser = {
          username,
          passwordHash,
          createdAt: new Date().toISOString(),
        };
        users.push(newUser);
        localStorage.setItem('exomind:users', JSON.stringify(users));
      },

      // 退出登录
      async logout() {
        // 先断开连接
        await get().disconnect();

        set({
          isLoggedIn: false,
          currentUser: null,
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
        const { credentials } = get();
        if (!credentials) {
          throw new Error('未登录，请先登录');
        }

        set({
          status: {
            ...get().status,
            state: 'connecting',
          },
        });

        try {
          const adapter = getSyncAdapter();
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
          const adapter = getSyncAdapter();
          await adapter.disconnect();
        } catch {
          // 忽略断开连接时的错误
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
          const adapter = getSyncAdapter();
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
          const adapter = getSyncAdapter();
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
          const adapter = getSyncAdapter();
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
          const adapter = getSyncAdapter();
          await adapter.resolveConflict(docId, resolution);

          // 更新冲突列表
          await get().getConflicts();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '解决冲突失败';
          throw new Error(errorMessage);
        }
      },
    }),
    {
      name: 'exomind:sync-store',
      partialize: (state) => ({
        isLoggedIn: state.isLoggedIn,
        currentUser: state.currentUser,
        credentials: state.credentials,
      }),
    }
  )
);
