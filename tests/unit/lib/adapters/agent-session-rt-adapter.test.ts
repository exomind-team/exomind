import { describe, expect, it, vi } from 'vitest';
import { AgentSessionRtAdapter } from '@/lib/adapters/agent-session-rt-adapter';

describe('agent session rt adapter（API Agent 会话 RT 适配器）', () => {
  it('posts broker session payload and parses result（提交 broker 会话并解析结果）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        sessionId: 'session-api-1',
        triggerSource: 'http-request',
        provider: 'openai',
        model: 'gpt-5',
        prompt: 'You are helpful.',
        content: '',
        assistantTurn: {
          content: '',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'get_recent_events',
              input: { limit: 5 },
            },
          ],
        },
        toolCalls: [
          {
            toolName: 'get_recent_events',
            input: { limit: 5 },
          },
        ],
        status: 'needs_tool_calls',
        createdAt: '2026-04-08T10:00:00.000Z',
        completedAt: '2026-04-08T10:00:01.000Z',
      }),
    }));

    const adapter = new AgentSessionRtAdapter({
      fetchImpl,
      resolveTarget: () => ({
        mode: 'external',
        host: '127.0.0.1',
        port: 9124,
        authToken: 'rt-token',
      }),
    });

    const result = await adapter.runSession({
      providerProfile: {
        profileId: 'registry-openai-main',
        name: 'OpenAI Main',
        provider: 'openai',
        model: 'gpt-5',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        createdAt: '2026-04-08T10:00:00.000Z',
        updatedAt: '2026-04-08T10:00:00.000Z',
      },
      systemPrompt: 'You are helpful.',
      presets: ['recent_events'],
      newUserMessage: '今天我做了什么？',
    });

    expect(result.sessionId).toBe('session-api-1');
    expect(result.status).toBe('needs_tool_calls');
    expect(result.assistantTurn.toolCalls[0]?.name).toBe('get_recent_events');

    const [url, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/agent-sessions');
    expect(new Headers(requestInit.headers).get('Authorization')).toBe('Bearer rt-token');
    expect(JSON.parse(String(requestInit.body))).toEqual(expect.objectContaining({
      systemPrompt: 'You are helpful.',
      presets: ['recent_events'],
      newUserMessage: '今天我做了什么？',
      providerProfile: expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5',
      }),
    }));
  });
});
