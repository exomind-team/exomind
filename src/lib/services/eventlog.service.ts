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
  private env: ExoMindEnvironment;
  private listeners: Set<(event: Event) => void> = new Set();

  constructor(env?: ExoMindEnvironment) {
    this.env = env || ExoMindEnvironment.getInstance();
  }

  async loadEvents(): Promise<Event[]> {
    const data = await this.env.storage.read<EventData[]>(EVENTS_KEY);
    if (!data) return [];

    return data.map((d) => this.deserializeEvent(d)).sort((a, b) => b.timestamp - a.timestamp);
  }

  async addEvent(content: NoteContent, tags?: Set<Tag>): Promise<Event> {
    const eventData: EventData = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      content,
      tags: tags ? Array.from(tags) : [NOTE_TAG],
    };

    // 持久化：加载现有事件，添加新事件，保存
    const events = await this.loadEvents();
    events.unshift(this.deserializeEvent(eventData));

    await this.env.storage.write(EVENTS_KEY, events.map((e) => this.serializeEvent(e)));

    const event = this.deserializeEvent(eventData);

    // 通知监听者
    this.listeners.forEach((cb) => cb(event));

    return event;
  }

  async exportEventsAsJson(): Promise<string> {
    const events = (await this.env.storage.read<EventData[]>(EVENTS_KEY)) || [];
    const payload = createBackupPayload(events);
    return JSON.stringify(payload, null, 2);
  }

  async importEventsFromJson(json: string, strategy: ImportStrategy): Promise<ImportEventsResult> {
    const payload = parseBackupPayload(json);
    const incoming = mergeEventsById([], payload.events);
    const existing = (await this.env.storage.read<EventData[]>(EVENTS_KEY)) || [];

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

    await this.env.storage.write(EVENTS_KEY, next);

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

  /** 序列化事件（用于存储） */
  private serializeEvent(event: Event): EventData {
    return {
      id: event.id,
      timestamp: event.timestamp,
      content: event.content,
      tags: Array.from(event.tags),
    };
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
}

// 单例导出
let eventLogServiceInstance: EventLogService | null = null;

export function getEventLogService(): EventLogService {
  if (!eventLogServiceInstance) {
    eventLogServiceInstance = new EventLogServiceImpl();
  }
  return eventLogServiceInstance;
}
