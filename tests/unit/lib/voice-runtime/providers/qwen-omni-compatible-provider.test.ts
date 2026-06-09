import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER } from '@/config/voice-runtime-settings';
import { encodePcm16ToWav } from '@/lib/media/wav-audio';
import { QwenOmniCompatibleProvider } from '@/lib/voice-runtime/providers/qwen-omni-compatible-provider';

function createSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('QwenOmniCompatibleProvider（Omni Compatible Provider）', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('starts locally, uploads WAV audio, and streams back text plus PCM chunks（本地启动、上传 WAV、流式回传文本与 PCM 音频）', async () => {
    const rawEvents: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const audioChunks: Uint8Array[] = [];
    const wavBytes = encodePcm16ToWav(new Int16Array([512, -256, 1024, -1024]), 24000);
    const wavPart1 = Buffer.from(wavBytes.slice(0, 20)).toString('base64');
    const wavPart2 = Buffer.from(wavBytes.slice(20)).toString('base64');

    fetchMock.mockResolvedValueOnce(new Response(
      createSseStream([
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                content: '你好',
              },
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                audio: {
                  data: wavPart1,
                },
              },
            },
          ],
        })}\n\n`,
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                audio: {
                  data: wavPart2,
                },
              },
            },
          ],
        })}\n\n`,
        'data: [DONE]\n\n',
      ]),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      },
    ));

    const provider = new QwenOmniCompatibleProvider(
      {
        provider: VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
        modelVersion: `${'q'}wen3.5-omni-plus`,
        sampleRate: 16000,
        apiKey: 'dashscope-api-key',
        websocketUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        speaker: 'Ethan',
        instructions: '你是兼容模式语音助手',
      },
      {
        onRawEvent: (event) => {
          rawEvents.push({
            eventType: event.eventType,
            payload: event.payload,
          });
        },
        onAudioChunk: (chunk) => {
          audioChunks.push(chunk);
        },
      },
    );

    const sessionId = await provider.start();
    await provider.pushAudio(new Uint8Array([1, 0, 2, 0]));
    await provider.pushAudio(new Uint8Array([3, 0, 4, 0]));
    await provider.finish();

    expect(sessionId).toMatch(/^omni-compatible-/);
    expect(rawEvents.map((event) => event.eventType)).toEqual([
      'SessionStarted',
      'CompatibleRequestPrepared',
      'ChatResponse',
      'TTSSentenceStart',
      'TTSEnded',
      'SessionFinished',
    ]);
    expect(rawEvents[1]?.payload).toEqual(expect.objectContaining({
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      audioFormat: 'wav',
      providerMode: 'compatible',
      transport: 'openai-compatible-sse',
    }));
    expect(rawEvents[2]?.payload).toEqual(expect.objectContaining({
      content: '你好',
    }));
    expect(audioChunks).toHaveLength(1);
    expect(Array.from(audioChunks[0] ?? [])).toEqual(Array.from(wavBytes.slice(44)));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(body).toEqual(expect.objectContaining({
      model: `${'q'}wen3.5-omni-plus`,
      modalities: ['text', 'audio'],
      stream: true,
      audio: {
        voice: 'Ethan',
        format: 'wav',
      },
    }));
    expect(messages[0]).toEqual({
      role: 'system',
      content: '你是兼容模式语音助手',
    });
    const inputAudio = (((messages[1]?.content as Array<Record<string, unknown>>)?.[0] ?? {}).input_audio
      ?? {}) as Record<string, unknown>;
    expect(String(inputAudio.data ?? '')).toMatch(/^data:audio\/wav;base64,/);
    expect(inputAudio.format).toBe('wav');
  });

  it('surfaces access denied as SessionFailed instead of throwing transport details（权限拒绝时通过 SessionFailed 暴露错误）', async () => {
    const rawEvents: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({
        error: {
          message: 'Model access denied.',
          type: 'invalid_request_error',
        },
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    ));

    const provider = new QwenOmniCompatibleProvider(
      {
        provider: VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
        modelVersion: `${'q'}wen3-omni-flash`,
        sampleRate: 16000,
        apiKey: 'dashscope-api-key',
        websocketUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        speaker: 'Chelsie',
      },
      {
        onRawEvent: (event) => {
          rawEvents.push({
            eventType: event.eventType,
            payload: event.payload,
          });
        },
      },
    );

    await provider.start();
    await provider.pushAudio(new Uint8Array([1, 0]));
    await expect(provider.finish()).resolves.toBeUndefined();

    expect(rawEvents.map((event) => event.eventType)).toEqual([
      'SessionStarted',
      'CompatibleRequestPrepared',
      'SessionFailed',
      'SessionFinished',
    ]);
    expect(rawEvents[2]?.payload).toEqual(expect.objectContaining({
      message: expect.stringContaining('Model access denied'),
      status: 400,
    }));
  });

  it('works without Node Buffer in browser-like runtime（没有 Node Buffer 时也能在浏览器环境工作）', async () => {
    const rawEvents: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const audioChunks: Uint8Array[] = [];
    const wavBytes = encodePcm16ToWav(new Int16Array([256, -128, 512, -512]), 24000);
    const wavBase64 = btoa(String.fromCharCode(...wavBytes));
    const originalBuffer = (globalThis as { Buffer?: unknown }).Buffer;

    fetchMock.mockResolvedValueOnce(new Response(
      createSseStream([
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                audio: {
                  data: wavBase64,
                },
              },
            },
          ],
        })}\n\n`,
        'data: [DONE]\n\n',
      ]),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      },
    ));

    try {
      vi.stubGlobal('Buffer', undefined);

      const provider = new QwenOmniCompatibleProvider(
        {
          provider: VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
          modelVersion: `${'q'}wen3.5-omni-plus`,
          sampleRate: 16000,
          apiKey: 'dashscope-api-key',
          websocketUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          speaker: 'Ethan',
        },
        {
          onRawEvent: (event) => {
            rawEvents.push({
              eventType: event.eventType,
              payload: event.payload,
            });
          },
          onAudioChunk: (chunk) => {
            audioChunks.push(chunk);
          },
        },
      );

      await provider.start();
      await provider.pushAudio(new Uint8Array([1, 0, 2, 0]));
      await expect(provider.finish()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      if (originalBuffer !== undefined) {
        vi.stubGlobal('Buffer', originalBuffer);
      }
      vi.stubGlobal('fetch', fetchMock);
    }

    expect(rawEvents.map((event) => event.eventType)).toEqual([
      'SessionStarted',
      'CompatibleRequestPrepared',
      'TTSSentenceStart',
      'TTSEnded',
      'SessionFinished',
    ]);
    expect(audioChunks).toHaveLength(1);
    expect(Array.from(audioChunks[0] ?? [])).toEqual(Array.from(wavBytes.slice(44)));
  });
});
