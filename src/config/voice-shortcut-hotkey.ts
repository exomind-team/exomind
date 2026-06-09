import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from './runtime-config-cache';

const VOICE_SHORTCUT_HOTKEY_STORAGE_KEY = 'exomind:voiceShortcutHotkey';
const VOICE_SHORTCUT_HOTKEY_CHANGED_EVENT = 'exomind:voice-shortcut-hotkey-changed';

export const VOICE_SHORTCUT_HOTKEY_VALUES = ['Alt+Q', 'Alt+W', 'Ctrl+Space'] as const;
export type VoiceShortcutHotkey = (typeof VOICE_SHORTCUT_HOTKEY_VALUES)[number];

function normalizeHotkey(rawValue: string | null | undefined): VoiceShortcutHotkey {
  const value = (rawValue || '').replace(/\s+/g, '').toLowerCase();
  if (value === 'alt+w') return 'Alt+W';
  if (value === 'ctrl+space' || value === 'ctrl+shift+space') return 'Ctrl+Space';
  return 'Alt+Q';
}

type SetVoiceShortcutOptions = {
  emitEvent?: boolean;
};

export function getVoiceShortcutHotkey(): VoiceShortcutHotkey {
  return normalizeHotkey(getRuntimeConfigValueSync(VOICE_SHORTCUT_HOTKEY_STORAGE_KEY));
}

export function setVoiceShortcutHotkey(
  hotkey: string,
  options: SetVoiceShortcutOptions = {},
): VoiceShortcutHotkey {
  const normalized = normalizeHotkey(hotkey);
  if (typeof window === 'undefined') return normalized;
  setRuntimeConfigValue(VOICE_SHORTCUT_HOTKEY_STORAGE_KEY, normalized, {
    source: VOICE_SHORTCUT_HOTKEY_CHANGED_EVENT,
    sourceOrigin: window.location?.origin,
  });
  if (options.emitEvent !== false) {
    window.dispatchEvent(new CustomEvent<VoiceShortcutHotkey>(VOICE_SHORTCUT_HOTKEY_CHANGED_EVENT, { detail: normalized }));
  }
  return normalized;
}

export function subscribeVoiceShortcutHotkeyChanges(
  listener: (hotkey: VoiceShortcutHotkey) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== VOICE_SHORTCUT_HOTKEY_STORAGE_KEY) return;
    listener(normalizeHotkey(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<VoiceShortcutHotkey>;
    listener(normalizeHotkey(customEvent.detail));
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(VOICE_SHORTCUT_HOTKEY_CHANGED_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(VOICE_SHORTCUT_HOTKEY_CHANGED_EVENT, handleCustomEvent);
  };
}
