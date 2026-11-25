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
const QUICK_EXIT_SHORTCUT_SCOPE_STORAGE_KEY = 'exomind:quickExitShortcutScope';
const QUICK_EXIT_SHORTCUT_SCOPE_CHANGED_EVENT = 'exomind:quick-exit-shortcut-scope-changed';

export const QUICK_EXIT_SHORTCUT_SCOPE_VALUES = ['app-only', 'system-global'] as const;
export type QuickExitShortcutScope = (typeof QUICK_EXIT_SHORTCUT_SCOPE_VALUES)[number];
export interface QuickExitShortcutBinding {
  shortcut: string | null;
  scope: QuickExitShortcutScope;
}

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

export function parseQuickExitShortcutScope(
  rawValue: string | null | undefined,
): QuickExitShortcutScope | null {
  return QUICK_EXIT_SHORTCUT_SCOPE_VALUES.includes(rawValue as QuickExitShortcutScope)
    ? rawValue as QuickExitShortcutScope
    : null;
}

/**
 * A saved legacy binding was global. New or unassigned bindings default to
 * app-only so adding a shortcut cannot silently affect another application.
 */
export function getQuickExitShortcutScope(): QuickExitShortcutScope {
  const stored = parseQuickExitShortcutScope(
    getRuntimeConfigValueSync(QUICK_EXIT_SHORTCUT_SCOPE_STORAGE_KEY),
  );
  if (stored) return stored;
  return getQuickExitShortcut() ? 'system-global' : 'app-only';
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

export function setQuickExitShortcutScope(
  scope: QuickExitShortcutScope,
  options: { emitEvent?: boolean } = {},
): QuickExitShortcutScope {
  const normalized = parseQuickExitShortcutScope(scope);
  if (!normalized) throw new Error('快速退出快捷键作用范围无效。');
  if (typeof window === 'undefined') return normalized;

  setRuntimeConfigValue(QUICK_EXIT_SHORTCUT_SCOPE_STORAGE_KEY, normalized, {
    source: QUICK_EXIT_SHORTCUT_SCOPE_CHANGED_EVENT,
    sourceOrigin: window.location?.origin,
  });
  if (options.emitEvent !== false) {
    window.dispatchEvent(new CustomEvent<QuickExitShortcutScope>(
      QUICK_EXIT_SHORTCUT_SCOPE_CHANGED_EVENT,
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

export function subscribeQuickExitShortcutScopeChanges(
  listener: (scope: QuickExitShortcutScope) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const publish = (rawValue: string | null | undefined) => {
    listener(parseQuickExitShortcutScope(rawValue) ?? getQuickExitShortcutScope());
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === QUICK_EXIT_SHORTCUT_SCOPE_STORAGE_KEY) publish(event.newValue);
  };
  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<QuickExitShortcutScope>;
    publish(customEvent.detail);
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(QUICK_EXIT_SHORTCUT_SCOPE_CHANGED_EVENT, handleCustomEvent);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(QUICK_EXIT_SHORTCUT_SCOPE_CHANGED_EVENT, handleCustomEvent);
  };
}
