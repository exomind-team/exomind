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

  it('streams typed runtime events from SSE（从 SSE 流式解析 typed Runtime 事件）', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"session.started","session_id":"sid-123"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"output.delta","content":"你好"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"thinking.delta","content":"正在分析"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"tool.call","name":"search","payload":{"query":"Claude CLI"}}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"tool.result","name":"search","payload":{"items":1}}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
          controller.close();
        },
      }),
    }));

    const client = new RuntimeClient({ fetchImpl });
    const chunks = [];

    for await (const chunk of client.streamAgentConversation(SAMPLE_HOST, {
      agentId: 'claude',
      message: '你好',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'session.started', sessionId: 'sid-123' },
      { type: 'output.delta', content: '你好' },
      { type: 'thinking.delta', content: '正在分析' },
      { type: 'tool.call', name: 'search', payload: { query: 'Claude CLI' } },
      { type: 'tool.result', name: 'search', payload: { items: 1 } },
      { type: 'done' },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:1919/agents/claude/chat',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('maps legacy runtime chunks into typed events（把 legacy Runtime chunk 映射成 typed 事件）', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"content":"你好","session_id":"sid-legacy"}\n\n'));
          controller.enqueue(encoder.encode('data: {"content":"，我是 Claude"}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    }));

    const client = new RuntimeClient({ fetchImpl });
    const chunks = [];

    for await (const chunk of client.streamAgentConversation(SAMPLE_HOST, {
      agentId: 'claude',
      message: '你好',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'session.started', sessionId: 'sid-legacy' },
      { type: 'output.delta', content: '你好' },
      { type: 'output.delta', content: '，我是 Claude' },
      { type: 'done' },
    ]);
  });
});
