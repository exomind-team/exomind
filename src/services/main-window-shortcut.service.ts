import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { appRouter } from '@/routes';
import {
  getMainWindowShortcutQuickFocusEnabled,
  subscribeMainWindowShortcutQuickFocusChanges,
} from '@/config/main-window-shortcut-focus';
import { subscribeVoiceShortcutHotkeyChanges } from '@/config/voice-shortcut-hotkey';
import { requestMainWindowFocusTarget } from '@/services/main-window-focus-targets';
import { syncMainWindowShortcutSelectionWithRuntime } from '@/services/main-window-shortcut-runtime';
import { buildTasksMainSearch } from '@/ui/app/pages/task-route-memory';

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
    to: '/eventlog',
    search: { tab: 'record' },
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
    this.unlistenQuickFocus = subscribeMainWindowShortcutQuickFocusChanges((enabled) => {
      this.quickFocusEnabled = enabled;
    });
    this.unlistenEvent = await listen(MAIN_WINDOW_SHORTCUT_EVENT_NAME, async () => {
      await this.handleShortcutActivated();
    });
  }

  destroy(): void {
    this.unlistenEvent?.();
    this.unlistenEvent = null;
    this.unlistenVoiceShortcut?.();
    this.unlistenVoiceShortcut = null;
    this.unlistenQuickFocus?.();
    this.unlistenQuickFocus = null;
    this.initialized = false;
  }

  private async handleShortcutActivated(): Promise<void> {
    if (!this.quickFocusEnabled) {
      return;
    }

    const location = getRouterLocationSnapshot();
    if (location.pathname === '/' || location.pathname === '/eventlog') {
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
    }
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
