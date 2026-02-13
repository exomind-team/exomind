/**
 * EventLog MCP Tools - With real Service integration
 *
 * Provides tools for adding and retrieving events from ExoMind EventLog
 */

import PouchDB from 'pouchdb-node';

// Types
interface AddEventInput {
  content: string;
  tags?: string[];
}

interface GetEventsInput {
  limit?: number;
  tag?: string;
}

interface EventDoc {
  _id: string;
  _rev?: string;
  id: string;
  content: string;
  createdAt: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

// Database instance
let db: PouchDB.Database | null = null;

function getDb(): PouchDB.Database {
  if (!db) {
    db = new PouchDB('exomind-events');
  }
  return db;
}

// Tool definitions
export function createEventTools() {
  return [
    {
      name: 'exomind_add_event',
      description: 'Add a new event to ExoMind EventLog',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'The content of the event',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for the event',
          },
        },
        required: ['content'],
      },
      handler: async (args: unknown) => {
        const input = args as AddEventInput;
        const eventId = crypto.randomUUID();
        const timestamp = Date.now();

        const doc: EventDoc = {
          _id: `event:${eventId}`,
          id: eventId,
          content: input.content,
          createdAt: new Date(timestamp).toISOString(),
          type: input.tags?.[0] || 'note',
          metadata: {
            tags: input.tags || ['note'],
          },
        };

        const database = getDb();
        await database.put(doc);

        return {
          success: true,
          eventId,
          timestamp,
          content: input.content,
          tags: input.tags || ['note'],
        };
      },
    },
    {
      name: 'exomind_get_events',
      description: 'Get events from ExoMind EventLog',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of events to return (default: 20)',
            default: 20,
          },
          tag: {
            type: 'string',
            description: 'Filter events by tag',
          },
        },
      },
      handler: async (args: unknown) => {
        const input = args as GetEventsInput;
        const limit = input.limit || 20;

        const database = getDb();

        // Query events sorted by createdAt descending
        const result = await database.allDocs({
          include_docs: true,
          startkey: 'event:',
          endkey: 'event:\ufff0',
        });

        let events = result.rows
          .map((row) => row.doc as EventDoc)
          .filter((doc) => doc && doc._id.startsWith('event:'))
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Filter by tag if specified
        if (input.tag) {
          events = events.filter(
            (doc) => doc.metadata?.tags && (doc.metadata.tags as string[]).includes(input.tag!)
          );
        }

        // Apply limit
        events = events.slice(0, limit);

        return {
          success: true,
          count: events.length,
          events: events.map((doc) => ({
            id: doc.id,
            timestamp: new Date(doc.createdAt).getTime(),
            content: doc.content,
            tags: (doc.metadata?.tags as string[]) || [doc.type || 'note'],
          })),
        };
      },
    },
  ];
}
