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
import type { IEventLogPort } from '../environment/interfaces/eventlog.port';
import type { Event, NoteContent, Tag, EventData } from '../types/event';
import { WebEventLogStorageAdapter } from '../adapters/web-eventlog-storage';
import { createUuidV4 } from '../utils/uuid';
import {
  createTransferPayload,
  parseTransferPayload,
  mergeEventsById,
  type ImportStrategy,
} from '../eventlog/transfer';

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

export interface EventLogServiceOptions {
  port?: IEventLogPort;
}

export class EventLogServiceImpl implements EventLogService {
  private readonly port: IEventLogPort;
  private listeners: Set<(event: Event) => void> = new Set();

  constructor(options: EventLogServiceOptions = {}) {
    this.port = options.port ?? new WebEventLogStorageAdapter();
  }

  async loadEvents(): Promise<Event[]> {
    const data = await this.readEventData();
    return data.map((d) => this.deserializeEvent(d)).sort((a, b) => b.timestamp - a.timestamp);
  }

  async addEvent(content: NoteContent, tags?: Set<Tag>): Promise<Event> {
    const eventData: EventData = {
      id: createUuidV4(),
      timestamp: Date.now(),
      content,
      tags: tags ? Array.from(tags) : [NOTE_TAG],
    };

    await this.port.appendEvent(eventData);

    const event = this.deserializeEvent(eventData);

    // 通知监听者
    this.listeners.forEach((cb) => cb(event));

    return event;
  }

  async exportEventsAsJson(): Promise<string> {
    const events = await this.readEventData();
    const payload = createTransferPayload(events);
    return JSON.stringify(payload, null, 2);
  }

  async importEventsFromJson(json: string, strategy: ImportStrategy): Promise<ImportEventsResult> {
    const payload = parseTransferPayload(json);
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
    return this.port.listEvents();
  }

  private async writeEventData(events: EventData[]): Promise<void> {
    await this.port.clearEvents();

    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    for (const event of sorted) {
      await this.port.appendEvent(event);
    }
  }
}

// 单例导出
let eventLogServiceInstance: EventLogService | null = null;

export function getEventLogService(): EventLogService {
  if (!eventLogServiceInstance) {
    const environment = ExoMindEnvironment.getInstance();
    eventLogServiceInstance = new EventLogServiceImpl({ port: environment.eventlog });
  }
  return eventLogServiceInstance;
}
