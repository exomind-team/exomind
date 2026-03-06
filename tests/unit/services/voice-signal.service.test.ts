import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ASRResult } from '@/lib/ports/asr-port';

const runtimeTargetMocks = vi.hoisted(() => ({
  getSelectedRuntimeTarget: vi.fn(),
}));

const signalPublishMocks = vi.hoisted(() => ({
  publish: vi.fn(),
}));

vi.mock('@/config/runtime-target', () => ({
  getSelectedRuntimeTarget: runtimeTargetMocks.getSelectedRuntimeTarget,
}));

vi.mock('@/lib/services/signal-stream.service', () => ({
  SignalStreamService: class MockSignalStreamService {
    publish = signalPublishMocks.publish;
  },
}));

import { publishVoiceTranscriptSignal } from '@/lib/services/voice-signal.service';

describe('voice-signal.service（语音信号服务）', () => {
  beforeEach(() => {
    runtimeTargetMocks.getSelectedRuntimeTarget.mockReturnValue({
      mode: 'embedded',
      host: '127.0.0.1',
      port: 1949,
    });
    signalPublishMocks.publish.mockReset();
    signalPublishMocks.publish.mockResolvedValue({ accepted: true, event_id: 'evt-001' });
  });

  it('publishes transcript only to voice topic（只发布到语音主题避免重复消费）', async () => {
    const result: ASRResult = {
      text: '你好 ExoMind',
      confidence: 0.98,
      lang: 'zh-CN',
      duration: 1200,
    };

    await publishVoiceTranscriptSignal(result, { source: 'frontend:test-voice-button' });

    expect(signalPublishMocks.publish).toHaveBeenCalledTimes(1);
    expect(signalPublishMocks.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        topic: 'voice.input.transcript',
        source: 'frontend:test-voice-button',
        payload: expect.objectContaining({
          text: '你好 ExoMind',
          transcript: '你好 ExoMind',
          lang: 'zh-CN',
          confidence: 0.98,
          duration: 1200,
        }),
      })
    );
  });
});
