import type { EventData } from '../types/event';
import type { IEventLogPort } from '../environment/interfaces/eventlog.port';
import { WebEventLogStorageAdapter } from './web-eventlog-storage';
import { getCurrentUserId } from '../storage/event-storage';
import { log } from '@/lib/logger';
import { isTauriWindow } from '@/config/runtime-target';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function getTauriInvoke(): Promise<TauriInvoke | null> {
  if (!isTauriWindow()) {
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

  private resolveUserId(): string | undefined {
    return this.userId ?? getCurrentUserId();
  }

  async listEvents(): Promise<EventData[]> {
    const invoke = await getTauriInvoke();
    if (!invoke) {
      return this.fallback.listEvents();
    }

    const userId = this.resolveUserId();
    try {
      return await invoke<EventData[]>('eventlog_list', { userId });
    } catch (error) {
      log.warn(`[TauriEventLogStorageAdapter] eventlog_list failed, fallback to web storage: ${error instanceof Error ? error.message : String(error)}`);
      return this.fallback.listEvents();
    }
  }

  async appendEvent(event: EventData): Promise<EventData> {
    const invoke = await getTauriInvoke();
    if (!invoke) {
      return this.fallback.appendEvent(event);
    }

    const userId = this.resolveUserId();
    try {
      await invoke<void>('eventlog_append', { userId, event });
      return event;
    } catch (error) {
      log.warn(`[TauriEventLogStorageAdapter] eventlog_append failed, fallback to web storage: ${error instanceof Error ? error.message : String(error)}`);
      return this.fallback.appendEvent(event);
    }
  }

  async getEvent(id: string): Promise<EventData | null> {
    const invoke = await getTauriInvoke();
    if (!invoke) {
      return this.fallback.getEvent(id);
    }

    const userId = this.resolveUserId();
    try {
      return await invoke<EventData | null>('eventlog_get', { userId, id });
    } catch (error) {
      log.warn(`[TauriEventLogStorageAdapter] eventlog_get failed, fallback to web storage: ${error instanceof Error ? error.message : String(error)}`);
      return this.fallback.getEvent(id);
    }
  }

  async clearEvents(): Promise<void> {
    const invoke = await getTauriInvoke();
    if (!invoke) {
      await this.fallback.clearEvents();
      return;
    }

    const userId = this.resolveUserId();
    try {
      await invoke<void>('eventlog_clear', { userId });
    } catch (error) {
      log.warn(`[TauriEventLogStorageAdapter] eventlog_clear failed, fallback to web storage: ${error instanceof Error ? error.message : String(error)}`);
      await this.fallback.clearEvents();
    }
  }
}

