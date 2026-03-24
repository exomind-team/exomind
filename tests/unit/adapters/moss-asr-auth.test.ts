import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOSSASRAdapter } from '@/lib/adapters/asr/moss-asr';

const successResponse = new Response(
  JSON.stringify({
    asr_transcription_result: {
      full_text: '测试文本',
      segments: [{ text: '测试文本' }],
    },
  }),
  {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  }
);

describe('MOSSASRAdapter auth header', () => {
  let originalFetch: typeof globalThis.fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('moss_api_key');
    }
  });

  afterEach(() => {
    if (originalFetch) {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('moss_api_key');
    }
  });

  it('normalizes Bearer-prefixed apiKey before request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse.clone());
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const adapter = new MOSSASRAdapter({ apiKey: 'Bearer sk-test-key-123' });

    await adapter.transcribe({
      lang: 'zh-CN',
      preRecordedAudio: new Uint8Array([1, 2, 3, 4]),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers.Authorization).toBe('Bearer sk-test-key-123');
  });

  it('falls back to localStorage moss_api_key for EventLog voice input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse.clone());
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    localStorage.setItem('moss_api_key', 'sk-local-key-456');

    const adapter = new MOSSASRAdapter();

    expect(adapter.isAvailable()).toBe(true);

    await adapter.transcribe({
      lang: 'zh-CN',
      preRecordedAudio: new Uint8Array([5, 6, 7, 8]),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers.Authorization).toBe('Bearer sk-local-key-456');
  });
});
