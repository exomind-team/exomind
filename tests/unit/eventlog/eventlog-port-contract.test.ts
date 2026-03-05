import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventData } from '@/lib/types/event';
import { EventLogServiceImpl } from '@/lib/services/eventlog.service';

const originalCrypto = globalThis.crypto;

function replaceGlobalCrypto(value: Crypto | undefined): void {
  Object.defineProperty(globalThis, 'crypto', {
    value,
    configurable: true,
    writable: true,
  });
}

describe('EventLogService port contract', () => {
  afterEach(() => {
    replaceGlobalCrypto(originalCrypto);
  });

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
    const [event] = port.appendEvent.mock.calls[0] as [EventData];
    expect(event.metadata?.source).toEqual(expect.objectContaining({
      app: 'ExoMind',
      deviceId: expect.any(String),
      deviceName: expect.any(String),
      platform: expect.any(String),
    }));
  });

  it('keeps addEvent working when crypto.randomUUID is unavailable', async () => {
    const port = {
      listEvents: vi.fn<() => Promise<EventData[]>>().mockResolvedValue([]),
      appendEvent: vi.fn<(_: EventData) => Promise<void>>().mockResolvedValue(undefined),
      getEvent: vi.fn<(_: string) => Promise<EventData | null>>().mockResolvedValue(null),
      clearEvents: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const getRandomValues = vi.fn((array: Uint8Array) => {
      array.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return array;
    });

    replaceGlobalCrypto({ getRandomValues } as unknown as Crypto);

    const service = new EventLogServiceImpl({ port });
    await service.addEvent('fallback path');

    expect(port.appendEvent).toHaveBeenCalledTimes(1);
    const [event] = port.appendEvent.mock.calls[0] as [EventData];
    expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(event.metadata?.source).toEqual(expect.objectContaining({
      app: 'ExoMind',
    }));
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });
});
