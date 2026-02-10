/**
 * 同步状态 Store
 *
 * 使用 Zustand 管理同步相关的状态
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DeviceType } from '@/environment/interfaces/sync.port';
import type { SyncStatus, SyncCredentials } from '@/environment/interfaces/sync.port';

// 注意：由于 ISyncPort 是接口，这里用简化实现
// 实际使用时应通过 Environment 注入 ISyncPort 实例

interface SyncState {
  // 状态
  status: SyncStatus;
  credentials: SyncCredentials | null;
  isLoggedIn: boolean;
  currentUser: string | null;

  // Actions
  setStatus: (status: Partial<SyncStatus>) => void;
  setCredentials: (credentials: SyncCredentials | null) => void;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  connect: (url: string) => Promise<void>;
  disconnect: () => Promise<void>;
  syncEvents: () => Promise<void>;
  syncConfig: () => Promise<void>;
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
        // TODO: 实际实现应该调用后端 API
        // 简化实现：本地验证
        if (!username || !password) {
          throw new Error('用户名和密码不能为空');
        }

        set({
          isLoggedIn: true,
          currentUser: username,
          credentials: {
            username,
            passwordHash: password, // 简化：实际应使用哈希
            deviceName: '当前设备',
            deviceType: DeviceType.DESKTOP,
            platform: navigator.platform,
          },
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

        // 简化实现：检查本地存储中是否已存在该用户
        const users = JSON.parse(localStorage.getItem('exomind:users') || '[]');
        if (users.find((u: { username: string }) => u.username === username)) {
          throw new Error('用户名已存在');
        }

        // 保存新用户（简化：密码明文存储，实际应使用哈希）
        const newUser = {
          username,
          passwordHash: password,
          createdAt: new Date().toISOString(),
        };
        users.push(newUser);
        localStorage.setItem('exomind:users', JSON.stringify(users));
      },

      // 退出
      logout() {
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
      async connect(_url: string) {
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

        // TODO: 实际实现应该调用 ISyncPort.connect()
        // 模拟连接延迟
        await new Promise((resolve) => setTimeout(resolve, 500));

        set({
          status: {
            ...get().status,
            state: 'connected',
          },
        });
      },

      // 断开
      async disconnect() {
        // TODO: 实际实现应该调用 ISyncPort.disconnect()
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

        // TODO: 实际实现应该调用 ISyncPort.syncEvents()
        await new Promise((resolve) => setTimeout(resolve, 1000));

        set({
          status: {
            ...get().status,
            state: 'connected',
            lastSync: Date.now(),
          },
        });
      },

      // 同步配置
      async syncConfig() {
        set({
          status: {
            ...get().status,
            state: 'syncing',
          },
        });

        // TODO: 实际实现应该调用 ISyncPort.syncConfig()
        await new Promise((resolve) => setTimeout(resolve, 500));

        set({
          status: {
            ...get().status,
            state: 'connected',
            lastSync: Date.now(),
          },
        });
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
