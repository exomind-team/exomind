import { invoke, isTauri } from '@tauri-apps/api/core';
import { toast } from '@/components/ui/toast-hook';
import {
  getMainWindowShortcutSelection,
  setMainWindowShortcutSelection,
  validateMainWindowShortcutSelection,
  type MainWindowShortcutSelection,
  type MainWindowShortcutValidationResult,
} from '@/config/main-window-shortcut';
import { getVoiceShortcutHotkey } from '@/config/voice-shortcut-hotkey';

type SyncMainWindowShortcutOptions = {
  notify?: boolean;
  selection?: MainWindowShortcutSelection;
};

type MainWindowShortcutRuntimeStatus = MainWindowShortcutValidationResult;

function showRuntimeToast(status: MainWindowShortcutRuntimeStatus): void {
  if (status.kind === 'valid') {
    return;
  }

  toast({
    title: '主窗口快捷键未启用',
    description: status.message,
    variant: 'destructive',
  });
}

async function applyMainWindowShortcutToRuntime(hotkey: string | null): Promise<void> {
  if (!await isTauri()) {
    return;
  }

  await invoke('main_window_shortcut_set', { shortcut: hotkey });
}

export async function takePendingMainWindowShortcutActivation(): Promise<boolean> {
  if (!await isTauri()) {
    return false;
  }

  return invoke<boolean>('main_window_shortcut_take_pending_activation');
}

export async function syncMainWindowShortcutSelectionWithRuntime(
  options: SyncMainWindowShortcutOptions = {},
): Promise<MainWindowShortcutRuntimeStatus> {
  const selection = options.selection ?? getMainWindowShortcutSelection();
  const voiceHotkey = getVoiceShortcutHotkey();
  const status = validateMainWindowShortcutSelection(selection, voiceHotkey);

  if (!options.selection) {
    setMainWindowShortcutSelection(selection, { emitEvent: false, customized: false });
  }

  if (status.kind !== 'valid') {
    await applyMainWindowShortcutToRuntime(null);
    if (options.notify !== false) {
      showRuntimeToast(status);
    }
    return status;
  }

  await applyMainWindowShortcutToRuntime(status.hotkey);
  return status;
}
