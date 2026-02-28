import { describe, expect, it, vi } from 'vitest';
import type { RuntimeHostRecord } from '@/lib/types/agent-hub';
import { RuntimeClient } from '@/services/runtime-client';

const SAMPLE_HOST: RuntimeHostRecord = {
  id: 'runtime-host-1',
  name: 'Local Runtime',
  host: '127.0.0.1',
  port: 1919,
  status: 'unknown',
  createdAt: '2026-02-28T00:00:00.000Z',
  updatedAt: '2026-02-28T00:00:00.000Z',
};

describe('runtime client issue-201（Runtime HTTP 客户端）', () => {
  it('fetches agents from /agents（从 /agents 拉取 agent 列表）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'echo',
          name: 'Echo Agent',
          description: '回显输入内容',
          status: 'available',
        },
      ],
    }));

    const client = new RuntimeClient({ fetchImpl });
    const result = await client.getAgents(SAMPLE_HOST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('echo');
    expect(result.data[0]?.name).toBe('Echo Agent');
    expect(result.data[0]?.status).toBe('available');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:1919/agents', expect.any(Object));
  });

  it('returns timeout error for aborted request（请求中止时返回 timeout 错误）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('AbortError: The operation was aborted');
    });

    const client = new RuntimeClient({ fetchImpl, timeoutMs: 10 });
    const result = await client.getAgents(SAMPLE_HOST);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('timeout');
  });

  it('returns http error for non-2xx topology response（/topology 非 2xx 时返回 http 错误）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'unavailable' }),
    }));

    const client = new RuntimeClient({ fetchImpl });
    const result = await client.getTopology(SAMPLE_HOST);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('http');
    expect(result.error.status).toBe(503);
  });
});
