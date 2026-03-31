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

  it('prefers dial override and auth token for protected runtime requests（优先使用拨号地址 override 并附带鉴权）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        host_id: 'runtime-host-1',
        hostname: 'android-node',
        os: 'android',
        arch: 'arm64',
        uptime_secs: 100,
        version: '0.3.6',
        port: 9124,
        capabilities: {
          agent_kinds: ['api'],
          api_providers: ['openai'],
        },
      }),
    }));
    const client = new RuntimeClient({ fetchImpl });
    const result = await client.getTopology({
      ...SAMPLE_HOST,
      host: '10.0.2.15',
      port: 9124,
      manualOverride: '127.0.0.1:39124',
      authToken: 'shared-secret',
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:39124/topology',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Object),
      }),
    );
    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(requestInit.headers).get('Authorization')).toBe('Bearer shared-secret');
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

  it('parses topology capabilities from /topology（解析 /topology 的运行时能力）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        host_id: 'runtime-host-1',
        hostname: 'local-dev',
        os: 'Windows 11',
        arch: 'x86_64',
        uptime_secs: 100,
        version: '0.3.6',
        port: 1919,
        total_memory_mb: 16000,
        used_memory_mb: 8000,
        capabilities: {
          agent_kinds: ['claude_cli', 'api'],
          api_providers: ['openai', 'anthropic'],
        },
      }),
    }));

    const client = new RuntimeClient({ fetchImpl });
    const result = await client.getTopology(SAMPLE_HOST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.capabilities.agent_kinds).toEqual(['claude_cli', 'api']);
    expect(result.data.capabilities.api_providers).toEqual(['openai', 'anthropic']);
  });

  it('streams agent chat chunks from SSE（从 SSE 流式解析 Agent 对话分片）', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"content":"你好","session_id":"sid-123"}\n\n'));
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
      { type: 'output.delta', content: '你好', sessionId: 'sid-123', done: false },
      { type: 'output.delta', content: '，我是 Claude', done: false },
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

  it('parses typed runtime events from SSE（解析带类型的 Runtime SSE 事件）', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"session.started","session_id":"sid-typed"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"output.delta","content":"你好"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"thinking.delta","content":"正在思考"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"done","finish_reason":"stop"}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
    }));

    const client = new RuntimeClient({ fetchImpl });
    const chunks = [];

    for await (const chunk of client.streamAgentConversation(SAMPLE_HOST, {
      agentId: 'codex-1',
      message: '你好',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: 'session.started', content: '', sessionId: 'sid-typed', done: false },
      { type: 'output.delta', content: '你好', done: false },
      { type: 'thinking.delta', content: '正在思考', done: false },
      { type: 'done', content: '', finishReason: 'stop', done: true },
    ]);
  });

  it('serializes api agent create payload with provider profile（创建 API Agent 时序列化 provider profile）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'api-agent-1',
        name: 'API Agent',
        description: 'OpenAI runtime agent',
        status: 'available',
      }),
    }));

    const client = new RuntimeClient({ fetchImpl });
    const result = await client.createAgent(SAMPLE_HOST, {
      kind: 'api',
      id: 'api-agent-1',
      name: 'API Agent',
      description: 'OpenAI runtime agent',
      providerProfile: {
        profileId: 'provider-profile-1',
        name: 'OpenAI GPT-5',
        provider: 'openai',
        model: 'gpt-5',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        createdAt: '2026-03-07T00:00:00.000Z',
        updatedAt: '2026-03-07T00:00:00.000Z',
      },
    });

    expect(result.ok).toBe(true);

    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(requestInit?.body).toBeDefined();
    expect(JSON.parse(String(requestInit.body))).toEqual(expect.objectContaining({
      kind: 'api',
      id: 'api-agent-1',
      name: 'API Agent',
      description: 'OpenAI runtime agent',
      provider_profile: expect.objectContaining({
        profile_id: 'provider-profile-1',
        provider: 'openai',
        model: 'gpt-5',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-test',
      }),
    }));
  });

  it('posts refill energy request and normalizes response（POST 充能请求并解析 revive 响应）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        energy: {
          agent_id: 'life-alpha',
          current: 100,
          max: 100,
          ratio: 1,
          tick_cost: 5,
          phase: 'normal',
          is_dormant: false,
        },
        revived: true,
        tick_spawned: true,
      }),
    }));

    const client = new RuntimeClient({ fetchImpl });
    const result = await client.refillEnergy(SAMPLE_HOST, 'life-alpha', 100);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.revived).toBe(true);
    expect(result.data.tickSpawned).toBe(true);
    expect(result.data.energy.agent_id).toBe('life-alpha');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:1919/agents/life-alpha/energy/refill',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ amount: 100 }),
      }),
    );
  });

  it('posts stop request for PTY agent（向 PTY stop 路由发送停止请求）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'pty-123',
        name: 'Terminal Agent',
        session_id: null,
        workdir: 'D:/project/exomind',
        command: 'claude',
        status: 'stopped',
        created_at: '2026-03-15T00:00:00.000Z',
      }),
    }));

    const client = new RuntimeClient({ fetchImpl });
    const result = await client.stopPtyAgent(SAMPLE_HOST, 'pty-123');

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:1919/pty/pty-123/stop',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('returns invalid payload when stop PTY response misses required fields（stop PTY 缺少必填字段时返回 invalid_payload）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'pty-123',
        name: 'Terminal Agent',
        workdir: 'D:/project/exomind',
        status: 'stopped',
        created_at: '2026-03-15T00:00:00.000Z',
      }),
    }));

    const client = new RuntimeClient({ fetchImpl });
    const result = await client.stopPtyAgent(SAMPLE_HOST, 'pty-123');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('invalid_payload');
  });
});
