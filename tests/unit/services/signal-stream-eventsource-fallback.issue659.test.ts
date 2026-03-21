import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalStreamService } from '@/lib/services/signal-stream.service';
import { log } from '@/lib/logger';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(async () => false),
  invoke: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

type MockEventListener = (event: MessageEvent<string>) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  readonly listeners = new Map<string, MockEventListener[]>();
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener as unknown as MockEventListener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((item) => item !== listener),
    );
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string, lastEventId = ''): void {
    const event = { data, lastEventId } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createService() {
  return new SignalStreamService({
    host: {
      id: 'external-rt',
      name: 'External RT',
      host: '192.168.1.204',
      port: 57047,
      status: 'unknown',
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      isLocal: false,
    },
    agentId: 'ui-test',
  });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SignalStreamService issue #659（SSE fetch 失败时回退 EventSource）', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('probes history and falls back to EventSource when fetch stream fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);
    const onSignal = vi.fn();

    const service = createService();
    service.onSignal(onSignal);
    service.start();
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('[SignalStream] open-stream:error target=http://192.168.1.204:57047 error=Failed to fetch'),
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('[SignalStream] probe:history target=http://192.168.1.204:57047 ok count=0'),
    );

    const eventSource = MockEventSource.instances[0];
    eventSource.onopen?.call(eventSource as unknown as EventSource, new Event('open'));
    eventSource.emit(
      'signal',
      JSON.stringify({
        schema_version: 1,
        id: 'evt-1',
        topic: 'review.completed',
        ts: 1,
        source: 'frontend:test',
        origin_host_id: 'host-1',
        hop: 0,
        payload: { ok: true },
      }),
      'evt-1',
    );

    expect(onSignal).toHaveBeenCalledWith(expect.objectContaining({
      id: 'evt-1',
      topic: 'review.completed',
    }));

    service.stop();
    await flushMicrotasks();
  });
});
