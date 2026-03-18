const MAIN_WINDOW_SHORTCUT_SELECTION_STORAGE_KEY = 'exomind:mainWindowShortcutSelection';
const MAIN_WINDOW_SHORTCUT_SELECTION_CHANGED_EVENT = 'exomind:main-window-shortcut-selection-changed';

export const MAIN_WINDOW_SHORTCUT_OPTION_VALUES = ['Ctrl', 'Alt', 'Q', 'E', 'Space'] as const;
export const MAIN_WINDOW_SHORTCUT_MODIFIER_VALUES = ['Ctrl', 'Alt'] as const;
export const MAIN_WINDOW_SHORTCUT_PRIMARY_KEY_VALUES = ['Q', 'E', 'Space'] as const;
export const DEFAULT_MAIN_WINDOW_SHORTCUT_SELECTION = ['Alt', 'E'] as const;

export type MainWindowShortcutOption = (typeof MAIN_WINDOW_SHORTCUT_OPTION_VALUES)[number];
export type MainWindowShortcutModifier = (typeof MAIN_WINDOW_SHORTCUT_MODIFIER_VALUES)[number];
export type MainWindowShortcutPrimaryKey = (typeof MAIN_WINDOW_SHORTCUT_PRIMARY_KEY_VALUES)[number];
export type MainWindowShortcutSelection = MainWindowShortcutOption[];

export type MainWindowShortcutValidationResult =
  | { kind: 'valid'; hotkey: string }
  | {
      kind: 'invalid';
      hotkey: null;
      reason: 'missing-primary-key' | 'multiple-primary-keys';
      message: string;
    }
  | {
      kind: 'conflict';
      hotkey: string;
      voiceHotkey: string;
      message: string;
    };

type SetMainWindowShortcutSelectionOptions = {
  emitEvent?: boolean;
};

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (typeof window === 'undefined') return null;
  const localStorageLike = window.localStorage as Partial<Storage> | undefined;
  if (!localStorageLike) return null;
  if (typeof localStorageLike.getItem !== 'function') return null;
  if (typeof localStorageLike.setItem !== 'function') return null;
  return localStorageLike as Pick<Storage, 'getItem' | 'setItem'>;
}

function isMainWindowShortcutOption(value: unknown): value is MainWindowShortcutOption {
  return typeof value === 'string'
    && (MAIN_WINDOW_SHORTCUT_OPTION_VALUES as readonly string[]).includes(value);
}

function normalizeMainWindowShortcutSelection(rawValue: unknown): MainWindowShortcutSelection {
  const defaultSelection = [...DEFAULT_MAIN_WINDOW_SHORTCUT_SELECTION];
  const parsed = (() => {
    if (Array.isArray(rawValue)) {
      return rawValue;
    }
    if (typeof rawValue !== 'string') {
      return defaultSelection;
    }

    try {
      const next = JSON.parse(rawValue) as unknown;
      return Array.isArray(next) ? next : defaultSelection;
    } catch {
      return defaultSelection;
    }
  })();

  const selected = new Set<MainWindowShortcutOption>();
  for (const option of MAIN_WINDOW_SHORTCUT_OPTION_VALUES) {
    if (parsed.some((entry) => entry === option && isMainWindowShortcutOption(entry))) {
      selected.add(option);
    }
  }

  return [...selected];
}

function stringifySelection(selection: MainWindowShortcutSelection): string {
  return JSON.stringify(normalizeMainWindowShortcutSelection(selection));
}

function buildHotkey(selection: MainWindowShortcutSelection): string | null {
  const normalized = normalizeMainWindowShortcutSelection(selection);
  const primaryKeys = normalized.filter((value): value is MainWindowShortcutPrimaryKey =>
    (MAIN_WINDOW_SHORTCUT_PRIMARY_KEY_VALUES as readonly string[]).includes(value),
  );

  if (primaryKeys.length !== 1) {
    return null;
  }

  const modifiers = MAIN_WINDOW_SHORTCUT_MODIFIER_VALUES.filter((value) => normalized.includes(value));
  return [...modifiers, primaryKeys[0]].join('+');
}

export function getMainWindowShortcutSelection(): MainWindowShortcutSelection {
  const storage = getStorage();
  if (!storage) {
    return [...DEFAULT_MAIN_WINDOW_SHORTCUT_SELECTION];
  }

  return normalizeMainWindowShortcutSelection(
    storage.getItem(MAIN_WINDOW_SHORTCUT_SELECTION_STORAGE_KEY),
  );
}

export function setMainWindowShortcutSelection(
  selection: MainWindowShortcutSelection,
  options: SetMainWindowShortcutSelectionOptions = {},
): MainWindowShortcutSelection {
  const normalized = normalizeMainWindowShortcutSelection(selection);
  const storage = getStorage();
  if (!storage) {
    return normalized;
  }

  storage.setItem(
    MAIN_WINDOW_SHORTCUT_SELECTION_STORAGE_KEY,
    stringifySelection(normalized),
  );

  if (options.emitEvent !== false) {
    window.dispatchEvent(new CustomEvent<MainWindowShortcutSelection>(
      MAIN_WINDOW_SHORTCUT_SELECTION_CHANGED_EVENT,
      { detail: normalized },
    ));
  }

  return normalized;
}

export function resolveMainWindowShortcutHotkey(
  selection: MainWindowShortcutSelection,
): string | null {
  return buildHotkey(selection);
}

export function getResolvedMainWindowShortcutHotkey(): string | null {
  return buildHotkey(getMainWindowShortcutSelection());
}

export function validateMainWindowShortcutSelection(
  selection: MainWindowShortcutSelection,
  voiceHotkey?: string | null,
): MainWindowShortcutValidationResult {
  const normalized = normalizeMainWindowShortcutSelection(selection);
  const primaryKeys = normalized.filter((value): value is MainWindowShortcutPrimaryKey =>
    (MAIN_WINDOW_SHORTCUT_PRIMARY_KEY_VALUES as readonly string[]).includes(value),
  );

  if (primaryKeys.length === 0) {
    return {
      kind: 'invalid',
      hotkey: null,
      reason: 'missing-primary-key',
      message: '当前组合无效，主窗口快捷键未启用；需要在 Q / E / Space 中恰好选择一个。',
    };
  }

  if (primaryKeys.length > 1) {
    return {
      kind: 'invalid',
      hotkey: null,
      reason: 'multiple-primary-keys',
      message: '当前组合无效，主窗口快捷键未启用；Q / E / Space 只能选择一个。',
    };
  }

  const hotkey = buildHotkey(normalized);
  if (!hotkey) {
    return {
      kind: 'invalid',
      hotkey: null,
      reason: 'missing-primary-key',
      message: '当前组合无效，主窗口快捷键未启用。',
    };
  }

  if (voiceHotkey && hotkey.toLowerCase() === voiceHotkey.toLowerCase()) {
    return {
      kind: 'conflict',
      hotkey,
      voiceHotkey,
      message: `当前与全局语音快捷键 ${voiceHotkey} 冲突，主窗口快捷键未启用。`,
    };
  }

  return { kind: 'valid', hotkey };
}

export function subscribeMainWindowShortcutSelectionChanges(
  listener: (selection: MainWindowShortcutSelection) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== MAIN_WINDOW_SHORTCUT_SELECTION_STORAGE_KEY) return;
    listener(normalizeMainWindowShortcutSelection(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<MainWindowShortcutSelection>;
    listener(normalizeMainWindowShortcutSelection(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(MAIN_WINDOW_SHORTCUT_SELECTION_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(MAIN_WINDOW_SHORTCUT_SELECTION_CHANGED_EVENT, handleCustomEvent);
  };
}
