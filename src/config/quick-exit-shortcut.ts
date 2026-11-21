import {
  getRuntimeConfigValueSync,
  removeRuntimeConfigValue,
  setRuntimeConfigValue,
} from './runtime-config-cache';
import {
  captureShortcutAccelerator,
  parseShortcutAccelerator,
  shortcutAcceleratorsEqual,
  type ShortcutCapturePolicy,
  type ShortcutCaptureResult,
  type ShortcutKeyEventLike,
} from './shortcut-accelerator';

const QUICK_EXIT_SHORTCUT_STORAGE_KEY = 'exomind:quickExitShortcut';
const QUICK_EXIT_SHORTCUT_CHANGED_EVENT = 'exomind:quick-exit-shortcut-changed';

export const QUICK_EXIT_SHORTCUT_POLICY: ShortcutCapturePolicy = {
  allowedModifiers: ['Cmd', 'Ctrl', 'Alt', 'Shift'],
};

export type QuickExitShortcutCaptureResult = ShortcutCaptureResult;
export type { ShortcutKeyEventLike };

export type QuickExitShortcutStatus =
  | { kind: 'unassigned' }
  | { kind: 'valid'; hotkey: string }
  | { kind: 'conflict'; message: string };

export function captureQuickExitShortcut(
  event: ShortcutKeyEventLike,
): QuickExitShortcutCaptureResult {
  return captureShortcutAccelerator(event, QUICK_EXIT_SHORTCUT_POLICY);
}

export function parseQuickExitAccelerator(
  accelerator: string | null | undefined,
): string | null {
  return parseShortcutAccelerator(accelerator, QUICK_EXIT_SHORTCUT_POLICY);
}

export function getQuickExitShortcut(): string | null {
  return parseQuickExitAccelerator(
    getRuntimeConfigValueSync(QUICK_EXIT_SHORTCUT_STORAGE_KEY),
  );
}

export function setQuickExitShortcut(
  hotkey: string | null,
  options: { emitEvent?: boolean } = {},
): string | null {
  const normalized = hotkey === null ? null : parseQuickExitAccelerator(hotkey);
  if (typeof window === 'undefined') return normalized;

  if (normalized === null) {
    removeRuntimeConfigValue(QUICK_EXIT_SHORTCUT_STORAGE_KEY);
  } else {
    setRuntimeConfigValue(QUICK_EXIT_SHORTCUT_STORAGE_KEY, normalized, {
      source: QUICK_EXIT_SHORTCUT_CHANGED_EVENT,
      sourceOrigin: window.location?.origin,
    });
  }

  if (options.emitEvent !== false) {
    window.dispatchEvent(new CustomEvent<string | null>(
      QUICK_EXIT_SHORTCUT_CHANGED_EVENT,
      { detail: normalized },
    ));
  }

  return normalized;
}

export function resolveQuickExitShortcutStatus(
  hotkey: string | null,
  voiceHotkey?: string | null,
  mainWindowHotkey?: string | null,
): QuickExitShortcutStatus {
  if (hotkey === null) return { kind: 'unassigned' };

  if (voiceHotkey && shortcutAcceleratorsEqual(hotkey, voiceHotkey)) {
    return {
      kind: 'conflict',
      message: `与全局语音快捷键 ${voiceHotkey} 冲突。`,
    };
  }

  if (mainWindowHotkey && shortcutAcceleratorsEqual(hotkey, mainWindowHotkey)) {
    return {
      kind: 'conflict',
      message: `与主窗口快捷键 ${mainWindowHotkey} 冲突。`,
    };
  }

  return { kind: 'valid', hotkey };
}

export function subscribeQuickExitShortcutChanges(
  listener: (hotkey: string | null) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== QUICK_EXIT_SHORTCUT_STORAGE_KEY) return;
    listener(parseQuickExitAccelerator(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<string | null>;
    listener(parseQuickExitAccelerator(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(QUICK_EXIT_SHORTCUT_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(QUICK_EXIT_SHORTCUT_CHANGED_EVENT, handleCustomEvent);
  };
}