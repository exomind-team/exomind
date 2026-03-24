import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { EventLogService } from '../../../../src/lib/services/eventlog.service';
import type { Tag } from '../../../../src/lib/types/event';
import { z } from 'zod';
import { parseToolArgs } from '../utils/zod-tool-parse';

const addEventArgsSchema = z
  .object({
    content: z.string().min(1, 'content is required'),
    tags: z.array(z.string()).optional(),
  })
  .strict();

const getEventsArgsSchema = z
  .object({
    limit: z.number().int().positive().optional(),
    tag: z.string().optional(),
  })
  .strict();

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
        const input = parseToolArgs(addEventArgsSchema, args);
        const content = input.content.trim();
        if (!content) throw new Error('content is required');

        const tags = input.tags ? new Set<Tag>(input.tags) : undefined;
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
        const input = parseToolArgs(getEventsArgsSchema, args);
        const limit = input.limit ? Math.max(1, input.limit) : 20;
        const tag = input.tag?.trim() || undefined;

        console.error('[DEBUG] Loading events...');
        const events = await eventLogService.loadEvents();
        console.error('[DEBUG] Events loaded:', events.length);

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
