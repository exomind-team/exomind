import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SignalStreamService } from '@/lib/services/signal-stream.service';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(async () => false),
  invoke: vi.fn(),
}));

function createService() {
  return new SignalStreamService({
    host: {
      id: 'local',
      name: 'Local RT',
      host: '127.0.0.1',
      port: 4077,
      status: 'unknown',
      createdAt: '2026-03-05T00:00:00.000Z',
      updatedAt: '2026-03-05T00:00:00.000Z',
      isLocal: true,
    },
    agentId: 'ui-test',
  });
}

describe('signal-stream m4（连接失败降噪）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deduplicates retry warning for repeated same fetch errors（同类重连错误只记录一次）', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Failed to fetch'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const service = createService();
    service.start();

    // First attempt happens immediately, then retries after 1s / 2s.
    await vi.advanceTimersByTimeAsync(3_200);
    service.stop();
    await vi.advanceTimersByTimeAsync(100);

    const retryWarnCalls = warnSpy.mock.calls.filter((call) =>
      String(call[1]).includes('[SignalStream] connection retry:'),
    );

    expect(fetchSpy).toHaveBeenCalled();
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(retryWarnCalls).toHaveLength(1);
    expect(String(retryWarnCalls[0][1])).toContain('Failed to fetch');
    expect(String(retryWarnCalls[0][1])).toContain('127.0.0.1:4077');
  });
});
