import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { appRouter } from '@/routes';
import {
  getMainWindowShortcutSelection,
  MAIN_WINDOW_SHORTCUT_SELECTION_STORAGE_KEY,
} from '@/config/main-window-shortcut';
import {
  getMainWindowShortcutQuickFocusEnabled,
  subscribeMainWindowShortcutQuickFocusChanges,
} from '@/config/main-window-shortcut-focus';
import { subscribeVoiceShortcutHotkeyChanges } from '@/config/voice-shortcut-hotkey';
import { requestMainWindowFocusTarget } from '@/services/main-window-focus-targets';
import {
  syncMainWindowShortcutSelectionWithRuntime,
  takePendingMainWindowShortcutActivation,
} from '@/services/main-window-shortcut-runtime';
import { getEventlogPathForTab } from '@/ui/app/pages/eventlog-route-memory';

export const MAIN_WINDOW_SHORTCUT_EVENT_NAME = 'main-window-shortcut';
export const MAIN_WINDOW_FOCUS_TARGET_EVENTLOG_RECORD_INPUT = 'eventlog-record-input';

async function navigateToEventlogRecord(): Promise<void> {
  await appRouter.navigate({
    to: getEventlogPathForTab('record'),
  });
}

export class MainWindowShortcutService {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private lifecycle = 0;
  private unlistenEvent: (() => void) | null = null;
  private unlistenVoiceShortcut: (() => void) | null = null;
  private unlistenQuickFocus: (() => void) | null = null;
  private unlistenSelection: (() => void) | null = null;
  private quickFocusEnabled = getMainWindowShortcutQuickFocusEnabled();

  init(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }
    if (this.initPromise) return this.initPromise;

    const lifecycle = ++this.lifecycle;
    const handles: Array<() => void> = [];
    let committed = false;
    const task = (async () => {
      if (!await isTauri() || lifecycle !== this.lifecycle) return;

      await this.syncShortcut(lifecycle);
      if (lifecycle !== this.lifecycle) return;

      const unlistenVoice = subscribeVoiceShortcutHotkeyChanges(() => {
        void this.syncShortcut(lifecycle);
      });
      handles.push(unlistenVoice);
      const unlistenSelection = this.subscribeSelectionStorageChanges(lifecycle);
      handles.push(unlistenSelection);
      const unlistenQuickFocus = subscribeMainWindowShortcutQuickFocusChanges((enabled) => {
        if (lifecycle === this.lifecycle) this.quickFocusEnabled = enabled;
      });
      handles.push(unlistenQuickFocus);
      const unlistenEvent = await listen(MAIN_WINDOW_SHORTCUT_EVENT_NAME, async () => {
        await this.consumePendingActivation(lifecycle);
      });
      handles.push(unlistenEvent);
      if (lifecycle !== this.lifecycle) return;

      this.unlistenVoiceShortcut = unlistenVoice;
      this.unlistenSelection = unlistenSelection;
      this.unlistenQuickFocus = unlistenQuickFocus;
      this.unlistenEvent = unlistenEvent;
      this.initialized = true;
      committed = true;
      await this.consumePendingActivation(lifecycle);
    })().finally(() => {
      // A registration that arrives after unmount belongs to the old lifecycle.
      if (!committed) handles.forEach((unlisten) => unlisten());
      if (this.initPromise === task) this.initPromise = null;
    });
    this.initPromise = task;
    return task;
  }

  destroy(): void {
    ++this.lifecycle;
    this.initPromise = null;
    this.unlistenEvent?.();
    this.unlistenEvent = null;
    this.unlistenVoiceShortcut?.();
    this.unlistenVoiceShortcut = null;
    this.unlistenSelection?.();
    this.unlistenSelection = null;
    this.unlistenQuickFocus?.();
    this.unlistenQuickFocus = null;
    this.initialized = false;
  }

  private async syncShortcut(lifecycle: number): Promise<void> {
    if (lifecycle !== this.lifecycle) return;
    try {
      await syncMainWindowShortcutSelectionWithRuntime({ notify: false });
    } catch (error) {
      if (lifecycle === this.lifecycle) console.warn('[main-window-shortcut] registration failed; settings can retry', error);
    }
  }

  private subscribeSelectionStorageChanges(lifecycle: number): () => void {
    if (typeof window === 'undefined') {
      return () => {};
    }

    const handleStorage = (event: StorageEvent) => {
      if (lifecycle !== this.lifecycle || event.key !== MAIN_WINDOW_SHORTCUT_SELECTION_STORAGE_KEY) {
        return;
      }
      void syncMainWindowShortcutSelectionWithRuntime({
        notify: false,
        selection: getMainWindowShortcutSelection(),
      }).catch((error) => {
        if (lifecycle === this.lifecycle) console.warn('[main-window-shortcut] selection sync failed', error);
      });
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }

  private async handleShortcutActivated(lifecycle: number): Promise<void> {
    if (lifecycle !== this.lifecycle || !this.quickFocusEnabled) {
      return;
    }

    await navigateToEventlogRecord();
    if (lifecycle !== this.lifecycle) return;
    requestMainWindowFocusTarget(MAIN_WINDOW_FOCUS_TARGET_EVENTLOG_RECORD_INPUT);
  }

  private async consumePendingActivation(lifecycle: number): Promise<void> {
    if (lifecycle !== this.lifecycle) return;
    const pendingActivation = await takePendingMainWindowShortcutActivation();
    if (lifecycle !== this.lifecycle || !pendingActivation) {
      return;
    }

    await this.handleShortcutActivated(lifecycle);
  }
}

let instance: MainWindowShortcutService | null = null;

export function getMainWindowShortcutService(): MainWindowShortcutService {
  if (!instance) {
    instance = new MainWindowShortcutService();
  }
  return instance;
}

export async function initMainWindowShortcutService(): Promise<void> {
  await getMainWindowShortcutService().init();
}
