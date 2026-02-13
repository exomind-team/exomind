import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { EventLogService } from '../../../../src/lib/services/eventlog.service';
import type { Tag } from '../../../../src/lib/types/event';

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.every((item) => typeof item === 'string')) return value;
  return null;
}

export function createEventTools(
  eventLogService: EventLogService,
): Array<{ tool: Tool; handler: (args: Record<string, unknown>) => Promise<unknown> }> {
  const addEventTool: Tool = {
    name: 'exomind_add_event',
    description: 'Add an event to ExoMind event log (EventLogService.addEvent).',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Event content' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  };

  const getEventsTool: Tool = {
    name: 'exomind_get_events',
    description: 'Get latest events from ExoMind event log (EventLogService.loadEvents).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max events to return (default: 20)' },
        tag: { type: 'string', description: 'Filter by tag' },
      },
      additionalProperties: false,
    },
  };

  return [
    {
      tool: addEventTool,
      async handler(args) {
        const content = asString(args.content);
        if (!content || !content.trim()) {
          throw new Error('content is required');
        }

        const tagsRaw = asStringArray(args.tags);
        const tags = tagsRaw ? new Set<Tag>(tagsRaw) : undefined;
        const event = await eventLogService.addEvent(content, tags);

        return {
          eventId: event.id,
          timestamp: event.timestamp,
          content: event.content,
          tags: Array.from(event.tags),
        };
      },
    },
    {
      tool: getEventsTool,
      async handler(args) {
        const limitRaw = typeof args.limit === 'number' ? args.limit : undefined;
        const limit = limitRaw && Number.isFinite(limitRaw) ? Math.max(1, Math.floor(limitRaw)) : 20;
        const tag = asString(args.tag);

        const events = await eventLogService.loadEvents();
        const filtered = tag ? events.filter((event) => event.tags.has(tag)) : events;
        const sliced = filtered.slice(0, limit);

        return {
          count: sliced.length,
          events: sliced.map((event) => ({
            id: event.id,
            timestamp: event.timestamp,
            content: event.content,
            tags: Array.from(event.tags),
          })),
        };
      },
    },
  ];
}
