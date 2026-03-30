import type { EventData, EventMetadata, Tag } from '../types/event';
import type { EventLogListOptions, IEventLogPort } from '../environment/interfaces/eventlog.port';
import { getEventStorage, type Event as StorageEvent } from '../storage/event-storage';
import { appendEventWithEcsReplication } from '../services/ecs-eventlog-replication.service';

const NOTE_TAG: Tag = 'note';
const TAGS_METADATA_KEY = 'tags';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function applyEventLogListOptions(
  events: EventData[],
  options?: EventLogListOptions,
): EventData[] {
  if (!options) {
    return events;
  }

  let next = events;

  if (typeof options.sinceTimestamp === 'number') {
    next = next.filter((event) => event.timestamp >= options.sinceTimestamp!);
  }

  if (typeof options.sinceId === 'string' && options.sinceId.length > 0) {
    const index = next.findIndex((event) => event.id === options.sinceId);
    if (index >= 0) {
      next = next.slice(0, index);
    }
  }

  if (typeof options.limit === 'number') {
    next = next.slice(0, Math.max(0, options.limit));
  }

  return next;
}

/**
 * WebEventLogStorageAdapter
 *
 * 基于 PouchDB EventStorage 实现 IEventLogPort。
 *
 * 已弃用待删除：业务数据链路已切换到 RT EventLog，本适配器仅保留给
 * 旧版迁移/兼容路径使用，后续迁移完成后应整体移除。
 */
export class WebEventLogStorageAdapter implements IEventLogPort {
  constructor(private readonly userId?: string) {}

  private get storage() {
    return getEventStorage(this.userId);
  }

  async listEvents(options?: EventLogListOptions): Promise<EventData[]> {
    const events = await this.storage.getEvents();
    return applyEventLogListOptions(
      events.map((event) => this.fromStorageEvent(event)),
      options,
    );
  }

  async appendEvent(event: EventData): Promise<EventData> {
    const persisted = await appendEventWithEcsReplication(this.toStorageEvent(event), this.userId);
    return this.fromStorageEvent(persisted);
  }

  async getEvent(id: string): Promise<EventData | null> {
    const event = await this.storage.getEvent(id);
    if (!event) {
      return null;
    }
    return this.fromStorageEvent(event);
  }

  async clearEvents(): Promise<void> {
    await this.storage.clearAll();
  }

  private toStorageEvent(event: EventData): StorageEvent {
    const metadata = this.mergeMetadataWithTags(event.metadata, event.tags);
    return {
      id: event.id,
      content: event.content,
      createdAt: new Date(event.timestamp).toISOString(),
      type: event.tags[0] || NOTE_TAG,
      metadata,
    };
  }

  private fromStorageEvent(event: StorageEvent): EventData {
    const parsedTimestamp = Date.parse(event.createdAt);
    const metadataRecord = this.toMetadataRecord(event.metadata);
    const tags = this.normalizeTags(metadataRecord?.[TAGS_METADATA_KEY], event.type);
    const metadata = this.stripTagsFromMetadata(metadataRecord);

    return {
      id: event.id,
      timestamp: Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp,
      content: event.content,
      tags,
      metadata,
    };
  }

  private mergeMetadataWithTags(metadata: EventMetadata | undefined, tags: Tag[]): Record<string, unknown> {
    const baseMetadata = isRecord(metadata) ? { ...metadata } : {};
    return {
      ...baseMetadata,
      [TAGS_METADATA_KEY]: [...tags],
    };
  }

  private toMetadataRecord(rawMetadata: unknown): Record<string, unknown> | null {
    if (!isRecord(rawMetadata)) {
      return null;
    }
    return { ...rawMetadata };
  }

  private stripTagsFromMetadata(metadata: Record<string, unknown> | null): EventMetadata | undefined {
    if (!metadata) {
      return undefined;
    }
    const nextMetadata = { ...metadata };
    delete nextMetadata[TAGS_METADATA_KEY];
    return Object.keys(nextMetadata).length > 0 ? (nextMetadata as EventMetadata) : undefined;
  }

  private normalizeTags(rawTags: unknown, fallbackType?: string): Tag[] {
    if (Array.isArray(rawTags)) {
      const tags = rawTags.filter((tag): tag is Tag => typeof tag === 'string' && tag.length > 0);
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
