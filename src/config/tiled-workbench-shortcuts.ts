import { createConfigModule } from './config-factory';

export const TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME_STORAGE_KEY =
  'exomind:tiledWorkbenchNavigationShortcutScheme';
export const TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME_CHANGED_EVENT =
  'exomind:tiledWorkbenchNavigationShortcutSchemeChanged';

export const TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME_STORAGE_KEY =
  'exomind:tiledWorkbenchCommandShortcutScheme';
export const TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME_CHANGED_EVENT =
  'exomind:tiledWorkbenchCommandShortcutSchemeChanged';

export const TILED_WORKBENCH_PASSTHROUGH_SHORTCUT_STORAGE_KEY =
  'exomind:tiledWorkbenchPassthroughShortcut';
export const TILED_WORKBENCH_PASSTHROUGH_SHORTCUT_CHANGED_EVENT =
  'exomind:tiledWorkbenchPassthroughShortcutChanged';

export const TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME_VALUES = [
  'alt-shift-arrows',
  'alt-arrows',
  'disabled',
] as const;

export const TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME_VALUES = [
  'alt-shift-letters',
  'alt-letters',
  'disabled',
] as const;

export const TILED_WORKBENCH_PASSTHROUGH_SHORTCUT_VALUES = [
  'Alt+Shift+P',
  'Alt+P',
  'Disabled',
] as const;

export type TiledWorkbenchNavigationShortcutScheme =
  (typeof TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME_VALUES)[number];

export type TiledWorkbenchCommandShortcutScheme =
  (typeof TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME_VALUES)[number];

export type TiledWorkbenchPassthroughShortcut =
  (typeof TILED_WORKBENCH_PASSTHROUGH_SHORTCUT_VALUES)[number];

export interface ResolvedTiledWorkbenchShortcuts {
  focusLeft: string | null;
  focusRight: string | null;
  focusUp: string | null;
  focusDown: string | null;
  splitHorizontal: string | null;
  splitVertical: string | null;
  clearSlot: string | null;
  closeSlot: string | null;
  openSlotEntry: string | null;
  passthroughTrigger: string | null;
}

export interface KeyboardShortcutLike {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export const DEFAULT_TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME:
  TiledWorkbenchNavigationShortcutScheme = 'alt-shift-arrows';
export const DEFAULT_TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME:
  TiledWorkbenchCommandShortcutScheme = 'alt-shift-letters';
export const DEFAULT_TILED_WORKBENCH_PASSTHROUGH_SHORTCUT:
  TiledWorkbenchPassthroughShortcut = 'Alt+Shift+P';

const CANONICAL_SPECIAL_KEYS = new Map<string, string>([
  ['arrowleft', 'ArrowLeft'],
  ['arrowright', 'ArrowRight'],
  ['arrowup', 'ArrowUp'],
  ['arrowdown', 'ArrowDown'],
  ['enter', 'Enter'],
  ['backspace', 'Backspace'],
]);

function normalizeNavigationShortcutScheme(
  rawValue: string | null | undefined,
): TiledWorkbenchNavigationShortcutScheme {
  return TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME_VALUES.includes(
    rawValue as TiledWorkbenchNavigationShortcutScheme,
  )
    ? rawValue as TiledWorkbenchNavigationShortcutScheme
    : DEFAULT_TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME;
}

function normalizeCommandShortcutScheme(
  rawValue: string | null | undefined,
): TiledWorkbenchCommandShortcutScheme {
  return TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME_VALUES.includes(
    rawValue as TiledWorkbenchCommandShortcutScheme,
  )
    ? rawValue as TiledWorkbenchCommandShortcutScheme
    : DEFAULT_TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME;
}

function normalizePassthroughShortcut(
  rawValue: string | null | undefined,
): TiledWorkbenchPassthroughShortcut {
  return TILED_WORKBENCH_PASSTHROUGH_SHORTCUT_VALUES.includes(
    rawValue as TiledWorkbenchPassthroughShortcut,
  )
    ? rawValue as TiledWorkbenchPassthroughShortcut
    : DEFAULT_TILED_WORKBENCH_PASSTHROUGH_SHORTCUT;
}

const tiledWorkbenchNavigationShortcutSchemeModule =
  createConfigModule<TiledWorkbenchNavigationShortcutScheme>({
    storageKey: TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME_STORAGE_KEY,
    eventName: TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME_CHANGED_EVENT,
    defaultValue: DEFAULT_TILED_WORKBENCH_NAVIGATION_SHORTCUT_SCHEME,
    normalize: normalizeNavigationShortcutScheme,
    serialize: (value) => normalizeNavigationShortcutScheme(value),
    persistMode: 'runtime-preferred',
  });

const tiledWorkbenchCommandShortcutSchemeModule =
  createConfigModule<TiledWorkbenchCommandShortcutScheme>({
    storageKey: TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME_STORAGE_KEY,
    eventName: TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME_CHANGED_EVENT,
    defaultValue: DEFAULT_TILED_WORKBENCH_COMMAND_SHORTCUT_SCHEME,
    normalize: normalizeCommandShortcutScheme,
    serialize: (value) => normalizeCommandShortcutScheme(value),
    persistMode: 'runtime-preferred',
  });

const tiledWorkbenchPassthroughShortcutModule =
  createConfigModule<TiledWorkbenchPassthroughShortcut>({
    storageKey: TILED_WORKBENCH_PASSTHROUGH_SHORTCUT_STORAGE_KEY,
    eventName: TILED_WORKBENCH_PASSTHROUGH_SHORTCUT_CHANGED_EVENT,
    defaultValue: DEFAULT_TILED_WORKBENCH_PASSTHROUGH_SHORTCUT,
    normalize: normalizePassthroughShortcut,
    serialize: (value) => normalizePassthroughShortcut(value),
    persistMode: 'runtime-preferred',
  });

function withAltShortcut(key: string, includeShift: boolean): string {
  return includeShift ? `Alt+Shift+${key}` : `Alt+${key}`;
}

function normalizeShortcutKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) {
    return null;
  }

  const specialKey = CANONICAL_SPECIAL_KEYS.get(trimmed.toLowerCase());
  if (specialKey) {
    return specialKey;
  }

  if (trimmed.length === 1 && /^[a-z]$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

export function serializeKeyboardShortcut(
  shortcut: KeyboardShortcutLike,
): string | null {
  const key = normalizeShortcutKey(shortcut.key);
  if (!key || shortcut.metaKey) {
    return null;
  }

  const parts: string[] = [];
  if (shortcut.ctrlKey) {
    parts.push('Ctrl');
  }
  if (shortcut.altKey) {
    parts.push('Alt');
  }
  if (shortcut.shiftKey) {
    parts.push('Shift');
  }
  parts.push(key);

  return parts.join('+');
}

export function matchesKeyboardShortcutEvent(
  event: KeyboardShortcutLike,
  shortcut: string | null | undefined,
): boolean {
  if (!shortcut) {
    return false;
  }

  return serializeKeyboardShortcut(event) === shortcut;
}

export function getTiledWorkbenchNavigationShortcutScheme():
  TiledWorkbenchNavigationShortcutScheme {
  return tiledWorkbenchNavigationShortcutSchemeModule.get();
}

export function setTiledWorkbenchNavigationShortcutScheme(
  value: TiledWorkbenchNavigationShortcutScheme,
): TiledWorkbenchNavigationShortcutScheme {
  return tiledWorkbenchNavigationShortcutSchemeModule.set(value);
}

export function subscribeTiledWorkbenchNavigationShortcutSchemeChanges(
  listener: (value: TiledWorkbenchNavigationShortcutScheme) => void,
): () => void {
  return tiledWorkbenchNavigationShortcutSchemeModule.subscribe(listener);
}

export function getTiledWorkbenchCommandShortcutScheme():
  TiledWorkbenchCommandShortcutScheme {
  return tiledWorkbenchCommandShortcutSchemeModule.get();
}

export function setTiledWorkbenchCommandShortcutScheme(
  value: TiledWorkbenchCommandShortcutScheme,
): TiledWorkbenchCommandShortcutScheme {
  return tiledWorkbenchCommandShortcutSchemeModule.set(value);
}

export function subscribeTiledWorkbenchCommandShortcutSchemeChanges(
  listener: (value: TiledWorkbenchCommandShortcutScheme) => void,
): () => void {
  return tiledWorkbenchCommandShortcutSchemeModule.subscribe(listener);
}

export function getTiledWorkbenchPassthroughShortcut():
  TiledWorkbenchPassthroughShortcut {
  return tiledWorkbenchPassthroughShortcutModule.get();
}

export function setTiledWorkbenchPassthroughShortcut(
  value: TiledWorkbenchPassthroughShortcut,
): TiledWorkbenchPassthroughShortcut {
  return tiledWorkbenchPassthroughShortcutModule.set(value);
}

export function subscribeTiledWorkbenchPassthroughShortcutChanges(
  listener: (value: TiledWorkbenchPassthroughShortcut) => void,
): () => void {
  return tiledWorkbenchPassthroughShortcutModule.subscribe(listener);
}

export function getResolvedTiledWorkbenchShortcuts(): ResolvedTiledWorkbenchShortcuts {
  const navigationScheme = getTiledWorkbenchNavigationShortcutScheme();
  const commandScheme = getTiledWorkbenchCommandShortcutScheme();
  const passthroughShortcut = getTiledWorkbenchPassthroughShortcut();
  const useShiftForNavigation = navigationScheme === 'alt-shift-arrows';
  const useShiftForCommands = commandScheme === 'alt-shift-letters';

  return {
    focusLeft: navigationScheme === 'disabled'
      ? null
      : withAltShortcut('ArrowLeft', useShiftForNavigation),
    focusRight: navigationScheme === 'disabled'
      ? null
      : withAltShortcut('ArrowRight', useShiftForNavigation),
    focusUp: navigationScheme === 'disabled'
      ? null
      : withAltShortcut('ArrowUp', useShiftForNavigation),
    focusDown: navigationScheme === 'disabled'
      ? null
      : withAltShortcut('ArrowDown', useShiftForNavigation),
    splitHorizontal: commandScheme === 'disabled'
      ? null
      : withAltShortcut('H', useShiftForCommands),
    splitVertical: commandScheme === 'disabled'
      ? null
      : withAltShortcut('V', useShiftForCommands),
    clearSlot: commandScheme === 'disabled'
      ? null
      : withAltShortcut('Backspace', useShiftForCommands),
    closeSlot: commandScheme === 'disabled'
      ? null
      : withAltShortcut('X', useShiftForCommands),
    openSlotEntry: commandScheme === 'disabled'
      ? null
      : withAltShortcut('Enter', useShiftForCommands),
    passthroughTrigger: passthroughShortcut === 'Disabled'
      ? null
      : passthroughShortcut,
  };
}
