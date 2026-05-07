import PouchDB from 'pouchdb';
import type {
  EventLogAppendInput,
  IEventLogPort,
} from '../../../../src/lib/environment/interfaces/eventlog.port';
import type { EventData, Tag } from '../../../../src/lib/types/event';

interface StorageEventDoc {
  _id: string;
  _rev?: string;
  id: string;
  content: string;
  createdAt: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

const NOTE_TAG: Tag = 'note';

function toDoc(event: EventData): StorageEventDoc {
  return {
    _id: `event:${event.id}`,
    id: event.id,
    content: event.content,
    createdAt: new Date(event.timestamp).toISOString(),
    type: event.tags[0] || NOTE_TAG,
    metadata: {
      tags: event.tags,
    },
  };
}

function fromDoc(doc: StorageEventDoc): EventData {
  const parsedTimestamp = Date.parse(doc.createdAt);
  const tags = normalizeTags(doc.metadata?.tags, doc.type);

  return {
    id: doc.id,
    timestamp: Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp,
    content: doc.content,
    tags,
  };
}

function normalizeTags(rawTags: unknown, fallbackType?: string): string[] {
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

export class RemoteEventLogPort implements IEventLogPort {
  private db: PouchDB.Database<StorageEventDoc>;

  constructor(remoteDbUrl: string) {
    this.db = new PouchDB<StorageEventDoc>(remoteDbUrl);
  }

  async listEvents(): Promise<EventData[]> {
    const result = await this.db.allDocs({
      include_docs: true,
      startkey: 'event:',
      endkey: 'event:\ufff0',
    });

    const docs = result.rows
      .map((row) => row.doc)
      .filter((doc): doc is StorageEventDoc => Boolean(doc) && typeof doc._id === 'string' && doc._id.startsWith('event:'));

    return docs.map(fromDoc);
  }

  async appendEvent(event: EventLogAppendInput): Promise<EventData> {
    const persistedEvent: EventData = {
      ...event,
      timestamp: Date.now(),
    };
    const doc = toDoc(persistedEvent);

    try {
      await this.db.put(doc);
    } catch (error) {
      // In case of conflict, fetch current rev and retry once.
      if (error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 409) {
        const existing = await this.db.get(doc._id);
        await this.db.put({ ...doc, _rev: existing._rev });
        return persistedEvent;
      }
      throw error;
    }
    return persistedEvent;
  }

  async appendRawEvent(event: EventData): Promise<EventData> {
    const doc = toDoc(event);

    try {
      await this.db.put(doc);
    } catch (error) {
      // In case of conflict, fetch current rev and retry once.
      if (error && typeof error === 'object' && 'status' in error && (error as { status?: number }).status === 409) {
        const existing = await this.db.get(doc._id);
        await this.db.put({ ...doc, _rev: existing._rev });
        return event;
      }
      throw error;
    }
    return event;
  }

  async getEvent(id: string): Promise<EventData | null> {
    try {
      const doc = await this.db.get(`event:${id}`);
      return fromDoc(doc);
    } catch {
      return null;
    }
  }

  async clearEvents(): Promise<void> {
    const result = await this.db.allDocs({
      include_docs: true,
      startkey: 'event:',
      endkey: 'event:\ufff0',
    });

    const toDelete = result.rows
      .filter((row) => row.id && row.id.startsWith('event:') && row.value?.rev)
      .map((row) => ({
        _id: row.id,
        _rev: row.value!.rev,
        _deleted: true,
      }));

    if (toDelete.length > 0) {
      await this.db.bulkDocs(toDelete as unknown as Parameters<typeof this.db.bulkDocs>[0]);
    }
  }
}
