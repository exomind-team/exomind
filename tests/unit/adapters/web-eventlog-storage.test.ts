import { describe, expect, it } from 'vitest';
import type { EventData } from '@/lib/types/event';
import { applyEventLogListOptions } from '@/lib/adapters/web-eventlog-storage';

const sampleEvents: EventData[] = [
  {
    id: 'evt-newest',
    timestamp: 2_000,
    content: 'newest',
    tags: ['note'],
  },
  {
    id: 'evt-cursor',
    timestamp: 1_500,
    content: 'cursor',
    tags: ['note'],
  },
  {
    id: 'evt-late-old',
    timestamp: 500,
    content: 'late-old',
    tags: ['note'],
  },
];

describe('applyEventLogListOptions', () => {
  it('keeps full results when legacy adapters receive incremental cursor options（legacy 增量参数回退为全量结果）', () => {
    expect(applyEventLogListOptions(sampleEvents, {
      sinceId: 'evt-cursor',
      sinceTimestamp: 1_500,
    })).toEqual(sampleEvents);
  });

  it('still applies limit when only limit is provided（仅 limit 时仍保留截断能力）', () => {
    expect(applyEventLogListOptions(sampleEvents, {
      limit: 2,
    })).toEqual(sampleEvents.slice(0, 2));
  });
});
