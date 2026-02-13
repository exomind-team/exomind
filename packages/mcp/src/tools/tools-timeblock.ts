import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { TimerMode, TimerConfig, TimeBlock, ActiveBlockData } from '../../../../src/lib/types/event';
import type { TimeBlockService } from '../../../../src/lib/services/timeblock.service';

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isTimerMode(value: unknown): value is TimerMode {
  return value === 'countup' || value === 'countdown';
}

function formatActiveBlock(block: ActiveBlockData): Record<string, unknown> {
  return {
    startId: block.startId,
    name: block.name,
    mode: block.mode,
    targetMinutes: block.targetMinutes,
    elapsed: block.elapsed,
    startTime: block.startTime,
    updatedAt: block.updatedAt,
    paused: block.paused,
    pausedAt: block.pausedAt,
  };
}

function formatTimeBlock(block: TimeBlock): Record<string, unknown> {
  return {
    id: block.id,
    name: block.name,
    startId: block.startId,
    endId: block.endId,
    note: block.note,
    tags: Array.from(block.tags),
    startTime: block.startTime,
    endTime: block.endTime,
  };
}

function filterByDate(blocks: TimeBlock[], dateString: string): TimeBlock[] {
  const day = new Date(dateString);
  if (Number.isNaN(day.getTime())) {
    throw new Error('date must be a valid date string (e.g. 2026-02-13)');
  }

  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  const startMs = start.getTime();
  const endMs = end.getTime();
  return blocks.filter((block) => block.startTime >= startMs && block.startTime <= endMs);
}

export function createTimeBlockTools(
  timeBlockService: TimeBlockService,
): Array<{ tool: Tool; handler: (args: Record<string, unknown>) => Promise<unknown> }> {
  const startTool: Tool = {
    name: 'exomind_start_block',
    description: 'Start a time block (TimeBlockService.startBlock).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Block name' },
        mode: { type: 'string', enum: ['countup', 'countdown'], description: 'Timer mode' },
        minutes: { type: 'number', description: 'Countdown minutes (mode=countdown)' },
      },
      required: ['name', 'mode'],
      additionalProperties: false,
    },
  };

  const endTool: Tool = {
    name: 'exomind_end_block',
    description: 'End current time block (TimeBlockService.endBlock).',
    inputSchema: {
      type: 'object',
      properties: {
        feedback: { type: 'string', description: 'Optional feedback note' },
      },
      additionalProperties: false,
    },
  };

  const getBlocksTool: Tool = {
    name: 'exomind_get_blocks',
    description: 'Get completed time blocks (TimeBlockService.loadTimeBlocks).',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Optional date filter (YYYY-MM-DD)' },
      },
      additionalProperties: false,
    },
  };

  return [
    {
      tool: startTool,
      async handler(args) {
        const name = asString(args.name);
        const mode = args.mode;
        if (!name || !name.trim()) throw new Error('name is required');
        if (!isTimerMode(mode)) throw new Error('mode must be countup or countdown');

        const minutesRaw = asNumber(args.minutes);
        const config: TimerConfig =
          mode === 'countdown'
            ? {
                mode,
                minutes: minutesRaw !== null ? Math.max(1, Math.floor(minutesRaw)) : undefined,
              }
            : { mode };

        const block = await timeBlockService.startBlock(name, config);
        return { block: formatActiveBlock(block) };
      },
    },
    {
      tool: endTool,
      async handler(args) {
        const feedback = asString(args.feedback) ?? undefined;
        const ended = await timeBlockService.endBlock(feedback);
        return { block: ended ? formatTimeBlock(ended) : null };
      },
    },
    {
      tool: getBlocksTool,
      async handler(args) {
        const date = asString(args.date);
        const blocks = await timeBlockService.loadTimeBlocks();
        const filtered = date ? filterByDate(blocks, date) : blocks;
        return { count: filtered.length, blocks: filtered.map(formatTimeBlock) };
      },
    },
  ];
}
