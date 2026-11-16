import { useEffect, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';

const DATE_KEY = 'exomind:beta:date-display';
const THEME_KEY = 'exomind:beta:theme';
const ADAPTIVE_KEY = 'exomind:beta:desktop-adaptive';
const OVERLAY_KEY = 'exomind:beta:overlay-enabled';
const CHANGE_EVENT = 'exomind:beta:display-preference-changed';
export type BetaTheme = 'system' | 'light' | 'dark';

function read(key: string): string | null {
  try { return typeof window === 'undefined' ? null : localStorage.getItem(key); }
  catch { return null; }
}
export function getBetaDateDisplayMode(): EventDateDisplayMode {
  const value = read(DATE_KEY);
  return value === 'full' || value === 'weekday' ? value : 'compact';
}
export function getBetaTheme(): BetaTheme {
  const value = read(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function getBetaDesktopAdaptiveEnabled(): boolean { return read(ADAPTIVE_KEY) !== 'false'; }
export function getBetaOverlayEnabled(): boolean { return read(OVERLAY_KEY) === 'true'; }
function persist(key: string, value: string): void {
  if (typeof window === 'undefined') throw new Error('当前环境无法保存显示设置');
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function setBetaDateDisplayMode(value: EventDateDisplayMode): void { persist(DATE_KEY, value); }
export function setBetaTheme(value: BetaTheme): void { persist(THEME_KEY, value); }
export function setBetaDesktopAdaptiveEnabled(value: boolean): void { persist(ADAPTIVE_KEY, String(value)); }
let overlayQueue: Promise<unknown> = Promise.resolve();
export function setBetaOverlayEnabled(enabled: boolean): Promise<boolean> {
  const operation = overlayQueue.then(async () => {
    await invoke('beta_overlay_window', { operation: { kind: enabled ? 'show' : 'hide' } });
    try { persist(OVERLAY_KEY, String(enabled)); }
    catch { throw new Error('浮窗显示已应用，但下次启动偏好未能保存，请重试'); }
    return enabled;
  });
  overlayQueue = operation.catch(() => {}); return operation;
}
function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const storage = (event: StorageEvent) => { if (event.key === null || [DATE_KEY, THEME_KEY, ADAPTIVE_KEY, OVERLAY_KEY].includes(event.key)) listener(); };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(CHANGE_EVENT, listener); window.removeEventListener('storage', storage); };
}
export const subscribeBetaDisplayPreference = subscribe;
export function useBetaDesktopAdaptiveEnabled(): boolean {
  return useSyncExternalStore(subscribe, getBetaDesktopAdaptiveEnabled, () => true);
}
export function useBetaOverlayEnabled(): boolean {
  return useSyncExternalStore(subscribe, getBetaOverlayEnabled, () => false);
}
export function useBetaDateDisplayMode(): EventDateDisplayMode {
  return useSyncExternalStore(subscribe, getBetaDateDisplayMode, () => 'compact');
}
export function useBetaTheme(): BetaTheme {
  return useSyncExternalStore(subscribe, getBetaTheme, () => 'system');
}
/** Theme presentation only; importing the legacy config would load Runtime
 * configuration. Beta uses its own device preference and no legacy bootstrap. */
export function useBetaThemePresentation(): void {
  const theme = useBetaTheme();
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(query.matches);
    change();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', change);
      return () => query.removeEventListener('change', change);
    }
    query.addListener(change);
    return () => query.removeListener(change);
  }, []);
  useEffect(() => {
    const dark = theme === 'dark' || theme === 'system' && systemDark;
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [theme, systemDark]);
}
