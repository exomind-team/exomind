import type { EventData, Tag } from '../types/event';
import type { IEventLogPort } from '../environment/interfaces/eventlog.port';
import { getEventStorage, type Event as StorageEvent } from '../storage/event-storage';

const NOTE_TAG: Tag = 'note';

/**
 * WebEventLogStorageAdapter
 *
 * 基于 PouchDB EventStorage 实现 IEventLogPort
 */
export class WebEventLogStorageAdapter implements IEventLogPort {
  constructor(private readonly userId?: string) {}

  private get storage() {
    return getEventStorage(this.userId);
  }

  async listEvents(): Promise<EventData[]> {
    const events = await this.storage.getEvents();
    return events.map((event) => this.fromStorageEvent(event));
  }

  async appendEvent(event: EventData): Promise<void> {
    await this.storage.addEvent(this.toStorageEvent(event));
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
    return {
      id: event.id,
      timestamp: Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp,
      content: event.content,
      tags: this.normalizeTags(event.metadata?.tags, event.type),
    };
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

