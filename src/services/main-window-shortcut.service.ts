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
import { buildTasksMainSearch } from '@/ui/app/pages/task-route-memory';
import { getEventlogPathForTab } from '@/ui/app/pages/eventlog-route-memory';

export const MAIN_WINDOW_SHORTCUT_EVENT_NAME = 'main-window-shortcut';
export const MAIN_WINDOW_FOCUS_TARGET_EVENTLOG_RECORD_INPUT = 'eventlog-record-input';
export const MAIN_WINDOW_FOCUS_TARGET_TASKS_QUICK_ADD_INPUT = 'tasks-quick-add-input';

type RouterLocationSnapshot = {
  pathname: string;
  searchStr: string;
};

function getRouterLocationSnapshot(): RouterLocationSnapshot {
  const location = appRouter.state.location;
  return {
    pathname: location.pathname,
    searchStr: location.searchStr ?? '',
  };
}

async function navigateToEventlogRecord(): Promise<void> {
  await appRouter.navigate({
    to: getEventlogPathForTab('record'),
  });
}

async function navigateToTasksMain(): Promise<void> {
  await appRouter.navigate({
    to: '/tasks',
    search: buildTasksMainSearch(),
  });
}

export class MainWindowShortcutService {
  private initialized = false;
  private unlistenEvent: (() => void) | null = null;
  private unlistenVoiceShortcut: (() => void) | null = null;
  private unlistenQuickFocus: (() => void) | null = null;
  private unlistenSelection: (() => void) | null = null;
  private quickFocusEnabled = getMainWindowShortcutQuickFocusEnabled();

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!await isTauri()) {
      return;
    }

    this.initialized = true;
    await syncMainWindowShortcutSelectionWithRuntime({ notify: false });

    this.unlistenVoiceShortcut = subscribeVoiceShortcutHotkeyChanges(() => {
      void syncMainWindowShortcutSelectionWithRuntime({ notify: false });
    });
    this.unlistenSelection = this.subscribeSelectionStorageChanges();
    this.unlistenQuickFocus = subscribeMainWindowShortcutQuickFocusChanges((enabled) => {
      this.quickFocusEnabled = enabled;
    });
    this.unlistenEvent = await listen(MAIN_WINDOW_SHORTCUT_EVENT_NAME, async () => {
      await this.consumePendingActivation();
    });
    await this.consumePendingActivation();
  }

  destroy(): void {
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

  private subscribeSelectionStorageChanges(): () => void {
    if (typeof window === 'undefined') {
      return () => {};
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== MAIN_WINDOW_SHORTCUT_SELECTION_STORAGE_KEY) {
        return;
      }
      void syncMainWindowShortcutSelectionWithRuntime({
        notify: false,
        selection: getMainWindowShortcutSelection(),
      });
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }

  private async handleShortcutActivated(): Promise<void> {
    if (!this.quickFocusEnabled) {
      return;
    }

    const location = getRouterLocationSnapshot();
    if (location.pathname === '/' || location.pathname.startsWith('/eventlog')) {
      await navigateToEventlogRecord();
      requestMainWindowFocusTarget(MAIN_WINDOW_FOCUS_TARGET_EVENTLOG_RECORD_INPUT);
      return;
    }

    if (location.pathname === '/tasks') {
      requestMainWindowFocusTarget(MAIN_WINDOW_FOCUS_TARGET_TASKS_QUICK_ADD_INPUT);
      return;
    }

    if (location.pathname.startsWith('/tasks/')) {
      await navigateToTasksMain();
      requestMainWindowFocusTarget(MAIN_WINDOW_FOCUS_TARGET_TASKS_QUICK_ADD_INPUT);
      return;
    }
  }

  private async consumePendingActivation(): Promise<void> {
    const pendingActivation = await takePendingMainWindowShortcutActivation();
    if (!pendingActivation) {
      return;
    }

    await this.handleShortcutActivated();
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
