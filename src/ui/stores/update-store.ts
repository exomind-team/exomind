import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type UpdateChannel,
  type CheckInterval,
  type UpdateInfo,
  checkForUpdate,
  getCurrentVersion,
  getPlatform,
  createAutoCheckController,
} from '@/lib/services/update.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UpdateState {
  // 设置（持久化）
  channel: UpdateChannel;
  checkInterval: CheckInterval;
  autoDownloadPreview: boolean;

  // 运行时状态（不持久化，但 zustand persist 的 partialize 会处理）
  updateAvailable: UpdateInfo | null;
  lastCheckTime: number | null;
  isChecking: boolean;
  downloadProgress: number | null;
  toastDismissed: boolean;
  error: string | null;

  // Actions
  setChannel: (channel: UpdateChannel) => void;
  setCheckInterval: (interval: CheckInterval) => void;
  setAutoDownloadPreview: (enabled: boolean) => void;
  setUpdateAvailable: (info: UpdateInfo | null) => void;
  setIsChecking: (checking: boolean) => void;
  setLastCheckTime: (time: number) => void;
  dismissToast: () => void;
  checkForUpdate: () => Promise<void>;
  initAutoCheck: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const autoCheckController = createAutoCheckController();

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set, get) => ({
      // 默认设置
      channel: 'release',
      checkInterval: 'daily',
      autoDownloadPreview: false,

      // 运行时状态
      updateAvailable: null,
      lastCheckTime: null,
      isChecking: false,
      downloadProgress: null,
      toastDismissed: false,
      error: null,

      // -------------------------------------------------------------------
      // Actions
      // -------------------------------------------------------------------

      setChannel: (channel) => {
        set({ channel });
        // 切换通道后重新检查
        get().checkForUpdate();
      },

      setCheckInterval: (interval) => {
        set({ checkInterval: interval as CheckInterval });
        // 重新启动定时器
        get().initAutoCheck();
      },

      setAutoDownloadPreview: (enabled) => set({ autoDownloadPreview: enabled }),

      setUpdateAvailable: (info) => set({ updateAvailable: info, toastDismissed: false }),

      setIsChecking: (checking) => set({ isChecking: checking }),

      setLastCheckTime: (time) => set({ lastCheckTime: time }),

      dismissToast: () => set({ toastDismissed: true }),

      checkForUpdate: async () => {
        const { channel, isChecking } = get();
        if (isChecking) return;

        set({ isChecking: true, error: null });

        try {
          const [currentVersion, platform] = await Promise.all([
            getCurrentVersion(),
            getPlatform(),
          ]);

          const info = await checkForUpdate({
            channel,
            platform,
            currentVersion,
          });

          const prevUpdate = get().updateAvailable;
          const isNewVersion =
            !prevUpdate ||
            prevUpdate.latestVersion !== info.latestVersion;

          set({
            updateAvailable: info.hasUpdate ? info : null,
            lastCheckTime: Date.now(),
            isChecking: false,
            // 如果是新版本，重置 toast dismissed 状态
            toastDismissed: isNewVersion ? false : get().toastDismissed,
          });
        } catch (err) {
          set({
            isChecking: false,
            lastCheckTime: Date.now(),
            error: err instanceof Error ? err.message : '检查更新失败',
          });
        }
      },

      initAutoCheck: () => {
        const { checkInterval } = get();
        autoCheckController.start(checkInterval, () => {
          get().checkForUpdate();
        });
      },
    }),
    {
      name: 'exomind-update-settings',
      // 只持久化设置项和上次检查时间
      partialize: (state) => ({
        channel: state.channel,
        checkInterval: state.checkInterval,
        autoDownloadPreview: state.autoDownloadPreview,
        lastCheckTime: state.lastCheckTime,
      }),
    },
  ),
);

/**
 * 在应用启动时调用，初始化自动检查定时器并立即执行一次检查。
 */
export function initUpdateChecker(): void {
  const store = useUpdateStore.getState();
  store.initAutoCheck();
  // 启动时立即检查一次
  store.checkForUpdate();
}

/**
 * 在应用卸载时调用，清理定时器。
 */
export function destroyUpdateChecker(): void {
  autoCheckController.stop();
}
