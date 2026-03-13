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

  it('publishes raw and normalized voice topics with shared trace context（同时发布原始与归一化语音主题，并共享 trace 上下文）', async () => {
    const result: ASRResult = {
      text: '你好 ExoMind',
      confidence: 0.98,
      lang: 'zh-CN',
      duration: 1200,
    };

    await publishVoiceTranscriptSignal(result, {
      source: 'frontend:test-voice-button',
      captureSource: 'global-shortcut',
      targetScope: 'agent-chat',
      window: {
        title: 'ExoMind',
        processName: 'exomind.exe',
      },
      agentContext: {
        agentId: 'codex',
        agentName: 'Codex',
        sessionId: 'session-001',
      },
    });

    expect(signalPublishMocks.publish).toHaveBeenCalledTimes(2);
    expect(signalPublishMocks.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        topic: 'voice.input.transcript',
        source: 'frontend:test-voice-button',
        trace_id: expect.stringMatching(/^voice:/),
        payload: expect.objectContaining({
          text: '你好 ExoMind',
          transcript: '你好 ExoMind',
          rawText: '你好 ExoMind',
          lang: 'zh-CN',
          confidence: 0.98,
          duration: 1200,
          durationMs: 1200,
          inputMode: 'voice',
          captureSource: 'global-shortcut',
          targetScope: 'agent-chat',
          traceId: expect.stringMatching(/^voice:/),
          window: {
            title: 'ExoMind',
            processName: 'exomind.exe',
          },
          agentContext: {
            agentId: 'codex',
            agentName: 'Codex',
            sessionId: 'session-001',
          },
        }),
      })
    );

    const firstCall = signalPublishMocks.publish.mock.calls[0]?.[0];
    const secondCall = signalPublishMocks.publish.mock.calls[1]?.[0];

    expect(secondCall).toEqual(expect.objectContaining({
      topic: 'user.input.normalized',
      source: 'frontend:test-voice-button',
      trace_id: firstCall?.trace_id,
      payload: expect.objectContaining({
        text: '你好 ExoMind',
        rawText: '你好 ExoMind',
        inputMode: 'voice',
        captureSource: 'global-shortcut',
        targetScope: 'agent-chat',
        durationMs: 1200,
        traceId: firstCall?.trace_id,
        window: {
          title: 'ExoMind',
          processName: 'exomind.exe',
        },
        agentContext: {
          agentId: 'codex',
          agentName: 'Codex',
          sessionId: 'session-001',
        },
      }),
    }));
  });
});
