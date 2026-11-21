import { invoke, isTauri } from '@tauri-apps/api/core';
import { getVoiceShortcutHotkey } from '@/config/voice-shortcut-hotkey';
import { getResolvedMainWindowShortcutHotkey } from '@/config/main-window-shortcut';
import {
  getQuickExitShortcut,
  parseQuickExitAccelerator,
  resolveQuickExitShortcutStatus,
  setQuickExitShortcut,
  type QuickExitShortcutStatus,
} from '@/config/quick-exit-shortcut';

type SyncQuickExitShortcutOptions = {
  hotkey?: string | null;
};

export async function syncQuickExitShortcutWithRuntime(
  options: SyncQuickExitShortcutOptions = {},
): Promise<QuickExitShortcutStatus> {
  const rawHotkey = options.hotkey === undefined ? getQuickExitShortcut() : options.hotkey;
  const hotkey = rawHotkey === null ? null : parseQuickExitAccelerator(rawHotkey);
  if (rawHotkey !== null && hotkey === null) {
    throw new Error('无效的快捷键组合。');
  }

  const status = resolveQuickExitShortcutStatus(
    hotkey,
    getVoiceShortcutHotkey(),
    getResolvedMainWindowShortcutHotkey(),
  );

  // A conflict is rejected before persistence or OS registration, so the
  // current binding is never disrupted and success is never claimed.
  if (status.kind === 'conflict') {
    throw new Error(status.message);
  }

  if (!await isTauri()) {
    setQuickExitShortcut(hotkey, { emitEvent: false });
    return status;
  }

  try {
    const applied = await invoke<string | null>('quick_exit_shortcut_set', {
      shortcut: hotkey,
    });
    setQuickExitShortcut(applied, { emitEvent: false });
    return applied ? { kind: 'valid', hotkey: applied } : { kind: 'unassigned' };
  } catch (error) {
    const runtimeHotkey = await invoke<string | null>('quick_exit_shortcut_get')
      .catch(() => getQuickExitShortcut());
    setQuickExitShortcut(runtimeHotkey, { emitEvent: false });
    throw error;
  }
}

export function initQuickExitShortcutRuntime(): Promise<void> {
  return syncQuickExitShortcutWithRuntime()
    .then(() => undefined)
    .catch((error) => {
      console.warn('[quick-exit-shortcut] registration failed; settings can retry', error);
    });
}
