import type { EventData } from '../types/event';
import type { IEventLogPort } from '../environment/interfaces/eventlog.port';
import { WebEventLogStorageAdapter } from './web-eventlog-storage';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function getTauriInvoke(): Promise<TauriInvoke | null> {
  if (typeof window === 'undefined' || window.__TAURI__ === undefined) {
    return null;
  }

  const tauriCore = await import('@tauri-apps/api/core');
  return tauriCore.invoke as TauriInvoke;
}

/**
 * TauriEventLogStorageAdapter
 *
 * 当前阶段先提供最小骨架：
 * - 优先调用 Tauri 命令（Task 5 完整实现）
 * - 若命令不可用则回退到 WebEventLogStorageAdapter
 */
export class TauriEventLogStorageAdapter implements IEventLogPort {
  private readonly fallback: WebEventLogStorageAdapter;

  constructor(private readonly userId?: string) {
    this.fallback = new WebEventLogStorageAdapter(userId);
  }

  async listEvents(): Promise<EventData[]> {
    const invoke = await getTauriInvoke();
    if (!invoke) {
      return this.fallback.listEvents();
    }

    try {
      return await invoke<EventData[]>('eventlog_list', { userId: this.userId });
    } catch (error) {
      console.warn('[TauriEventLogStorageAdapter] eventlog_list failed, fallback to web storage', error);
      return this.fallback.listEvents();
    }
  }

  async appendEvent(event: EventData): Promise<void> {
    const invoke = await getTauriInvoke();
    if (!invoke) {
      await this.fallback.appendEvent(event);
      return;
    }

    try {
      await invoke<void>('eventlog_append', { userId: this.userId, event });
    } catch (error) {
      console.warn('[TauriEventLogStorageAdapter] eventlog_append failed, fallback to web storage', error);
      await this.fallback.appendEvent(event);
    }
  }

  async getEvent(id: string): Promise<EventData | null> {
    const invoke = await getTauriInvoke();
    if (!invoke) {
      return this.fallback.getEvent(id);
    }

    try {
      return await invoke<EventData | null>('eventlog_get', { userId: this.userId, id });
    } catch (error) {
      console.warn('[TauriEventLogStorageAdapter] eventlog_get failed, fallback to web storage', error);
      return this.fallback.getEvent(id);
    }
  }

  async clearEvents(): Promise<void> {
    const invoke = await getTauriInvoke();
    if (!invoke) {
      await this.fallback.clearEvents();
      return;
    }

    try {
      await invoke<void>('eventlog_clear', { userId: this.userId });
    } catch (error) {
      console.warn('[TauriEventLogStorageAdapter] eventlog_clear failed, fallback to web storage', error);
      await this.fallback.clearEvents();
    }
  }
}

