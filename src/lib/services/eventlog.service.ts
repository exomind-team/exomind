/**
 * EventLogService - 普通事件管理
 *
 * ┌─────────────────────────────────────────┐
 * │  L3 Service                            │
 * │  ─────────────────────────────────     │
 * │  - 普通事件 CRUD                        │
 * │  - 事件监听                            │
 * └─────────────────────────────────────────┘
 */

import { ExoMindEnvironment } from '../environment/environment';
import type { Event, NoteContent, Tag, EventData } from '../types/event';
import { getEventStorage, type Event as StorageEvent } from '../storage/event-storage';
import {
  createBackupPayload,
  parseBackupPayload,
  mergeEventsById,
  type ImportStrategy,
} from '../eventlog/backup';

// 存储键
const EVENTS_KEY = 'events';

// 标签常量
const NOTE_TAG: Tag = 'note';

export interface ImportEventsResult {
  imported: number;
  skipped: number;
  total: number;
}

export interface EventLogService {
  /** 加载所有事件 */
  loadEvents(): Promise<Event[]>;

  /** 添加普通事件 */
  addEvent(content: NoteContent, tags?: Set<Tag>): Promise<Event>;

  /** 导出事件为 JSON */
  exportEventsAsJson(): Promise<string>;

  /** 从 JSON 导入事件 */
  importEventsFromJson(json: string, strategy: ImportStrategy): Promise<ImportEventsResult>;

  /** 监听新事件 */
  onEvent(callback: (event: Event) => void): () => void;
}

export class EventLogServiceImpl implements EventLogService {
  private env: ExoMindEnvironment | null;
  private listeners: Set<(event: Event) => void> = new Set();

  constructor(env?: ExoMindEnvironment) {
    this.env = env || null;
  }

  async loadEvents(): Promise<Event[]> {
    const data = await this.readEventData();
    return data.map((d) => this.deserializeEvent(d)).sort((a, b) => b.timestamp - a.timestamp);
  }

  async addEvent(content: NoteContent, tags?: Set<Tag>): Promise<Event> {
    const eventData: EventData = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      content,
      tags: tags ? Array.from(tags) : [NOTE_TAG],
    };

    if (this.env) {
      // 测试注入模式：仍走环境存储
      const existing = await this.readEventData();
      existing.unshift(eventData);
      await this.writeEventData(existing);
    } else {
      // 运行时默认：与 ChatPage 使用同一个 PouchDB EventStorage
      const storage = getEventStorage();
      await storage.addEvent(this.toStorageEvent(eventData));
    }

    const event = this.deserializeEvent(eventData);

    // 通知监听者
    this.listeners.forEach((cb) => cb(event));

    return event;
  }

  async exportEventsAsJson(): Promise<string> {
    const events = await this.readEventData();
    const payload = createBackupPayload(events);
    return JSON.stringify(payload, null, 2);
  }

  async importEventsFromJson(json: string, strategy: ImportStrategy): Promise<ImportEventsResult> {
    const payload = parseBackupPayload(json);
    const incoming = mergeEventsById([], payload.events);
    const existing = await this.readEventData();

    let next: EventData[];
    let imported = 0;
    let skipped = 0;

    if (strategy === 'overwrite') {
      next = incoming;
      imported = incoming.length;
    } else {
      const existingIds = new Set(existing.map((event) => event.id));
      imported = incoming.filter((event) => !existingIds.has(event.id)).length;
      skipped = incoming.length - imported;
      next = mergeEventsById(existing, incoming);
    }

    await this.writeEventData(next);

    return {
      imported,
      skipped,
      total: next.length,
    };
  }

  onEvent(callback: (event: Event) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** 反序列化事件（从存储读取） */
  private deserializeEvent(data: EventData): Event {
    return {
      id: data.id,
      timestamp: data.timestamp,
      content: data.content,
      tags: new Set(data.tags),
    };
  }

  private async readEventData(): Promise<EventData[]> {
    if (this.env) {
      return (await this.env.storage.read<EventData[]>(EVENTS_KEY)) || [];
    }

    const storage = getEventStorage();
    const events = await storage.getEvents();
    return events.map((event) => this.fromStorageEvent(event));
  }

  private async writeEventData(events: EventData[]): Promise<void> {
    if (this.env) {
      await this.env.storage.write(EVENTS_KEY, events);
      return;
    }

    const storage = getEventStorage();
    await storage.clearAll();

    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    for (const event of sorted) {
      await storage.addEvent(this.toStorageEvent(event));
    }
  }

  private toStorageEvent(event: EventData): StorageEvent {
    return {
      id: event.id,
      content: event.content,
      createdAt: new Date(event.timestamp).toISOString(),
      type: event.tags[0] || NOTE_TAG,
      metadata: {
        tags: event.tags,
      },
    };
  }

  private fromStorageEvent(event: StorageEvent): EventData {
    const parsedTimestamp = Date.parse(event.createdAt);
    const tags = this.normalizeTags(event.metadata?.tags, event.type);

    return {
      id: event.id,
      timestamp: Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp,
      content: event.content,
      tags,
    };
  }

  private normalizeTags(rawTags: unknown, fallbackType?: string): Tag[] {
    if (Array.isArray(rawTags)) {
      const tags = rawTags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
      if (tags.length > 0) {
        return tags;
      }
    }

    if (typeof fallbackType === 'string' && fallbackType.length > 0) {
      return [fallbackType];
    }

    return [NOTE_TAG];
  }
}

// 单例导出
let eventLogServiceInstance: EventLogService | null = null;

export function getEventLogService(): EventLogService {
  if (!eventLogServiceInstance) {
    eventLogServiceInstance = new EventLogServiceImpl();
  }
  return eventLogServiceInstance;
}
