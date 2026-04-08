import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/voice-signal.service', () => ({
  publishVoiceTranscriptSignal: vi.fn(async () => undefined),
  publishVoiceRuntimeSpeakRequestSignal: vi.fn(async () => undefined),
  publishVoiceRuntimeSpeakCancelSignal: vi.fn(async () => undefined),
}));

import type {
  ProviderRawPerception,
} from '@/lib/voice-runtime/types';
import {
  VOICE_RUNTIME_SPEAK_CANCEL_TOPIC,
  VOICE_RUNTIME_SPEAK_REQUEST_TOPIC,
} from '@/lib/constants/signal-topics';
import {
  VoiceRuntimeLabController,
  type VoiceRuntimeLabControllerDependencies,
} from '@/ui/app/pages/voice-runtime/voice-runtime-lab-controller';
import {
  setVoiceRuntimeDoubaoAccessToken,
  setVoiceRuntimeDoubaoAppId,
} from '@/config/voice-runtime-doubao';
import {
  setVoiceRuntimeEnabled,
} from '@/config/voice-runtime-settings';
import {
  setVoiceRuntimeMode,
} from '@/config/voice-runtime-mode';

type FakeProviderCallbacks = NonNullable<VoiceRuntimeLabControllerDependencies['providerFactory']> extends (
  config: never,
  callbacks: infer TCallbacks,
) => unknown ? TCallbacks : never;

function createRawEvent(
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

describe('VoiceRuntimeLabController（语音运行时实验台控制器）', () => {
  let providerCallbacks: FakeProviderCallbacks | null;
  let pushAudioMock: ReturnType<typeof vi.fn>;
  let finishMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;
  let disposeMock: ReturnType<typeof vi.fn>;
  let captureStartMock: ReturnType<typeof vi.fn>;
  let captureStopMock: ReturnType<typeof vi.fn>;
  let captureCancelMock: ReturnType<typeof vi.fn>;
  let getUserMediaMock: ReturnType<typeof vi.fn>;
  let publishSignalMock: ReturnType<typeof vi.fn>;
  let audioPlayerEnqueueMock: ReturnType<typeof vi.fn>;
  let audioPlayerInterruptMock: ReturnType<typeof vi.fn>;
  let audioPlayerDisposeMock: ReturnType<typeof vi.fn>;

  function createController() {
    return new VoiceRuntimeLabController({
      providerFactory: (config, callbacks) => {
        providerCallbacks = callbacks;
        return {
          start: vi.fn(async () => 'doubao-session-1'),
          pushAudio: pushAudioMock,
          finish: finishMock,
          cancel: cancelMock,
          dispose: disposeMock,
          getSessionId: () => 'doubao-session-1',
        };
      },
      getUserMedia: getUserMediaMock,
      createStreamingCapture: () => ({
        start: captureStartMock,
        stop: captureStopMock,
        cancel: captureCancelMock,
      }),
      publishSignal: publishSignalMock,
      audioPlayerFactory: () => ({
        enqueuePcm16: audioPlayerEnqueueMock,
        interrupt: audioPlayerInterruptMock,
        dispose: audioPlayerDisposeMock,
      }),
    });
  }

  beforeEach(() => {
    providerCallbacks = null;
    pushAudioMock = vi.fn(async () => undefined);
    finishMock = vi.fn(async () => undefined);
    cancelMock = vi.fn(async () => undefined);
    disposeMock = vi.fn(async () => undefined);
    captureStartMock = vi.fn(async () => undefined);
    captureStopMock = vi.fn(async () => new Uint8Array([9, 8, 7]));
    captureCancelMock = vi.fn(async () => undefined);
    getUserMediaMock = vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }],
    }));
    publishSignalMock = vi.fn(async () => undefined);
    audioPlayerEnqueueMock = vi.fn(async () => undefined);
    audioPlayerInterruptMock = vi.fn(async () => undefined);
    audioPlayerDisposeMock = vi.fn(async () => undefined);
  });

  it('starts listening with realtime provider and microphone capture（启动实时 Provider 与麦克风采集）', async () => {
    const controller = createController();

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    await controller.startListening();

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(captureStartMock).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'listening',
      connectionStatus: 'connecting',
      sessionId: 'doubao-session-1',
      credentialConfigured: true,
    }));
  });

  it('maps ASR / Chat / TTS events into the lab state（把 ASR / Chat / TTS 事件映射到页面状态）', async () => {
    const controller = createController();

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    await controller.startListening();
    expect(providerCallbacks?.onRawEvent).toBeTypeOf('function');

    await providerCallbacks?.onRawEvent?.(
      createRawEvent('SessionStarted', {
        dialog_id: 'dialog-1',
      }),
    );
    await providerCallbacks?.onRawEvent?.(
      createRawEvent('ASRResponse', {
        results: [{ text: '今天下午先把实验页联通', is_interim: true }],
      }),
    );

    expect(controller.getState()).toEqual(expect.objectContaining({
      connectionStatus: 'ready',
      liveTranscript: '今天下午先把实验页联通',
      finalTranscript: '',
    }));

    await providerCallbacks?.onRawEvent?.(
      createRawEvent('ASRResponse', {
        results: [{
          text: '今天下午先把实验页联通，再补完整的 Rust 后端测试。',
          is_interim: false,
          confidence: 0.96,
        }],
      }),
    );
    await providerCallbacks?.onRawEvent?.(
      createRawEvent('ChatResponse', {
        content: '收到，我来继续推进。',
      }),
    );
    await providerCallbacks?.onAudioChunk?.(
      new Uint8Array([1, 2, 3, 4]),
      {
        audioFormat: 'pcm_s16le',
        capturedAt: '2026-04-08T12:00:01.000Z',
        eventType: 'TTSResponse',
        provider: 'doubao-o2-realtime',
        sampleRate: 24000,
        sessionId: 'doubao-session-1',
      },
    );
    await providerCallbacks?.onRawEvent?.(
      createRawEvent('TTSEnded', {
        reply_id: 'reply-1',
      }),
    );

    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'idle',
      connectionStatus: 'disconnected',
      liveTranscript: '',
      finalTranscript: '今天下午先把实验页联通，再补完整的 Rust 后端测试。',
      assistantReplyText: '收到，我来继续推进。',
      ttsPlaybackStatus: 'ended',
      lastNormalizedPerception: expect.objectContaining({
        transcript: '今天下午先把实验页联通，再补完整的 Rust 后端测试。',
        isFinal: true,
      }),
    }));
    expect(audioPlayerEnqueueMock).toHaveBeenCalledWith(new Uint8Array([1, 2, 3, 4]));
    expect(audioPlayerInterruptMock).not.toHaveBeenCalled();
    expect(disposeMock).toHaveBeenCalled();
  });

  it('stops listening by flushing the trailing audio chunk（停止监听时提交尾部音频块）', async () => {
    const controller = createController();

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    await controller.startListening();
    await controller.stopListening();

    expect(captureStopMock).toHaveBeenCalledTimes(1);
    expect(finishMock).toHaveBeenCalledWith(new Uint8Array([9, 8, 7]));
    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'responding',
      connectionStatus: 'connecting',
      microphoneStatus: 'idle',
    }));
  });

  it('publishes speak request and cancel signals from the lab controls（实验页可发送播报请求与取消信号）', async () => {
    const controller = createController();

    controller.updateSpeakText('请提醒我晚点复盘');
    await controller.sendSpeakRequest();
    await controller.sendSpeakCancel();

    expect(publishSignalMock).toHaveBeenNthCalledWith(
      1,
      VOICE_RUNTIME_SPEAK_REQUEST_TOPIC,
      expect.objectContaining({
        text: '请提醒我晚点复盘',
      }),
    );
    expect(publishSignalMock).toHaveBeenNthCalledWith(
      2,
      VOICE_RUNTIME_SPEAK_CANCEL_TOPIC,
      expect.objectContaining({}),
    );
  });

  it('updates runtime switches and inline policies from the lab page（实验页可直接更新运行时开关与策略）', async () => {
    const controller = createController();

    controller.updateRuntimeEnabled(true);
    controller.updateAutoSpeakEnabled(false);
    controller.updateRuntimeMode('ambient');
    controller.updateCloudSessionPolicy('foreground-persistent');

    expect(controller.getState()).toEqual(expect.objectContaining({
      runtimeEnabled: true,
      autoSpeakEnabled: false,
      currentMode: 'ambient',
      currentCloudSessionPolicy: 'foreground-persistent',
    }));
  });

  it('stores the new credential fields and player interruption status（保存新凭据字段并处理播报打断）', async () => {
    const controller = createController();

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    controller.updateSecretKey('vei-secret-key');
    controller.updateModelVersion('1.2.1.1');
    controller.updateSpeaker('zh_female_xiaohe_jupiter_bigtts');

    await controller.startListening();
    await providerCallbacks?.onRawEvent?.(
      createRawEvent('ASRInfo', {
        question_id: 'question-1',
      }),
    );

    expect(controller.getState()).toEqual(expect.objectContaining({
      appId: '4587429383',
      accessToken: 'vei-access-token',
      secretKey: 'vei-secret-key',
      modelVersion: '1.2.1.1',
      speaker: 'zh_female_xiaohe_jupiter_bigtts',
      ttsPlaybackStatus: 'interrupted',
    }));
    expect(audioPlayerInterruptMock).toHaveBeenCalledTimes(1);
  });

  it('reacts to external config changes after construction（构造完成后仍会响应外部配置变更）', async () => {
    const controller = createController();

    setVoiceRuntimeDoubaoAppId('4587429383');
    setVoiceRuntimeDoubaoAccessToken('external-access-token');
    setVoiceRuntimeEnabled(true);
    setVoiceRuntimeMode('push-to-talk');

    await Promise.resolve();

    expect(controller.getState()).toEqual(expect.objectContaining({
      appId: '4587429383',
      accessToken: 'external-access-token',
      credentialConfigured: true,
      runtimeEnabled: true,
      currentMode: 'push-to-talk',
    }));
  });

  it('recovers from missing completion events and allows restart（缺少结束事件时自动回收并可再次开始）', async () => {
    vi.useFakeTimers();
    let providerFactoryCalls = 0;

    const controller = new VoiceRuntimeLabController({
      providerFactory: () => {
        providerFactoryCalls += 1;
        return {
          start: vi.fn(async () => `doubao-session-${providerFactoryCalls}`),
          pushAudio: pushAudioMock,
          finish: finishMock,
          cancel: cancelMock,
          dispose: disposeMock,
          getSessionId: () => `doubao-session-${providerFactoryCalls}`,
        };
      },
      getUserMedia: getUserMediaMock,
      createStreamingCapture: () => ({
        start: captureStartMock,
        stop: captureStopMock,
        cancel: captureCancelMock,
      }),
      publishSignal: publishSignalMock,
      audioPlayerFactory: () => ({
        enqueuePcm16: audioPlayerEnqueueMock,
        interrupt: audioPlayerInterruptMock,
        dispose: audioPlayerDisposeMock,
      }),
    });

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    await controller.startListening();
    await controller.stopListening();

    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'responding',
      connectionStatus: 'connecting',
    }));

    await vi.advanceTimersByTimeAsync(12_100);
    await Promise.resolve();

    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'idle',
      connectionStatus: 'disconnected',
      microphoneStatus: 'idle',
    }));
    expect(disposeMock).toHaveBeenCalledTimes(1);

    await controller.startListening();

    expect(providerFactoryCalls).toBe(2);
    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'listening',
      sessionId: 'doubao-session-2',
    }));

    vi.useRealTimers();
  });
});
