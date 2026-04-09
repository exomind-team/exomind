import type { ProviderRawPerception } from '../types';
import {
  encodePcm16ToWav,
  readWavSampleRate,
} from '@/lib/media/wav-audio';
import type {
  VoiceRuntimeAudioChunkMeta,
  VoiceRuntimeProvider,
  VoiceRuntimeProviderCallbacks,
  VoiceRuntimeProviderConfig,
} from './types';

interface OpenAICompatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      audio?: {
        data?: string | null;
      } | null;
    } | null;
  }>;
  usage?: Record<string, unknown>;
}

const DEFAULT_OUTPUT_AUDIO_FORMAT = 'wav';
const BASE64_BINARY_CHUNK_SIZE = 0x8000;

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_BINARY_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_BINARY_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return binary;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(bytesToBinaryString(bytes));
  }
  throw new Error('Base64 encoder unavailable（缺少 base64 编码器）');
}

function decodeBase64Chunk(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  throw new Error('Base64 decoder unavailable（缺少 base64 解码器）');
}

function buildSessionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `omni-compatible-${randomId}`;
}

function normalizeCapturedAt(): string {
  return new Date().toISOString();
}

function callMaybeAsync<TArgs extends unknown[]>(
  callback: ((...args: TArgs) => void | Promise<void>) | undefined,
  ...args: TArgs
): void {
  const result = callback?.(...args);
  if (result && typeof (result as Promise<void>).catch === 'function') {
    void (result as Promise<void>).catch((error) => {
      console.warn('Omni compatible provider callback failed（Omni Compatible 回调失败）', error);
    });
  }
}

function normalizePayload(
  config: VoiceRuntimeProviderConfig,
  eventType: string,
  payload: Record<string, unknown>,
): ProviderRawPerception {
  return {
    provider: config.provider,
    model: config.modelVersion,
    eventType,
    payload,
    capturedAt: normalizeCapturedAt(),
  };
}

function findWavDataOffset(bytes: Uint8Array): number | null {
  if (bytes.byteLength < 12) {
    return null;
  }
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const wave = String.fromCharCode(...bytes.slice(8, 12));
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    return 0;
  }

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const chunkSize = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const nextOffset = offset + 8 + chunkSize;
    if (chunkId === 'data') {
      return offset + 8;
    }
    if (nextOffset > bytes.byteLength) {
      return null;
    }
    offset = nextOffset;
  }

  return null;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export class QwenOmniCompatibleProvider implements VoiceRuntimeProvider {
  private sessionId: string | null = null;
  private readonly inputAudioChunks: Uint8Array[] = [];
  private abortController: AbortController | null = null;
  private wavHeaderResolved = false;
  private pendingWavPrefix = new Uint8Array();
  private resolvedSampleRate: number | null = null;
  private emittedTtsStart = false;

  constructor(
    private readonly config: VoiceRuntimeProviderConfig,
    private readonly callbacks: VoiceRuntimeProviderCallbacks = {},
  ) {}

  getSessionId(): string | null {
    return this.sessionId;
  }

  async start(): Promise<string> {
    if (this.sessionId) {
      return this.sessionId;
    }

    this.sessionId = buildSessionId();
    this.inputAudioChunks.length = 0;
    this.abortController = new AbortController();
    this.wavHeaderResolved = false;
    this.pendingWavPrefix = new Uint8Array();
    this.resolvedSampleRate = null;
    this.emittedTtsStart = false;

    callMaybeAsync(
      this.callbacks.onRawEvent,
      normalizePayload(this.config, 'SessionStarted', {
        providerMode: 'compatible',
        inputMode: this.config.inputMode ?? 'push_to_talk',
        transport: 'openai-compatible-sse',
      }),
    );

    return this.sessionId;
  }

  async pushAudio(chunk: Uint8Array): Promise<void> {
    if (!this.sessionId || chunk.byteLength === 0) {
      return;
    }
    this.inputAudioChunks.push(new Uint8Array(chunk));
  }

  async finish(chunk: Uint8Array = new Uint8Array()): Promise<void> {
    if (!this.sessionId) {
      return;
    }
    if (chunk.byteLength > 0) {
      this.inputAudioChunks.push(new Uint8Array(chunk));
    }

    const sessionId = this.sessionId;
    const inputPcm = concatChunks(this.inputAudioChunks);
    if (inputPcm.byteLength === 0) {
      this.emitRawEvent('SessionFailed', {
        message: 'Omni Compatible 未收到可提交的音频数据（no audio to submit）',
      });
      this.emitRawEvent('SessionFinished', { reason: 'no-audio' });
      return;
    }

    const inputPcm16 = new Int16Array(
      inputPcm.buffer.slice(
        inputPcm.byteOffset,
        inputPcm.byteOffset + inputPcm.byteLength,
      ),
    );
    const wavBytes = encodePcm16ToWav(inputPcm16, this.config.sampleRate || 16000);
    const audioOutputFormat = this.config.audioOutputFormat ?? DEFAULT_OUTPUT_AUDIO_FORMAT;
    const baseUrl = this.config.baseUrl?.trim() || this.config.websocketUrl?.trim();
    const apiKey = this.config.apiKey?.trim() || '';

    if (!baseUrl || !apiKey) {
      this.emitRawEvent('SessionFailed', {
        message: 'Omni Compatible 缺少 Base URL 或 API Key（missing compatible config）',
      });
      this.emitRawEvent('SessionFinished', { reason: 'invalid-config' });
      return;
    }

    const endpoint = joinUrl(baseUrl, '/chat/completions');
    this.emitRawEvent('CompatibleRequestPrepared', {
      endpoint,
      providerMode: 'compatible',
      transport: 'openai-compatible-sse',
      audioBytes: wavBytes.byteLength,
      audioFormat: audioOutputFormat,
      inputSampleRate: this.config.sampleRate || 16000,
      model: this.config.modelVersion,
      voice: this.config.speaker,
    });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.modelVersion,
          modalities: ['text', 'audio'],
          audio: {
            voice: this.config.speaker || 'Ethan',
            format: audioOutputFormat,
          },
          stream: true,
          stream_options: {
            include_usage: true,
          },
          messages: [
            {
              role: 'system',
              content: this.config.instructions?.trim() || '你是 ExoMind 的语音助手，请准确回答用户问题。',
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: `data:audio/wav;base64,${bytesToBase64(wavBytes)}`,
                    format: 'wav',
                  },
                },
              ],
            },
          ],
        }),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        this.emitRawEvent('SessionFailed', {
          message: `Omni Compatible request failed: HTTP ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`,
          status: response.status,
        });
        this.emitRawEvent('SessionFinished', { reason: 'request-failed' });
        return;
      }

      if (!response.body) {
        this.emitRawEvent('SessionFailed', {
          message: 'Omni Compatible 缺少流式响应体（missing response body）',
        });
        this.emitRawEvent('SessionFinished', { reason: 'missing-body' });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]' || trimmed.startsWith(':')) {
            continue;
          }
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') {
            continue;
          }
          let parsed: OpenAICompatStreamChunk;
          try {
            parsed = JSON.parse(data) as OpenAICompatStreamChunk;
          } catch {
            continue;
          }

          const delta = parsed.choices?.[0]?.delta;
          const content = delta?.content?.trim();
          if (content) {
            this.emitRawEvent('ChatResponse', { content });
          }

          const audioBase64 = delta?.audio?.data?.trim();
          if (audioBase64) {
            if (!this.emittedTtsStart) {
              this.emittedTtsStart = true;
              this.emitRawEvent('TTSSentenceStart', {
                format: audioOutputFormat,
              });
            }
            const audioBytes = decodeBase64Chunk(audioBase64);
            const pcmChunk = this.consumeWavChunk(audioBytes);
            if (pcmChunk.byteLength > 0) {
              const audioMeta: VoiceRuntimeAudioChunkMeta = {
                provider: this.config.provider,
                sessionId,
                eventType: 'TTSResponse',
                capturedAt: normalizeCapturedAt(),
                sampleRate: this.resolvedSampleRate ?? this.config.ttsSampleRate ?? 24000,
                audioFormat: 'pcm_s16le',
              };
              callMaybeAsync(this.callbacks.onAudioChunk, pcmChunk, audioMeta);
            }
          }
        }
      }

      this.emitRawEvent('TTSEnded', {
        audioFormat: audioOutputFormat,
        sampleRate: this.resolvedSampleRate ?? this.config.ttsSampleRate ?? 24000,
      });
      this.emitRawEvent('SessionFinished', {
        reason: 'completed',
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.emitRawEvent('SessionFinished', { reason: 'aborted' });
        return;
      }
      this.emitRawEvent('SessionFailed', {
        message: error instanceof Error ? error.message : String(error),
      });
      this.emitRawEvent('SessionFinished', { reason: 'exception' });
    }
  }

  async cancel(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    this.inputAudioChunks.length = 0;
    this.pendingWavPrefix = new Uint8Array();
    this.wavHeaderResolved = false;
    this.sessionId = null;
    this.resolvedSampleRate = null;
    this.emittedTtsStart = false;
  }

  async dispose(): Promise<void> {
    await this.cancel();
  }

  private emitRawEvent(eventType: string, payload: Record<string, unknown>): void {
    callMaybeAsync(this.callbacks.onRawEvent, normalizePayload(this.config, eventType, payload));
    if (eventType === 'SessionFinished' || eventType === 'SessionFailed') {
      this.sessionId = null;
    }
  }

  private consumeWavChunk(chunk: Uint8Array): Uint8Array {
    if (this.wavHeaderResolved) {
      return chunk;
    }

    const merged = this.pendingWavPrefix.byteLength > 0
      ? concatChunks([this.pendingWavPrefix, chunk])
      : chunk;
    const dataOffset = findWavDataOffset(merged);
    if (dataOffset == null) {
      this.pendingWavPrefix = merged;
      return new Uint8Array();
    }

    this.wavHeaderResolved = true;
    this.pendingWavPrefix = new Uint8Array();
    if (dataOffset > 0) {
      try {
        this.resolvedSampleRate = readWavSampleRate(merged);
      } catch {
        this.resolvedSampleRate = null;
      }
    }
    return merged.slice(dataOffset);
  }
}
