import { useSyncExternalStore } from 'react';
import type { InputSendMode } from '@/lib/input-send-shortcut';
export { shouldSubmitOnEnter, inputSendShortcutLabel } from '@/lib/input-send-shortcut';

const KEY = 'exomind:beta:input-send-mode';
const CHANGE = 'exomind:beta:input-send-mode-changed';
export function getBetaInputSendMode(): InputSendMode {
  try { return localStorage.getItem(KEY) === 'enter-send' ? 'enter-send' : 'ctrl-enter-send'; }
  catch { return 'ctrl-enter-send'; }
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
  return () => { window.removeEventListener(CHANGE, changed); window.removeEventListener('storage', storage); };
}
export function useBetaInputSendMode(): InputSendMode {
  return useSyncExternalStore(subscribeBetaInputSendMode, getBetaInputSendMode, () => 'ctrl-enter-send');
}
