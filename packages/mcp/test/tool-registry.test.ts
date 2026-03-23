import { describe, expect, test } from 'bun:test';
import { createToolRegistryWithDependencies } from '../src/tools/tool-registry';
import type { EventLogService } from '../../../src/lib/services/eventlog.service';
import type { TimeBlockService } from '../../../src/lib/services/timeblock.service';
import type { Event, TimeBlock, ActiveBlockData, TimerConfig } from '../../../src/lib/types/event';

function parseToolText(result: { content: Array<{ type: 'text'; text: string }> }): any {
  expect(result.content[0]?.type).toBe('text');
  return JSON.parse(result.content[0]!.text);
}

describe('MCP tool registry', () => {
  test('lists expected tools', async () => {
    const registry = createToolRegistryWithDependencies({
      eventLogService: createFakeEventLogService(),
      timeBlockService: createFakeTimeBlockService(),
    });

    const tools = registry.listTools().map((tool) => tool.name).sort();
    expect(tools).toEqual([
      'exomind_add_event',
      'exomind_end_block',
      'exomind_get_auth_status',
      'exomind_get_blocks',
      'exomind_get_events',
      'exomind_start_block',
    ]);
  });

  test('unknown tool returns error', async () => {
    const registry = createToolRegistryWithDependencies({
      eventLogService: createFakeEventLogService(),
      timeBlockService: createFakeTimeBlockService(),
    });

    const result = await registry.callTool('does_not_exist', {});
    const parsed = parseToolText(result);
    expect(parsed.success).toBe(false);
    expect(String(parsed.error)).toContain('Unknown tool');
  });

  test('exomind_add_event + exomind_get_events', async () => {
    const eventLogService = createFakeEventLogService();
    const registry = createToolRegistryWithDependencies({
      eventLogService,
      timeBlockService: createFakeTimeBlockService(),
    });

    const addResult = await registry.callTool('exomind_add_event', { content: 'hello', tags: ['note', 'tag1'] });
    const addParsed = parseToolText(addResult);
    expect(addParsed.success).toBe(true);
    expect(typeof addParsed.eventId).toBe('string');

    const listResult = await registry.callTool('exomind_get_events', { limit: 10 });
    const listParsed = parseToolText(listResult);
    expect(listParsed.success).toBe(true);
    expect(listParsed.count).toBe(1);
    expect(listParsed.events[0].content).toBe('hello');
    expect(listParsed.events[0].tags).toEqual(expect.arrayContaining(['note', 'tag1']));
  });

  test('exomind_start_block + exomind_end_block + exomind_get_blocks', async () => {
    const timeBlockService = createFakeTimeBlockService();
    const registry = createToolRegistryWithDependencies({
      eventLogService: createFakeEventLogService(),
      timeBlockService,
    });

    const start = await registry.callTool('exomind_start_block', { name: 'Focus', mode: 'countdown', minutes: 15 });
    const startParsed = parseToolText(start);
    expect(startParsed.success).toBe(true);
    expect(startParsed.block.name).toBe('Focus');
    expect(startParsed.block.mode).toBe('countdown');

    const end = await registry.callTool('exomind_end_block', { feedback: 'done' });
    const endParsed = parseToolText(end);
    expect(endParsed.success).toBe(true);
    expect(endParsed.block.name).toBe('Focus');
    expect(endParsed.block.note).toBe('done');

    const blocks = await registry.callTool('exomind_get_blocks', {});
    const blocksParsed = parseToolText(blocks);
    expect(blocksParsed.success).toBe(true);
    expect(blocksParsed.count).toBe(1);
    expect(blocksParsed.blocks[0].name).toBe('Focus');
  });
});

function createFakeEventLogService(): EventLogService {
  const items: Event[] = [];
  return {
    async loadEvents() {
      return [...items].sort((a, b) => b.timestamp - a.timestamp);
    },
    async addEvent(content, tags) {
      const event: Event = {
        id: `e_${items.length + 1}`,
        timestamp: Date.now(),
        content,
        tags: tags ?? new Set(['note']),
      };
      items.unshift(event);
      return event;
    },
    async exportEventsAsJson() {
      return JSON.stringify({ events: items });
    },
    async importEventsFromJson() {
      return { imported: 0, skipped: 0, total: items.length };
    },
    onEvent() {
      return () => undefined;
    },
  };
}

function createFakeTimeBlockService(): TimeBlockService {
  const blocks: TimeBlock[] = [];
  let active: ActiveBlockData | null = null;

  return {
    async loadTimeBlocks() {
      return [...blocks];
    },
    async loadActiveBlock() {
      return active;
    },
    async startBlock(name: string, config: TimerConfig) {
      const now = Date.now();
      active = {
        startId: `s_${now}`,
        name,
        mode: config.mode,
        targetMinutes: config.mode === 'countdown' ? config.minutes : undefined,
        elapsed: 0,
        startTime: now,
        updatedAt: now,
        paused: false,
      };
      return active;
    },
    async pauseBlock() {
      if (active) active.paused = true;
    },
    async resumeBlock() {
      if (active) active.paused = false;
    },
    async endBlock(feedback?: string) {
      if (!active) return null;
      const ended: TimeBlock = {
        id: active.startId,
        name: active.name,
        startId: active.startId,
        endId: `end_${Date.now()}`,
        note: feedback,
        tags: new Set(feedback ? ['block_feedback'] : []),
        startTime: active.startTime,
        endTime: Date.now(),
      };
      blocks.push(ended);
      active = null;
      return ended;
    },
    async updateElapsed() {},
    onBlockChange() {
      return () => undefined;
    },
  };
}

