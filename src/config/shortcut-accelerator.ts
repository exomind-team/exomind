/**
 * Shared accelerator capture/normalization used by shortcut settings.
 *
 * The capture field feeds raw KeyboardEvent data here; consumers provide a
 * policy (allowed modifiers/keys, extra reserved chords) and receive either a
 * canonical accelerator such as `Ctrl+Alt+X` or a typed rejection.
 */

export type ShortcutModifier = 'Ctrl' | 'Alt' | 'Shift' | 'Cmd';

export type ShortcutKeyEventLike = {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
};

export type ShortcutCapturePolicy = {
  /** Modifiers this consumer accepts. Cmd is only effective on macOS. */
  allowedModifiers?: readonly ShortcutModifier[];
  /** Primary-key predicate; defaults to letters, digits, F1-F12, and Space. */
  isAllowedPrimaryKey?: (key: string) => boolean;
  /** Extra canonical accelerators rejected by this consumer. */
  reservedAccelerators?: readonly string[];
};

export type ShortcutCaptureResult =
  | { kind: 'cancelled' }
  | { kind: 'cleared' }
  | { kind: 'modifier-only' }
  | { kind: 'ignored' }
  | { kind: 'lone-key'; key: string }
  | { kind: 'meta-reserved' }
  | { kind: 'reserved'; message: string }
  | { kind: 'captured'; accelerator: string };

const ALL_MODIFIERS: readonly ShortcutModifier[] = ['Cmd', 'Ctrl', 'Alt', 'Shift'];
const MAC_CMD_TAB_RESERVED_MESSAGE = 'Cmd+Tab 是 macOS 应用切换组合。';

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent ?? '');
}

export function isDefaultShortcutPrimaryKey(key: string): boolean {
  if (key === 'Space') return true;
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) return true;
  return /^[A-Z0-9]$/.test(key);
}

function resolveAllowedModifiers(policy: ShortcutCapturePolicy): ShortcutModifier[] {
  const requested = policy.allowedModifiers ?? ALL_MODIFIERS;
  const mac = isMacPlatform();
  return requested.filter((modifier) => modifier !== 'Cmd' || mac);
}

export function shortcutModifierHint(policy: ShortcutCapturePolicy = {}): string {
  return resolveAllowedModifiers(policy)
    .map((modifier) => modifier === 'Cmd' ? 'Command' : modifier)
    .join(' / ');
}

function normalizePrimaryKey(event: ShortcutKeyEventLike): string | null {
  if (event.isComposing) return null;
  const code = event.code ?? '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
  if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
  if (code === 'Space') return 'Space';
  return null;
}

export function isShortcutAcceleratorReserved(
  accelerator: string,
  policy: ShortcutCapturePolicy = {},
): string | null {
  const normalized = accelerator.replace(/\s+/g, '').toLowerCase();
  if (isMacPlatform()) {
    if (normalized === 'cmd+tab') return MAC_CMD_TAB_RESERVED_MESSAGE;
    if (normalized === 'cmd+space') return 'Cmd+Space 是 macOS Spotlight 组合。';
  } else {
    if (normalized === 'ctrl+alt+delete') return 'Ctrl+Alt+Delete 是 Windows 系统保留组合。';
    if (normalized === 'ctrl+shift+escape') return 'Ctrl+Shift+Escape 是 Windows 任务管理器组合。';
    if (normalized === 'alt+f4') return 'Alt+F4 是 Windows 系统关闭窗口组合。';
  }

  for (const reserved of policy.reservedAccelerators ?? []) {
    if (normalized === reserved.replace(/\s+/g, '').toLowerCase()) {
      return `${accelerator} 是保留组合。`;
    }
  }

  return null;
}

export function captureShortcutAccelerator(
  event: ShortcutKeyEventLike,
  policy: ShortcutCapturePolicy = {},
): ShortcutCaptureResult {
  if (event.isComposing) return { kind: 'ignored' };

  const key = event.key ?? '';
  if (MODIFIER_KEYS.has(key)) return { kind: 'modifier-only' };
  if (key === 'Escape' || key === 'Esc') return { kind: 'cancelled' };
  if (key === 'Backspace' || key === 'Delete') return { kind: 'cleared' };
  if (isMacPlatform() && event.metaKey && (key === 'Tab' || event.code === 'Tab')) {
    return { kind: 'reserved', message: MAC_CMD_TAB_RESERVED_MESSAGE };
  }

  const allowedModifiers = resolveAllowedModifiers(policy);
  const pressedModifiers: ShortcutModifier[] = [];
  if (event.metaKey) pressedModifiers.push('Cmd');
  if (event.ctrlKey) pressedModifiers.push('Ctrl');
  if (event.altKey) pressedModifiers.push('Alt');
  if (event.shiftKey) pressedModifiers.push('Shift');

  if (pressedModifiers.includes('Cmd') && !allowedModifiers.includes('Cmd')) {
    return { kind: 'meta-reserved' };
  }
  if (pressedModifiers.some((modifier) => !allowedModifiers.includes(modifier))) {
    return { kind: 'ignored' };
  }

  const primaryKey = normalizePrimaryKey(event);
  if (primaryKey === null) return { kind: 'ignored' };
  const isAllowedPrimaryKey = policy.isAllowedPrimaryKey ?? isDefaultShortcutPrimaryKey;
  if (!isAllowedPrimaryKey(primaryKey)) return { kind: 'ignored' };
  if (pressedModifiers.length === 0) return { kind: 'lone-key', key: primaryKey };

  const accelerator = [...pressedModifiers, primaryKey].join('+');
  const reservedReason = isShortcutAcceleratorReserved(accelerator, policy);
  if (reservedReason) return { kind: 'reserved', message: reservedReason };

  return { kind: 'captured', accelerator };
}

export function parseShortcutAccelerator(
  accelerator: string | null | undefined,
  policy: ShortcutCapturePolicy = {},
): string | null {
  if (!accelerator) return null;

  const tokens = accelerator
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const allowedModifiers = resolveAllowedModifiers(policy);
  const isAllowedPrimaryKey = policy.isAllowedPrimaryKey ?? isDefaultShortcutPrimaryKey;
  const seenModifiers = new Set<ShortcutModifier>();
  let primaryKey: string | null = null;

  for (const token of tokens) {
    const upper = token.toUpperCase();
    const modifier = (() => {
      if (upper === 'CTRL' || upper === 'CONTROL') return 'Ctrl' as const;
      if (upper === 'ALT' || upper === 'OPTION') return 'Alt' as const;
      if (upper === 'SHIFT') return 'Shift' as const;
      if (upper === 'CMD' || upper === 'COMMAND' || upper === 'SUPER') return 'Cmd' as const;
      return null;
    })();

    if (modifier) {
      if (!allowedModifiers.includes(modifier)) return null;
      if (seenModifiers.has(modifier)) return null;
      seenModifiers.add(modifier);
      continue;
    }

    if (
      upper === 'META' || upper === 'COMMANDORCONTROL' || upper === 'CMDORCTRL'
      || upper === 'COMMANDORCTRL' || upper === 'CMDORCONTROL'
    ) {
      return null;
    }
    if (primaryKey !== null) return null;

    const normalized =
      upper === 'SPACE' ? 'Space' : (/^[A-Z0-9]$/.test(upper) || /^F(?:[1-9]|1[0-2])$/.test(upper) ? upper : null);
    if (normalized === null || !isAllowedPrimaryKey(normalized)) return null;
    primaryKey = normalized;
  }

  if (primaryKey === null || seenModifiers.size === 0) return null;

  const modifiers = ALL_MODIFIERS.filter((modifier) => seenModifiers.has(modifier));
  const canonical = [...modifiers, primaryKey].join('+');
  if (isShortcutAcceleratorReserved(canonical, policy)) return null;
  return canonical;
}

export function shortcutAcceleratorsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) return !left && !right;
  return left.toLowerCase() === right.toLowerCase();
}
