import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalStreamService } from '@/lib/services/signal-stream.service';
import type { PublishRequest, PublishResponse, SignalEvent } from '@/lib/types/signal-pool';

const HOST = {
  id: 'local',
  name: 'Local RT',
  host: '127.0.0.1',
  port: 1949,
  status: 'unknown',
  createdAt: '2026-03-06T00:00:00.000Z',
  updatedAt: '2026-03-06T00:00:00.000Z',
  isLocal: true,
} as const;

const REQUEST: PublishRequest = {
  topic: 'user.input.text',
  source: 'frontend:test',
  payload: { text: 'hello' },
};

const HISTORY: SignalEvent[] = [
  {
    schema_version: 1,
    id: 'evt-1',
    topic: 'test',
    ts: 1,
    source: 'frontend:test',
    origin_host_id: 'local',
    hop: 0,
    payload: {},
  },
];

describe('SignalStreamService transport delegation（SignalStreamService 走 transport 抽象）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates publish to injected transport（publish 委托给 transport）', async () => {
    const publish = vi.fn<(...args: [PublishRequest]) => Promise<PublishResponse>>().mockResolvedValue({
      accepted: true,
      event_id: 'evt-transport-1',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, event_id: 'evt-http-fallback' }),
    } as unknown as Response);

    const service = new SignalStreamService({
      host: HOST,
      agentId: 'ui',
      transport: {
        publish,
        history: vi.fn(),
        openStream: vi.fn(),
      },
    } as unknown as ConstructorParameters<typeof SignalStreamService>[0]);

    const response = await service.publish(REQUEST);

    expect(publish).toHaveBeenCalledWith(REQUEST);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.event_id).toBe('evt-transport-1');
  });

  it('delegates history to injected transport（history 委托给 transport）', async () => {
    const history = vi.fn<(...args: [number | undefined]) => Promise<SignalEvent[]>>().mockResolvedValue(HISTORY);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    const service = new SignalStreamService({
      host: HOST,
      agentId: 'ui',
      transport: {
        publish: vi.fn(),
        history,
        openStream: vi.fn(),
      },
    } as unknown as ConstructorParameters<typeof SignalStreamService>[0]);

    const events = await service.history(10);

    expect(history).toHaveBeenCalledWith(10);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events).toEqual(HISTORY);
  });
});
