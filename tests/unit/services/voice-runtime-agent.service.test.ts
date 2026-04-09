import { describe, expect, it, vi } from 'vitest';

import { VoiceRuntimeAgentService } from '@/services/voice-runtime-agent.service';
import type { ProviderRawPerception } from '@/lib/voice-runtime/types';

function createRawPerception(
  eventType: string,
  payload: Record<string, unknown>,
): ProviderRawPerception {
  return {
    provider: 'doubao-o2-realtime',
    model: '1.2.1.1',
    eventType,
    payload,
    capturedAt: '2026-04-08T12:00:00.000Z',
  };
}

describe('VoiceRuntimeAgentService（语音运行时智能体服务）', () => {
  it('keeps partial perception in memory without publishing final transcript（partial 只更新内存态，不直接发最终信号）', async () => {
    const publishTranscript = vi.fn().mockResolvedValue(undefined);
    const service = new VoiceRuntimeAgentService({ publishTranscript });

    const perception = await service.handleProviderRawEvent(
      createRawPerception('ASRResponse', {
        results: [
          {
            text: '准备开始今天的复盘',
            is_interim: true,
            confidence: 0.88,
          },
        ],
      }),
    );

    expect(perception).toEqual(expect.objectContaining({
      transcript: '准备开始今天的复盘',
      isFinal: false,
      confidence: 0.88,
    }));
    expect(service.getState()).toEqual(expect.objectContaining({
      liveTranscript: '准备开始今天的复盘',
      finalTranscript: '',
      lastNormalizedPerception: expect.objectContaining({
        transcript: '准备开始今天的复盘',
        isFinal: false,
      }),
    }));
    expect(publishTranscript).not.toHaveBeenCalled();
  });

  it('publishes final transcript into the existing voice signal bridge（final 文本进入现有语音信号桥）', async () => {
    const publishTranscript = vi.fn().mockResolvedValue(undefined);
    const service = new VoiceRuntimeAgentService({ publishTranscript });

    const partial = await service.handleProviderRawEvent(
      createRawPerception('ASRResponse', {
        results: [
          {
            text: '准备开始今天的复盘',
            is_interim: true,
            confidence: 0.88,
          },
        ],
      }),
    );

    const final = await service.handleProviderRawEvent(
      createRawPerception('ASRResponse', {
        results: [
          {
            text: '准备开始今天的复盘，先整理事件日志。',
            is_interim: false,
            confidence: 0.96,
          },
        ],
      }),
    );

    expect(partial?.traceId).toBe(final?.traceId);
    expect(service.getState()).toEqual(expect.objectContaining({
      liveTranscript: '',
      finalTranscript: '准备开始今天的复盘，先整理事件日志。',
      lastNormalizedPerception: expect.objectContaining({
        transcript: '准备开始今天的复盘，先整理事件日志。',
        isFinal: true,
      }),
    }));
    expect(publishTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '准备开始今天的复盘，先整理事件日志。',
        confidence: 0.96,
        lang: 'zh-CN',
      }),
      expect.objectContaining({
        source: 'tauri:voice-runtime-agent',
        captureSource: 'voice-runtime-agent',
      }),
    );
  });

  it('stores unrelated raw events but does not normalize them（无关事件只保留 raw，不做标准化）', async () => {
    const publishTranscript = vi.fn().mockResolvedValue(undefined);
    const service = new VoiceRuntimeAgentService({ publishTranscript });
    const rawEvent = createRawPerception('SessionStarted', { dialog_id: 'dialog-1' });

    const perception = await service.handleProviderRawEvent(rawEvent);

    expect(perception).toBeNull();
    expect(service.getState().rawEvents).toEqual([rawEvent]);
    expect(service.getState().lastNormalizedPerception).toBeNull();
    expect(publishTranscript).not.toHaveBeenCalled();
  });
});
