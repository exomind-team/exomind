/**
 * EventLogService - 普通事件管理
 *
 * ┌─────────────────────────────────────────┐
 * │  L3 Service                            │
 * │  ─────────────────────────────────     │
 * │  - 普通事件 CRUD                        │
 * │  - 事件监听                            │
 * └─────────────────────────────────────────┘
 *
 * 迁移自: src/lib/services/eventlog.service.ts
 * 迁移时间: 2026-02-10
 */

import { ExoMindEnvironment } from '../environment/environment.js';
import type { Event, NoteContent, Tag, EventData } from '@exomind/shared';

// 存储键
const EVENTS_KEY = 'events';

// 标签常量
const NOTE_TAG: Tag = 'note';

export interface EventLogService {
  /** 加载所有事件 */
  loadEvents(): Promise<Event[]>;

  /** 添加普通事件 */
  addEvent(content: NoteContent, tags?: Set<Tag>): Promise<Event>;

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

    return data.map(d => this.deserializeEvent(d)).sort((a, b) => b.timestamp - a.timestamp);
  }

  async addEvent(content: NoteContent, tags?: Set<Tag>): Promise<Event> {
    console.log('[EventLogService] addEvent 被调用, content:', content);
    const eventData: EventData = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      content,
      tags: tags ? Array.from(tags) : [NOTE_TAG],
    };

    console.log('[EventLogService] 准备保存事件:', eventData);

    // 持久化：加载现有事件，添加新事件，保存
    const events = await this.loadEvents();
    console.log('[EventLogService] 现有事件数量:', events.length);
    events.unshift(this.deserializeEvent(eventData));  // 最新在前
    console.log('[EventLogService] 保存前事件数量:', events.length);

    await this.env.storage.write(EVENTS_KEY, events.map(e => this.serializeEvent(e)));
    console.log('[EventLogService] 数据已写入 storage');

    const event = this.deserializeEvent(eventData);

    // 通知监听者
    console.log('[EventLogService] 通知监听者, listener 数量:', this.listeners.size);
    this.listeners.forEach(cb => {
      console.log('[EventLogService] 调用监听器...');
      cb(event);
    });

    console.log('[EventLogService] 事件已保存:', { id: event.id, content: event.content });
    return event;
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
