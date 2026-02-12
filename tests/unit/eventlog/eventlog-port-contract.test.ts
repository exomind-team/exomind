import { describe, expect, it, vi } from 'vitest';
import type { EventData } from '@/lib/types/event';
import { EventLogServiceImpl } from '@/lib/services/eventlog.service';

describe('EventLogService port contract', () => {
  it('uses injected eventlog port for read/write instead of direct storage dependency', async () => {
    const port = {
      listEvents: vi.fn<() => Promise<EventData[]>>().mockResolvedValue([]),
      appendEvent: vi.fn<(_: EventData) => Promise<void>>().mockResolvedValue(undefined),
      getEvent: vi.fn<(_: string) => Promise<EventData | null>>().mockResolvedValue(null),
      clearEvents: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const service = new EventLogServiceImpl({ port });

    await service.loadEvents();
    await service.addEvent('hello from port');

    expect(port.listEvents).toHaveBeenCalled();
    expect(port.appendEvent).toHaveBeenCalledTimes(1);
  });
});
