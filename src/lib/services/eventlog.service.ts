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

import { ExoMindEnvironment } from "../environment/environment";
import type {
  EventLogAppendInput,
  EventLogImportResult as PortEventLogImportResult,
  EventLogListOptions,
  EventLogListResult,
  EventLogListSemantics,
  IEventLogPort,
} from "../environment/interfaces/eventlog.port";
import type {
  Event,
  EventData,
  EventRef,
  NoteContent,
  Tag,
} from "../types/event";
import { createUuidV4 } from "../utils/uuid";
import { getEventSourceMetadata } from "../eventlog/source-metadata";
import { normalizeEventRefs } from "../eventlog/event-refs";
import { PerfTrace } from "@/lib/utils/perf-trace";
import {
  createTransferPayload,
  parseTransferPayload,
  mergeEventsById,
  type ImportStrategy,
} from "../eventlog/transfer";

// 标签常量
const NOTE_TAG: Tag = "note";

export interface ImportEventsResult {
  imported: number;
  skipped: number;
  total: number;
}

export interface EventLogLoadResult {
  events: Event[];
  semantics: EventLogListSemantics;
  snapshotRevision?: string | null;
}

export interface EventLogService {
  /** 加载所有事件 */
  loadEvents(options?: EventLogListOptions): Promise<Event[]>;

  /** 加载事件并显式返回 snapshot / incremental 语义 */
  loadEventsDetailed(
    options?: EventLogListOptions,
  ): Promise<EventLogLoadResult>;

  /** 添加普通事件 */
  addEvent(
    content: NoteContent,
    tags?: Set<Tag>,
    refs?: EventRef[],
  ): Promise<Event>;

  /** 追加普通结构化事件（服务端 / 存储端生成 timestamp） */
  appendEvent(
    event: EventLogAppendInput,
  ): Promise<Event>;

  /** 追加原始事件数据（保留外部时间戳 / 标签 / 元数据） */
  appendEventData(event: EventData): Promise<Event>;

  /** 导出事件为 JSON */
  exportEventsAsJson(): Promise<string>;

  /** 从 JSON 导入事件 */
  importEventsFromJson(
    json: string,
    strategy: ImportStrategy,
  ): Promise<ImportEventsResult>;

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
    this.port = options.port ?? ExoMindEnvironment.getInstance().eventlog;
  }

  async loadEvents(options?: EventLogListOptions): Promise<Event[]> {
    const result = await this.loadEventsDetailed(options);
    return result.events;
  }

  async loadEventsDetailed(
    options?: EventLogListOptions,
  ): Promise<EventLogLoadResult> {
    const mode =
      typeof options?.sinceId === "string" && options.sinceId.length > 0
        ? "incremental"
        : typeof options?.sinceTimestamp === "number" ||
            typeof options?.untilTimestamp === "number"
          ? "range"
          : "full";
    const trace = new PerfTrace("EventLogService loadEventsDetailed", {
      mode,
      sinceId: options?.sinceId ?? null,
      sinceTimestamp: options?.sinceTimestamp ?? null,
      untilTimestamp: options?.untilTimestamp ?? null,
      limit: options?.limit ?? null,
    });
    const result = await this.readEventDataDetailed(options);
    trace.step("read-event-data-detailed", {
      fetched: result.events.length,
      semantics: result.semantics,
      snapshotRevision: result.snapshotRevision ?? null,
    });
    const events = result.events.map((data) => this.deserializeEvent(data));
    trace.step("deserialize-events", { fetched: events.length });
    events.sort((a, b) => b.timestamp - a.timestamp);
    trace.step("sort-events", { fetched: events.length });
    trace.finish({
      fetched: events.length,
      semantics: result.semantics,
      snapshotRevision: result.snapshotRevision ?? null,
    });
    return {
      events,
      semantics: result.semantics,
      snapshotRevision: result.snapshotRevision,
    };
  }

  async addEvent(
    content: NoteContent,
    tags?: Set<Tag>,
    refs?: EventRef[],
  ): Promise<Event> {
    const eventData: EventLogAppendInput = {
      id: createUuidV4(),
      content,
      tags: tags ? Array.from(tags) : [NOTE_TAG],
      metadata: {
        source: getEventSourceMetadata(),
      },
      refs: normalizeEventRefs(refs),
    };

    const persisted = await this.port.appendEvent(eventData);
    const event = this.deserializeEvent(persisted);

    // 通知监听者
    this.listeners.forEach((cb) => cb(event));

    return event;
  }

  async appendEvent(eventData: EventLogAppendInput): Promise<Event> {
    const persisted = await this.port.appendEvent(eventData);
    const event = this.deserializeEvent(persisted);
    this.listeners.forEach((cb) => cb(event));

    return event;
  }

  async appendEventData(eventData: EventData): Promise<Event> {
    const persisted = await this.port.appendRawEvent(eventData);
    const event = this.deserializeEvent(persisted);
    this.listeners.forEach((cb) => cb(event));

    return event;
  }

  async exportEventsAsJson(): Promise<string> {
    const events = await this.readEventData();
    const payload = createTransferPayload(events);
    return JSON.stringify(payload, null, 2);
  }

  async importEventsFromJson(
    json: string,
    strategy: ImportStrategy,
  ): Promise<ImportEventsResult> {
    if (typeof this.port.importEventsFromJson === "function") {
      const result = await this.port.importEventsFromJson(json, strategy);
      this.notifyExternalChange();
      return result;
    }

    const payload = parseTransferPayload(json);
    const incoming = mergeEventsById([], payload.events);
    const existing = await this.readEventData();

    let next: EventData[];
    let imported = 0;
    let skipped = 0;

    if (strategy === "overwrite") {
      next = incoming;
      imported = incoming.length;
    } else {
      const existingIds = new Set(existing.map((event) => event.id));
      imported = incoming.filter((event) => !existingIds.has(event.id)).length;
      skipped = incoming.length - imported;
      next = mergeEventsById(existing, incoming);
    }

    await this.writeEventData(next);
    this.notifyExternalChange();

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

  notifyExternalChange(eventData?: EventData): void {
    const fallbackEventData: EventData = eventData ?? {
      id: `eventlog-refresh-${createUuidV4()}`,
      timestamp: Date.now(),
      content: "",
      tags: [NOTE_TAG],
      metadata: {
        source: getEventSourceMetadata(),
        refreshOnly: true,
      },
    };
    const event = this.deserializeEvent(fallbackEventData);
    this.listeners.forEach((cb) => cb(event));
  }

  /** 反序列化事件（从存储读取） */
  private deserializeEvent(data: EventData): Event {
    return {
      id: data.id,
      timestamp: data.timestamp,
      content: data.content,
      tags: new Set(data.tags),
      metadata: data.metadata,
      refs: normalizeEventRefs(data.refs),
    };
  }

  private async readEventData(
    options?: EventLogListOptions,
  ): Promise<EventData[]> {
    const result = await this.readEventDataDetailed(options);
    return result.events;
  }

  private async readEventDataDetailed(
    options?: EventLogListOptions,
  ): Promise<EventLogListResult> {
    if (typeof this.port.listEventsDetailed === "function") {
      return this.port.listEventsDetailed(options);
    }

    return {
      events: await this.port.listEvents(options),
      semantics: "full_snapshot",
    };
  }

  private async writeEventData(events: EventData[]): Promise<void> {
    await this.port.clearEvents();

    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    for (const event of sorted) {
      await this.port.appendRawEvent(event);
    }
  }
}

// 单例导出
let eventLogServiceInstance: EventLogService | null = null;

export function getEventLogService(): EventLogService {
  if (!eventLogServiceInstance) {
    const environment = ExoMindEnvironment.getInstance();
    eventLogServiceInstance = new EventLogServiceImpl({
      port: environment.eventlog,
    });
  }
  return eventLogServiceInstance;
}

export function notifyEventLogChanged(eventData?: EventData): void {
  if (
    eventLogServiceInstance &&
    eventLogServiceInstance instanceof EventLogServiceImpl
  ) {
    eventLogServiceInstance.notifyExternalChange(eventData);
  }
}
