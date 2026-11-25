import { useSyncExternalStore } from 'react';
import { getHardwareKeyboardState, subscribeHardwareKeyboardState } from '@/config/hardware-keyboard';
import type { InputSendMode } from '@/lib/input-send-shortcut';
export { shouldSubmitOnEnter } from '@/lib/input-send-shortcut';

const KEY = 'exomind:beta:input-send-mode';
const CHANGE = 'exomind:beta:input-send-mode-changed';
function storedBetaInputSendMode(): InputSendMode | null {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'enter-send' || stored === 'ctrl-enter-send' ? stored : null;
  } catch {
    return null;
  }
}
export function getBetaInputSendMode(): InputSendMode {
  // An explicit user choice wins. Until the user chooses one, follow the
  // device's current hardware-keyboard state so touch and desktop stay usable.
  return storedBetaInputSendMode()
    ?? (getHardwareKeyboardState().hasHardwareKeyboard ? 'enter-send' : 'ctrl-enter-send');
}
export function inputSendShortcutLabel(mode: InputSendMode): string {
  return mode === 'enter-send'
    ? 'Enter 发送 · Shift / Ctrl / ⌘ + Enter 换行'
    : 'Ctrl / ⌘ + Enter 发送';
}
export function setBetaInputSendMode(value: string): void {
  if (value !== 'enter-send' && value !== 'ctrl-enter-send') throw new Error('请选择有效的发送方式');
  localStorage.setItem(KEY, value);
  window.dispatchEvent(new Event(CHANGE));
}
export function subscribeBetaInputSendMode(listener: (value: InputSendMode) => void): () => void {
  const changed = () => listener(getBetaInputSendMode());
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) changed(); };
  window.addEventListener(CHANGE, changed); window.addEventListener('storage', storage);
  const unsubscribeKeyboard = subscribeHardwareKeyboardState(changed);
  return () => {
    window.removeEventListener(CHANGE, changed);
    window.removeEventListener('storage', storage);
    unsubscribeKeyboard();
  };
}
export function useBetaInputSendMode(): InputSendMode {
  return useSyncExternalStore(subscribeBetaInputSendMode, getBetaInputSendMode, () => 'ctrl-enter-send');
}
