import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  captureQuickExitShortcut,
  getQuickExitShortcut,
  getQuickExitShortcutScope,
  parseQuickExitAccelerator,
  parseQuickExitShortcutScope,
  resolveQuickExitShortcutStatus,
  setQuickExitShortcut,
  setQuickExitShortcutScope,
  type QuickExitShortcutBinding,
  type QuickExitShortcutScope,
  type QuickExitShortcutStatus,
} from '@/config/quick-exit-shortcut';
import { shortcutAcceleratorsEqual } from '@/config/shortcut-accelerator';
import { getVoiceShortcutHotkey } from '@/config/voice-shortcut-hotkey';
import { getResolvedMainWindowShortcutHotkey } from '@/config/main-window-shortcut';

const QUICK_EXIT_BINDING_CHANGED_EVENT = 'quick-exit-shortcut-binding-changed';
const APP_ONLY_CAPTURE_MARKER = '[data-quick-exit-capture-active="true"]';

export type QuickExitRequestCommand = 'app_request_exit' | 'beta_request_exit';
export type QuickExitBindingSource = 'persisted-settings' | 'native-runtime';
export type QuickExitShortcutRuntimeOptions = {
  exitCommand: QuickExitRequestCommand;
  bindingSource?: QuickExitBindingSource;
};

type SyncQuickExitShortcutOptions = {
  hotkey?: string | null;
  scope?: QuickExitShortcutScope;
};

type ParsedQuickExitBinding = {
  binding: QuickExitShortcutBinding;
  supportsScope: boolean;
};

let quickExitSyncTail: Promise<unknown> = Promise.resolve();
let nativeBinding: QuickExitShortcutBinding | null = null;
let nativeBindingRevision = 0;
let nativeBindingListener: Promise<void> | null = null;
let localShortcutWindow: Window | null = null;
let localShortcutKeydown: ((event: KeyboardEvent) => void) | null = null;
let localExitCommand: QuickExitRequestCommand = 'app_request_exit';

function parseRuntimeBinding(value: unknown): ParsedQuickExitBinding | null {
  if (value && typeof value === 'object') {
    const item = value as { shortcut?: unknown; scope?: unknown };
    const scope = parseQuickExitShortcutScope(
      typeof item.scope === 'string' ? item.scope : undefined,
    );
    const shortcut = item.shortcut === null
      ? null
      : typeof item.shortcut === 'string'
        ? parseQuickExitAccelerator(item.shortcut)
        : undefined;
    if (!scope || shortcut === undefined || (item.shortcut !== null && shortcut === null)) {
      return null;
    }
    return { binding: { shortcut, scope }, supportsScope: true };
  }

  // Older runtimes return only the hotkey. That contract means global scope.
  if (value === null) {
    return {
      binding: { shortcut: null, scope: 'system-global' },
      supportsScope: false,
    };
  }
  if (typeof value === 'string') {
    const shortcut = parseQuickExitAccelerator(value);
    if (!shortcut) return null;
    return {
      binding: { shortcut, scope: 'system-global' },
      supportsScope: false,
    };
  }

  return null;
}

function publishNativeBinding(binding: QuickExitShortcutBinding): void {
  nativeBinding = binding;
  nativeBindingRevision += 1;
}

async function readNativeBinding(): Promise<ParsedQuickExitBinding> {
  const value = await invoke<unknown>('quick_exit_shortcut_get');
  const parsed = parseRuntimeBinding(value);
  if (!parsed) throw new Error('当前运行时未返回有效的快速退出快捷键状态。');
  return parsed;
}

function listenForNativeBindingChanges(): Promise<void> {
  if (nativeBindingListener) return nativeBindingListener;

  const pending = listen<unknown>(QUICK_EXIT_BINDING_CHANGED_EVENT, (event) => {
    const parsed = parseRuntimeBinding(event.payload);
    if (parsed?.supportsScope) publishNativeBinding(parsed.binding);
  }).then(() => undefined);
  let tracked: Promise<void>;
  tracked = pending.catch((error) => {
    if (nativeBindingListener === tracked) nativeBindingListener = null;
    throw error;
  });
  nativeBindingListener = tracked;
  return tracked;
}

function installAppOnlyShortcutHandler(exitCommand: QuickExitRequestCommand): void {
  if (typeof window === 'undefined') return;
  localExitCommand = exitCommand;
  if (localShortcutWindow === window && localShortcutKeydown) return;

  if (localShortcutWindow && localShortcutKeydown) {
    localShortcutWindow.removeEventListener('keydown', localShortcutKeydown, true);
  }

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof Element && target.closest(APP_ONLY_CAPTURE_MARKER)) return;

    const binding = nativeBinding;
    if (!binding || binding.scope !== 'app-only' || !binding.shortcut) return;
    const captured = captureQuickExitShortcut(event);
    if (
      captured.kind !== 'captured'
      || !shortcutAcceleratorsEqual(captured.accelerator, binding.shortcut)
    ) {
      return;
    }

    // The listener is attached to this WebView only; it never reserves the
    // chord in the operating system. Suppress repeated keydown events while
    // preserving the existing one-request-per-press exit lifecycle.
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    void invoke(localExitCommand).catch((error) => {
      console.error('[quick-exit-shortcut] app-only exit request failed', error);
    });
  };

  localShortcutWindow = window;
  localShortcutKeydown = handleKeydown;
  window.addEventListener('keydown', handleKeydown, true);
}

function enqueueQuickExitSync<T>(operation: () => Promise<T>): Promise<T> {
  const next = quickExitSyncTail.then(operation, operation);
  quickExitSyncTail = next.then(() => undefined, () => undefined);
  return next;
}

async function syncQuickExitShortcut(
  options: SyncQuickExitShortcutOptions,
): Promise<QuickExitShortcutStatus> {
  const previousBinding: QuickExitShortcutBinding = {
    shortcut: getQuickExitShortcut(),
    scope: getQuickExitShortcutScope(),
  };
  const rawHotkey = options.hotkey === undefined ? previousBinding.shortcut : options.hotkey;
  const hotkey = rawHotkey === null ? null : parseQuickExitAccelerator(rawHotkey);
  const scope = options.scope ?? previousBinding.scope;
  if (rawHotkey !== null && hotkey === null) {
    throw new Error('无效的快捷键组合。');
  }

  const status = resolveQuickExitShortcutStatus(
    hotkey,
    getVoiceShortcutHotkey(),
    getResolvedMainWindowShortcutHotkey(),
  );
  if (status.kind === 'conflict') throw new Error(status.message);

  if (!await isTauri()) {
    setQuickExitShortcut(hotkey, { emitEvent: false });
    setQuickExitShortcutScope(scope, { emitEvent: false });
    publishNativeBinding({ shortcut: hotkey, scope });
    return status;
  }

  // Older native versions cannot distinguish app-only from system-global.
  // Refuse the scoped write before registering anything in that case.
  if (scope === 'app-only') {
    const current = await readNativeBinding();
    if (!current.supportsScope) {
      throw new Error('当前运行时不支持“仅外心内”快捷键作用域，请更新运行时后重试；现有绑定未更改。');
    }
  }

  try {
    const value = await invoke<unknown>('quick_exit_shortcut_set', {
      shortcut: hotkey,
      scope,
    });
    const parsed = parseRuntimeBinding(value);
    let applied: QuickExitShortcutBinding | null = parsed?.binding ?? null;
    if (!applied && scope === 'system-global' && (value === null || typeof value === 'string')) {
      const legacyShortcut = value === null ? null : parseQuickExitAccelerator(value);
      if (value === null || legacyShortcut) {
        applied = { shortcut: legacyShortcut, scope: 'system-global' };
      }
    }
    if (
      !applied
      || applied.shortcut !== hotkey
      || applied.scope !== scope
    ) {
      throw new Error('运行时未确认所请求的快速退出快捷键与作用范围。');
    }

    setQuickExitShortcut(applied.shortcut, { emitEvent: false });
    setQuickExitShortcutScope(applied.scope, { emitEvent: false });
    publishNativeBinding(applied);
    return applied.shortcut
      ? { kind: 'valid', hotkey: applied.shortcut }
      : { kind: 'unassigned' };
  } catch (error) {
    const current = await readNativeBinding().catch(() => null);
    const restored = current?.binding ?? previousBinding;
    setQuickExitShortcut(restored.shortcut, { emitEvent: false });
    setQuickExitShortcutScope(restored.scope, { emitEvent: false });
    if (current) publishNativeBinding(restored);
    if (current && current.binding.shortcut === hotkey && current.binding.scope === scope) {
      return current.binding.shortcut
        ? { kind: 'valid', hotkey: current.binding.shortcut }
        : { kind: 'unassigned' };
    }
    throw error;
  }
}

export function syncQuickExitShortcutWithRuntime(
  options: SyncQuickExitShortcutOptions = {},
): Promise<QuickExitShortcutStatus> {
  return enqueueQuickExitSync(() => syncQuickExitShortcut(options));
}

export async function initQuickExitShortcutRuntime({
  exitCommand,
  bindingSource = 'persisted-settings',
}: QuickExitShortcutRuntimeOptions): Promise<void> {
  if (!await isTauri()) {
    await syncQuickExitShortcutWithRuntime();
    return;
  }

  installAppOnlyShortcutHandler(exitCommand);
  try {
    await listenForNativeBindingChanges();
  } catch (error) {
    console.warn('[quick-exit-shortcut] binding updates from other windows are unavailable', error);
  }

  if (bindingSource === 'native-runtime') {
    const revision = nativeBindingRevision;
    try {
      const current = await readNativeBinding();
      if (nativeBindingRevision === revision) publishNativeBinding(current.binding);
    } catch (error) {
      console.warn('[quick-exit-shortcut] saved native binding could not be read', error);
    }
    return;
  }

  try {
    await syncQuickExitShortcutWithRuntime();
  } catch (error) {
    console.warn('[quick-exit-shortcut] registration failed; settings can retry', error);
  }
}
