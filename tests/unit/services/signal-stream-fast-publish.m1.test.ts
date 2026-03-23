import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalStreamService } from '@/lib/services/signal-stream.service';
import type { PublishRequest } from '@/lib/types/signal-pool';

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: tauriMocks.isTauri,
  invoke: tauriMocks.invoke,
}));

function createService() {
  return new SignalStreamService({
    host: {
      id: 'local',
      name: 'Local RT',
      host: '127.0.0.1',
      port: 1949,
      status: 'unknown',
      createdAt: '2026-03-04T00:00:00.000Z',
      updatedAt: '2026-03-04T00:00:00.000Z',
      isLocal: true,
    },
    agentId: 'ui',
  });
}

const requestPayload: PublishRequest = {
  topic: 'user.input.text',
  source: 'frontend:test',
  payload: { text: 'hello' },
};

describe('signal stream fast publish m1（invoke 高频桥接）', () => {
  beforeEach(() => {
    tauriMocks.isTauri.mockReset();
    tauriMocks.invoke.mockReset();
    vi.restoreAllMocks();
  });

  it('uses invoke fast-path in tauri（Tauri 环境优先 invoke）', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockResolvedValue({
      accepted: true,
      event_id: 'evt-fast-1',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const service = createService();
    const response = await service.publish(requestPayload);

    expect(tauriMocks.invoke).toHaveBeenCalledWith('signal_publish_fast', { request: requestPayload });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.accepted).toBe(true);
    expect(response.event_id).toBe('evt-fast-1');
  });

  it('falls back to HTTP when invoke fails（invoke 失败降级到 HTTP）', async () => {
    tauriMocks.isTauri.mockResolvedValue(true);
    tauriMocks.invoke.mockRejectedValue(new Error('invoke unavailable'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, event_id: 'evt-http-1' }),
    } as unknown as Response);

    const service = createService();
    const response = await service.publish(requestPayload);

    expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:1949/signals/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    });
    expect(response.event_id).toBe('evt-http-1');
  });

  it('uses HTTP directly in non-tauri（非 Tauri 直接走 HTTP）', async () => {
    tauriMocks.isTauri.mockResolvedValue(false);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, event_id: 'evt-http-2' }),
    } as unknown as Response);

    const service = createService();
    const response = await service.publish(requestPayload);

    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.event_id).toBe('evt-http-2');
  });
});
