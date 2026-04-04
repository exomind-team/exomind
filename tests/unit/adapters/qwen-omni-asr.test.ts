import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QwenOmniASRAdapter } from '@/lib/adapters/asr/qwen-omni-asr';

const streamingSuccessResponse = new Response(
  [
    'data: {"choices":[{"delta":{"content":"整理后"}}]}',
    'data: {"choices":[{"delta":{"content":"的语音文本"}}]}',
    'data: {"choices":[],"usage":{"total_tokens":12}}',
    'data: [DONE]',
  ].join('\n\n'),
  {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  }
);

const streamingOptimizeResponse = new Response(
  [
    'data: {"choices":[{"delta":{"content":"第一段"}}]}',
    'data: {"choices":[{"delta":{"content":"\\n\\n第二段"}}]}',
    'data: {"choices":[],"usage":{"total_tokens":8}}',
    'data: [DONE]',
  ].join('\n\n'),
  {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
    },
  }
);

const accessDeniedResponse = new Response(
  JSON.stringify({
    error: {
      message: 'Access denied',
      type: 'access_denied',
      code: 'access_denied',
    },
  }),
  {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
    },
  }
);

describe('QwenOmniASRAdapter（Qwen 全模态语音适配器）', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it('reports unavailable when profile config is incomplete（缺少供应商档案配置时不可用）', () => {
    const adapter = new QwenOmniASRAdapter({
      profileName: '',
      apiKey: '',
      baseUrl: '',
      model: '',
    });

    expect(adapter.isAvailable()).toBe(false);
  });

  it('streams Qwen Omni audio transcription with SSE parsing（Qwen Omni 语音转写必须走流式 SSE）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamingSuccessResponse.clone());
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const adapter = new QwenOmniASRAdapter({
      profileName: 'DashScope Voice',
      apiKey: 'Bearer sk-qwen-test-123',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3-omni-flash',
      optimizeEnabled: false,
    });

    const result = await adapter.transcribe({
      lang: 'zh-CN',
      preRecordedAudio: new Uint8Array([1, 2, 3, 4]),
    });

    expect(result.text).toBe('整理后的语音文本');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
      modalities?: string[];
    };

    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(headers.Authorization).toBe('Bearer sk-qwen-test-123');
    expect(body.model).toBe('qwen3-omni-flash');
    expect(body.modalities).toEqual(['text']);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[1]?.role).toBe('user');
    expect(JSON.stringify(body.messages[1]?.content)).toContain('input_audio');
    expect(JSON.stringify(body.messages[1]?.content)).toContain('data:audio/wav;base64,');
    expect(JSON.stringify(body.messages[1]?.content)).toContain('"format":"wav"');
  });

  it('streams optimize request when second-pass formatting is enabled（启用二次排版时同样走流式 SSE）', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(streamingSuccessResponse.clone())
      .mockResolvedValueOnce(streamingOptimizeResponse.clone());
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const adapter = new QwenOmniASRAdapter({
      profileName: 'DashScope Voice',
      apiKey: 'Bearer sk-qwen-test-123',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3-omni-flash',
      optimizeEnabled: true,
    });

    const result = await adapter.transcribe({
      lang: 'zh-CN',
      preRecordedAudio: new Uint8Array([1, 2, 3, 4]),
    });

    expect(result.text).toBe('第一段\n\n第二段');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const firstBody = JSON.parse(String(firstInit.body)) as {
      stream?: boolean;
      stream_options?: { include_usage: boolean };
    };
    expect(firstBody.stream).toBe(true);
    expect(firstBody.stream_options).toEqual({ include_usage: true });

    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(String(secondInit.body)) as {
      stream?: boolean;
      stream_options?: { include_usage: boolean };
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(secondBody.stream).toBe(true);
    expect(secondBody.stream_options).toEqual({ include_usage: true });
    expect(secondBody.messages[0]?.role).toBe('system');
    expect(secondBody.messages[1]?.role).toBe('user');
  });

  it('surfaces access_denied with a model fallback hint（权限拒绝时给出可用模型建议）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(accessDeniedResponse.clone());
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const adapter = new QwenOmniASRAdapter({
      profileName: 'DashScope Voice',
      apiKey: 'sk-qwen-test-123',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.5-omni-plus-2026-03-15',
      optimizeEnabled: false,
    });

    await expect(adapter.transcribe({
      lang: 'zh-CN',
      preRecordedAudio: new Uint8Array([1, 2, 3, 4]),
    })).rejects.toThrow('建议先改用 qwen3-omni-flash');
  });
});
