import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishRequest } from '@/lib/types/signal-pool';
import { HttpSseSignalTransport } from '@/lib/services/signal-http-sse-transport';

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: tauriMocks.isTauri,
  invoke: tauriMocks.invoke,
}));

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

describe('HttpSseSignalTransport（HTTP/SSE 传输适配器）', () => {
  beforeEach(() => {
    tauriMocks.isTauri.mockReset();
    tauriMocks.invoke.mockReset();
    vi.restoreAllMocks();
  });

  it('uses tauri fast publish when available（Tauri 下优先走快速发布）', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue({
      accepted: true,
      event_id: 'evt-fast-transport',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const transport = new HttpSseSignalTransport({ host: HOST });
    const response = await transport.publish(REQUEST);

    expect(tauriMocks.invoke).toHaveBeenCalledWith('signal_publish_fast', { request: REQUEST });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.event_id).toBe('evt-fast-transport');
  });

  it('does not use tauri fast publish for external host（外部 RT 不应误走本地快速发布）', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue({
      accepted: true,
      event_id: 'evt-fast-should-not-run',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, event_id: 'evt-http-external' }),
    } as Response);

    const transport = new HttpSseSignalTransport({
      host: {
        ...HOST,
        id: 'remote',
        name: 'Remote RT',
        host: '192.168.1.10',
        port: 4077,
        isLocal: false,
      },
    });
    const response = await transport.publish(REQUEST);

    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('http://192.168.1.10:4077/signals/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(REQUEST),
    });
    expect(response.event_id).toBe('evt-http-external');
  });

  it('falls back to HTTP when tauri invoke fails（快速发布失败后降级到 HTTP）', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockRejectedValue(new Error('invoke unavailable'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, event_id: 'evt-http-transport' }),
    } as Response);

    const transport = new HttpSseSignalTransport({ host: HOST });
    const response = await transport.publish(REQUEST);

    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:1949/signals/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(REQUEST),
    });
    expect(response.event_id).toBe('evt-http-transport');
  });

  it('uses HTTP directly for external runtime target in tauri（外部 Runtime 不走本地快速发布）', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue({
      accepted: true,
      event_id: 'evt-fast-should-not-run',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, event_id: 'evt-http-external' }),
    } as Response);

    const transport = new HttpSseSignalTransport({
      host: {
        ...HOST,
        id: 'desktop-peer',
        name: 'Desktop Peer',
        host: '192.168.1.22',
        isLocal: false,
      },
    });
    const response = await transport.publish(REQUEST);

    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('http://192.168.1.22:1949/signals/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(REQUEST),
    });
    expect(response.event_id).toBe('evt-http-external');
  });

  it('adds Last-Event-ID when opening stream（建立 SSE 时带上 Last-Event-ID）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      body: { getReader: vi.fn() },
      headers: { get: vi.fn(() => 'text/event-stream') },
    } as unknown as Response);

    const transport = new HttpSseSignalTransport({ host: HOST });
    await transport.openStream({
      agentId: 'ui',
      heartbeatInterval: 30,
      lastEventId: 'evt-last-1',
      signal: new AbortController().signal,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/signals/stream?agent_id=ui&heartbeat_interval=30',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Last-Event-ID': 'evt-last-1',
        }),
      })
    );
  });

  it('builds filtered history query for proof polling（history 查询支持 proof 过滤参数）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ([]),
    } as Response);

    const transport = new HttpSseSignalTransport({
      host: {
        ...HOST,
        authToken: 'proof-token',
      },
    });

    await (transport as unknown as {
      history: (query: unknown) => Promise<unknown>;
    }).history({
      limit: 40,
      topicPrefix: 'system.link_proof.',
      afterEventId: 'evt-last-proof',
      excludeTopicPrefix: 'system.link_proof.resultless',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:1949/signals/history?limit=40&topic_prefix=system.link_proof.&after_event_id=evt-last-proof&exclude_topic_prefix=system.link_proof.resultless',
      {
        headers: {
          Authorization: 'Bearer proof-token',
        },
      },
    );
  });
});
