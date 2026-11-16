import { invoke } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';
import { errorMessage } from './drafts';

export interface BetaDesktopPreferences {
  shortcut: string | null;
  registered_shortcut: string | null;
  registered_shortcuts: string[];
  quick_focus: boolean;
  error: string | null;
}
function validate(value: unknown): BetaDesktopPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  for (const key of ['shortcut', 'registered_shortcut', 'error']) {
    if (item[key] !== null && typeof item[key] !== 'string') throw invalid();
  }
  if (typeof item.quick_focus !== 'boolean' || !Array.isArray(item.registered_shortcuts)
    || item.registered_shortcuts.some(key => typeof key !== 'string')) throw invalid();
  return item as unknown as BetaDesktopPreferences;
}
function invalid() { return new BetaApiError('invalid_desktop_preferences', '快捷键实际状态尚未确认，请重新读取'); }

/** Confirmed native state, shared by settings and activation handling. Reads
 * and mutations enter one queue so an older refresh cannot replace a save. */
class DesktopPreferences {
  private value: BetaDesktopPreferences | null = null;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  get = (): BetaDesktopPreferences | null => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private call(command: string, args?: Record<string, unknown>, mutation = false): Promise<BetaDesktopPreferences> {
    const operation = this.queue.then(async () => {
      let raw: unknown;
      try { raw = await invoke<unknown>(command, args); }
      catch (failure) {
        // A registration/rollback can fail after a partial OS change. Refresh
        // the actual owned binding set before reporting the mutation failure.
        if (mutation) {
          try {
            this.value = validate(await invoke<unknown>('beta_desktop_preferences'));
            this.listeners.forEach(listener => listener());
          } catch { this.value = null; this.listeners.forEach(listener => listener()); }
        }
        throw new Error(errorMessage(failure));
      }
      const next = validate(raw);
      this.value = next; this.listeners.forEach(listener => listener());
      if (command === 'beta_set_desktop_shortcut' && next.error) throw new Error(next.error);
      return next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  refresh = () => this.call('beta_desktop_preferences');
  setShortcut = (shortcut: string | null) => this.call('beta_set_desktop_shortcut', { shortcut }, true);
  setQuickFocus = (enabled: boolean) => this.call('beta_set_desktop_quick_focus', { enabled }, true);
}
export const betaDesktopPreferences = new DesktopPreferences();
