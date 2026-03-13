import { invoke, isTauri } from '@tauri-apps/api/core';
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
  private enabled = getNowWorkbenchOverlayEnabled();
  private sessionHidden = false;
  private unlistenEnabled: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.initialized || !isTauri()) {
      return;
    }

    this.initialized = true;
    await invoke('now_workbench_overlay_ensure');

    const savedPosition = getNowWorkbenchOverlayPosition();
    if (savedPosition) {
      await invoke('now_workbench_overlay_set_position', {
        x: savedPosition.x,
        y: savedPosition.y,
      });
    }

    this.unlistenEnabled = subscribeNowWorkbenchOverlayEnabledChanges((value) => {
      this.enabled = value;
      if (!value) {
        this.sessionHidden = false;
      }
      void this.syncVisibility();
    });

    await this.syncVisibility();
  }

  destroy(): void {
    this.unlistenEnabled?.();
    this.unlistenEnabled = null;
    this.initialized = false;
    this.sessionHidden = false;
    this.enabled = getNowWorkbenchOverlayEnabled();
  }

  async syncVisibility(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    if (!this.enabled || this.sessionHidden) {
      await invoke('now_workbench_overlay_hide');
      return;
    }

    await invoke('now_workbench_overlay_show');
  }

  async hideTemporarily(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    this.sessionHidden = true;
    await invoke('now_workbench_overlay_hide');
  }

  async reopenFromMainWindow(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    this.sessionHidden = false;
    if (!this.enabled) {
      return;
    }
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
