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
type OverlayFailureStage = 'setting' | 'setting-binding' | 'binding' | 'open';

function overlayFailure(error: unknown, stage: OverlayFailureStage): Error {
  const failure = error && typeof error === 'object'
    ? error as {
      code?: unknown;
      message?: unknown;
    }
    : null;
  const code = typeof failure?.code === 'string' && failure.code.trim() ? failure.code.trim() : null;
  const errorMessage = error instanceof Error ? error.message : null;
  const structuredMessage = typeof failure?.message === 'string' ? failure.message : null;
  const rawMessage = errorMessage && errorMessage !== '[object Object]'
    ? errorMessage
    : typeof error === 'string'
      ? error
      : structuredMessage;
  const message = typeof rawMessage === 'string' && rawMessage.trim() && rawMessage !== '[object Object]'
    ? rawMessage.trim()
    : '本机没有返回可读错误详情';
  const reason = [code, message].filter(Boolean).join('：');

  if (code === 'overlay_unsupported') {
    return new Error(stage === 'open'
      ? `档案已绑定，但当前平台不支持独立浮窗（${reason}）。请继续在主界面使用工作台。`
      : `当前平台不支持独立浮窗（${reason}）；已确认的设置保持不变。请继续在主界面使用工作台。`);
  }

  if (stage === 'setting-binding') {
    return new Error(`设置开关未应用：档案绑定未完成（${reason}）。请刷新档案列表并重新选择；已确认的设置保持不变，浮窗尚未打开。`);
  }
  if (stage === 'binding') {
    return new Error(`档案绑定未完成（${reason}）。请刷新档案列表并重新选择；浮窗尚未打开。`);
  }
  if (stage === 'open') {
    return new Error(`档案已绑定，但浮窗显示未确认（${reason}）。请重试打开当前档案；也可回主界面继续使用工作台。`);
  }
  return new Error(`设置开关未应用（${reason}）；已确认的设置保持不变。请重试；仍失败时可继续使用主界面工作台。`);
}

function enqueueOverlayOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = overlayQueue.then(operation);
  overlayQueue = result.catch(() => {});
  return result;
}

async function applyOverlayEnabled(enabled: boolean, stage: OverlayFailureStage): Promise<boolean> {
  try {
    await invoke('beta_overlay_window', { operation: { kind: enabled ? 'show' : 'hide' } });
  } catch (error) {
    throw overlayFailure(error, stage);
  }
  try {
    persist(OVERLAY_KEY, String(enabled));
  } catch {
    throw new Error('浮窗显示已应用，但启用设置未能保存；当前开关仍显示上次确认值。请检查本机存储后重试。');
  }
  return enabled;
}

async function bindOverlayProfile(profileId: string, stage: 'setting-binding' | 'binding'): Promise<void> {
  try {
    const scope = await invoke<unknown>('beta_workspace_bind', { profileId });
    if (!scope || typeof scope !== 'object') {
      throw new Error('本机没有返回档案与运行实例作用域，浮窗尚未打开');
    }
    const binding = scope as {
      device_id?: unknown;
      runtime_id?: unknown;
      profile_id?: unknown;
      ui_owner_generation?: unknown;
    };
    if (binding.profile_id !== profileId
      || typeof binding.device_id !== 'string' || !binding.device_id.trim()
      || typeof binding.runtime_id !== 'string' || !binding.runtime_id.trim()
      || typeof binding.ui_owner_generation !== 'string' || !binding.ui_owner_generation.trim()) {
      throw new Error('本机未确认所选档案与运行实例的绑定，浮窗尚未打开');
    }
  } catch (error) {
    throw overlayFailure(error, stage);
  }
}

export function setBetaOverlayEnabled(enabled: boolean, profileId?: string): Promise<boolean> {
  return enqueueOverlayOperation(async () => {
    if (enabled && profileId !== undefined && !profileId.trim()) {
      throw new Error('请先选择一个档案，再打开悬浮工作台');
    }
    if (enabled && profileId !== undefined) {
      await bindOverlayProfile(profileId.trim(), 'setting-binding');
    }
    return applyOverlayEnabled(enabled, 'setting');
  });
}
/** Binds a specific profile before making the floating workspace visible. */
export async function openBetaOverlayForProfile(profileId: string): Promise<void> {
  const normalizedProfileId = profileId.trim();
  if (!normalizedProfileId) throw new Error('请先选择一个档案，再打开悬浮工作台');
  await enqueueOverlayOperation(async () => {
    await bindOverlayProfile(normalizedProfileId, 'binding');
    await applyOverlayEnabled(true, 'open');
  });
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
