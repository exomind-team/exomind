import { invoke, isTauri } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { useSyncStore } from '@/ui/stores/sync-store';
import {
  getNowWorkbenchOverlayEnabled,
  getNowWorkbenchOverlayPosition,
  setNowWorkbenchOverlayPosition,
  subscribeNowWorkbenchOverlayEnabledChanges,
  type NowWorkbenchOverlayPosition,
} from '@/config/now-workbench-overlay-preferences';

export interface NowWorkbenchOverlayService {
  init(): Promise<void>;
  destroy(): void;
  syncVisibility(): Promise<void>;
  hideTemporarily(): Promise<void>;
  reopenFromMainWindow(): Promise<void>;
  focusMainWindow(): Promise<void>;
  savePosition(position: NowWorkbenchOverlayPosition): Promise<NowWorkbenchOverlayPosition | null>;
}

class NowWorkbenchOverlayServiceImpl implements NowWorkbenchOverlayService {
  private initialized = false;
  private lifecycleGeneration = 0;
  private enabled = getNowWorkbenchOverlayEnabled();
  private sessionHidden = false;
  private windowEnsured = false;
  private unlistenEnabled: (() => void) | null = null;
  private unlistenOverlayRequest: (() => void) | null = null;
  private unlistenProfile: (() => void) | null = null;
  private profileSyncQueue: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    if (this.initialized || !isTauri()) {
      return;
    }

    const lifecycleGeneration = ++this.lifecycleGeneration;
    this.initialized = true;

    this.unlistenEnabled = subscribeNowWorkbenchOverlayEnabledChanges((value) => {
      this.enabled = value;
      if (!value) {
        this.sessionHidden = false;
      }
      void this.syncVisibility();
    });

    this.unlistenProfile = useSyncStore.subscribe((state, previousState) => {
      if (state.activeProfileId !== previousState.activeProfileId) {
        void this.queueCurrentProfileSync().catch(() => {});
      }
    });

    // 监听 overlay 的档案请求，立即响应当前档案
    const unlistenOverlayRequest = await listen("overlay-request-profile", () => {
      void this.queueCurrentProfileSync().catch(() => {});
    }).catch(() => () => {});

    if (!this.initialized || lifecycleGeneration !== this.lifecycleGeneration) {
      unlistenOverlayRequest();
      return;
    }
    this.unlistenOverlayRequest = unlistenOverlayRequest;

    await this.syncVisibility();
  }

  destroy(): void {
    this.lifecycleGeneration += 1;
    this.unlistenEnabled?.();
    this.unlistenEnabled = null;
    this.unlistenOverlayRequest?.();
    this.unlistenOverlayRequest = null;
    this.unlistenProfile?.();
    this.unlistenProfile = null;
    this.initialized = false;
    this.sessionHidden = false;
    this.windowEnsured = false;
    this.enabled = getNowWorkbenchOverlayEnabled();
  }

  private async ensureWindow(): Promise<void> {
    if (this.windowEnsured) {
      return;
    }

    await invoke('now_workbench_overlay_ensure');
    this.windowEnsured = true;

    const savedPosition = getNowWorkbenchOverlayPosition();
    if (savedPosition) {
      await invoke('now_workbench_overlay_set_position', {
        x: savedPosition.x,
        y: savedPosition.y,
      });
    }
  }

  private queueCurrentProfileSync(): Promise<void> {
    const profileId = useSyncStore.getState().activeProfileId;
    const lifecycleGeneration = this.lifecycleGeneration;
    const syncProfile = async () => {
      if (!this.initialized || lifecycleGeneration !== this.lifecycleGeneration) {
        return;
      }

      await invoke('now_workbench_overlay_profile_set', {
        profileId: profileId || null,
      });

      if (
        this.initialized
        && lifecycleGeneration === this.lifecycleGeneration
        && this.windowEnsured
      ) {
        await emit('main-window-profile-sync', { profileId: profileId || null }).catch(() => {});
      }
    };

    const queued = this.profileSyncQueue.then(syncProfile, syncProfile);
    this.profileSyncQueue = queued.catch(() => {});
    return queued;
  }

  async syncVisibility(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    await this.queueCurrentProfileSync();

    if (!this.enabled || this.sessionHidden) {
      if (this.windowEnsured) {
        await invoke('now_workbench_overlay_hide');
      }
      return;
    }

    await this.ensureWindow();
    await this.queueCurrentProfileSync();
    await invoke('now_workbench_overlay_show');
  }

  async hideTemporarily(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    this.sessionHidden = true;
    if (this.windowEnsured) {
      await invoke('now_workbench_overlay_hide');
    }
  }

  async reopenFromMainWindow(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    this.sessionHidden = false;
    if (!this.enabled) {
      return;
    }
    await this.ensureWindow();
    await this.queueCurrentProfileSync();
    await invoke('now_workbench_overlay_restore');
  }

  async focusMainWindow(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    await invoke('now_workbench_overlay_focus_main');
  }

  async savePosition(position: NowWorkbenchOverlayPosition): Promise<NowWorkbenchOverlayPosition | null> {
    const next = setNowWorkbenchOverlayPosition(position);
    if (!isTauri() || !next) {
      return next;
    }

    await invoke('now_workbench_overlay_set_position', {
      x: next.x,
      y: next.y,
    });
    return next;
  }
}

export function createNowWorkbenchOverlayService(): NowWorkbenchOverlayService {
  return new NowWorkbenchOverlayServiceImpl();
}

let instance: NowWorkbenchOverlayService | null = null;

export function getNowWorkbenchOverlayService(): NowWorkbenchOverlayService {
  if (!instance) {
    instance = createNowWorkbenchOverlayService();
  }
  return instance;
}
