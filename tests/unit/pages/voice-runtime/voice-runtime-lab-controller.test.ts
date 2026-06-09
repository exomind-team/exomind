import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

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
  VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
  VOICE_RUNTIME_OMNI_PROVIDER,
  getVoiceRuntimeProvider,
  setVoiceRuntimeEnabled,
} from '@/config/voice-runtime-settings';
import {
  setVoiceRuntimeMode,
} from '@/config/voice-runtime-mode';
import type { VoiceRuntimeProviderConfig } from '@/lib/voice-runtime/providers/types';

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
  let streamingOnChunk: ((chunk: Uint8Array) => Promise<void>) | null;
  let lastProviderConfig: VoiceRuntimeProviderConfig | null;

  function createController() {
    return new VoiceRuntimeLabController({
      providerFactory: (config, callbacks) => {
        lastProviderConfig = config;
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
      createStreamingCapture: ({ onChunk }) => {
        streamingOnChunk = onChunk;
        return {
          start: captureStartMock,
          stop: captureStopMock,
          cancel: captureCancelMock,
        };
      },
      publishSignal: publishSignalMock,
      audioPlayerFactory: () => ({
        enqueuePcm16: audioPlayerEnqueueMock,
        interrupt: audioPlayerInterruptMock,
        dispose: audioPlayerDisposeMock,
      }),
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
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
    streamingOnChunk = null;
    lastProviderConfig = null;
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

  it('keeps listening state when final ASR arrives before manual stop（手动停止前收到 final ASR 仍保持 listening）', async () => {
    const controller = createController();

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    await controller.startListening();
    expect(providerCallbacks?.onRawEvent).toBeTypeOf('function');

    await providerCallbacks?.onRawEvent?.(
      createRawEvent('ASRResponse', {
        results: [{
          text: '这段 final 识别在停止前就到了',
          is_interim: false,
          confidence: 0.95,
        }],
      }),
    );

    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'listening',
      microphoneStatus: 'capturing',
      finalTranscript: '这段 final 识别在停止前就到了',
    }));
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

  it('handles pushAudio failure by switching to error and cleaning up resources（推流失败后进入错误态并清理资源）', async () => {
    pushAudioMock.mockRejectedValueOnce(new Error('Omni Realtime 会话不存在: stale-session'));
    const controller = createController();

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    await controller.startListening();

    expect(streamingOnChunk).toBeTypeOf('function');
    await streamingOnChunk?.(new Uint8Array([1, 2, 3]));

    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'error',
      connectionStatus: 'error',
      sessionId: null,
      microphoneStatus: 'idle',
      errorMessage: 'Omni Realtime 会话不存在: stale-session',
    }));
    expect(captureCancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(audioPlayerInterruptMock).toHaveBeenCalledTimes(1);
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

  it('uses keep_alive input mode in ambient mode（环境实时模式使用 keep_alive 输入模式）', async () => {
    const controller = createController();

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    controller.updateRuntimeMode('ambient');
    await controller.startListening();

    expect(lastProviderConfig?.inputMode).toBe('keep_alive');
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

  it('builds Omni provider config without mixing doubao credentials（Omni 配置独立，不混用豆包字段）', async () => {
    const controller = createController();

    controller.updateProvider(VOICE_RUNTIME_OMNI_PROVIDER);
    controller.updateOmniApiKey('dashscope-api-key');
    controller.updateOmniModel(`${'q'}wen3.5-omni-plus-realtime`);
    controller.updateOmniVoice('Ethan');
    controller.updateOmniInstructions('你是实时语音助手');
    controller.updateOmniWebsocketUrl('wss://dashscope.aliyuncs.com/api-ws/v1/realtime');
    controller.updateOmniSearchEnabled(false);
    controller.updateOmniFunctionCallingEnabled(true);
    controller.updateOmniToolChoice('required');
    controller.updateOmniToolsJson('[{"type":"function","name":"search_web","parameters":{"type":"object"}}]');
    await controller.startListening();

    expect(lastProviderConfig).toEqual(expect.objectContaining({
      provider: VOICE_RUNTIME_OMNI_PROVIDER,
      modelVersion: `${'q'}wen3.5-omni-plus-realtime`,
      apiKey: 'dashscope-api-key',
      speaker: 'Ethan',
      instructions: '你是实时语音助手',
      websocketUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
      enableSearch: false,
      toolChoice: 'required',
      tools: [
        {
          type: 'function',
          name: 'search_web',
          parameters: {
            type: 'object',
          },
        },
      ],
    }));
    expect(controller.getState()).toEqual(expect.objectContaining({
      providerId: VOICE_RUNTIME_OMNI_PROVIDER,
      credentialConfigured: true,
    }));
  });

  it('builds Omni Compatible config and forces push_to_talk input mode（Omni Compatible 配置独立且强制按键说话）', async () => {
    const controller = createController();

    controller.updateProvider(VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER);
    controller.updateRuntimeMode('ambient');
    controller.updateOmniApiKey('dashscope-api-key');
    controller.updateOmniVoice('Ethan');
    controller.updateOmniInstructions('你是兼容模式语音助手');
    controller.updateOmniCompatibleModel(`${'q'}wen3.5-omni-plus`);
    controller.updateOmniCompatibleBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1');
    controller.updateOmniCompatibleAudioFormat('wav');
    await controller.startListening();

    expect(lastProviderConfig).toEqual(expect.objectContaining({
      provider: VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
      modelVersion: `${'q'}wen3.5-omni-plus`,
      apiKey: 'dashscope-api-key',
      speaker: 'Ethan',
      instructions: '你是兼容模式语音助手',
      websocketUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      inputMode: 'push_to_talk',
      audioOutputFormat: 'wav',
    }));
    expect(controller.getState()).toEqual(expect.objectContaining({
      providerId: VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
      credentialConfigured: true,
      currentMode: 'ambient',
    }));
  });

  it('keeps shared runtime provider unchanged when switching lab provider（切换实验 Provider 时不改共享运行时 Provider）', () => {
    const controller = createController();

    expect(getVoiceRuntimeProvider()).toBe('doubao-o2-realtime');

    controller.updateProvider(VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER);

    expect(controller.getState()).toEqual(expect.objectContaining({
      providerId: VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
    }));
    expect(getVoiceRuntimeProvider()).toBe('doubao-o2-realtime');
  });

  it('rejects invalid Omni tools JSON before starting（Omni 工具 JSON 非法时阻止启动）', async () => {
    const controller = createController();

    controller.updateProvider(VOICE_RUNTIME_OMNI_PROVIDER);
    controller.updateOmniApiKey('dashscope-api-key');
    controller.updateOmniFunctionCallingEnabled(true);
    controller.updateOmniToolsJson('{invalid-json');

    await controller.startListening();

    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'error',
      connectionStatus: 'error',
      errorMessage: expect.stringContaining('Omni tools JSON'),
    }));
    expect(lastProviderConfig).toBeNull();
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

  it('keeps session alive after TTSEnded in ambient mode（环境实时模式下 TTSEnded 后保持会话）', async () => {
    const controller = createController();

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    controller.updateRuntimeMode('ambient');
    await controller.startListening();

    await providerCallbacks?.onRawEvent?.(
      createRawEvent('SessionStarted', {}),
    );
    await providerCallbacks?.onRawEvent?.(
      createRawEvent('ASRResponse', {
        results: [{
          text: '环境模式持续监听测试',
          is_interim: false,
        }],
      }),
    );
    await providerCallbacks?.onRawEvent?.(
      createRawEvent('TTSEnded', {
        reply_id: 'reply-ambient',
      }),
    );

    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'listening',
      connectionStatus: 'ready',
      microphoneStatus: 'capturing',
    }));
    expect(disposeMock).not.toHaveBeenCalled();
  });

  it('cancels capture when session finishes unexpectedly（会话异常结束时主动停止采集）', async () => {
    const controller = createController();

    controller.updateAppId('4587429383');
    controller.updateAccessToken('vei-access-token');
    await controller.startListening();

    await providerCallbacks?.onRawEvent?.(
      createRawEvent('SessionFinished', {
        reason: 'server closed',
      }),
    );

    expect(captureCancelMock).toHaveBeenCalledTimes(1);
    expect(disposeMock).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'idle',
      connectionStatus: 'disconnected',
      microphoneStatus: 'idle',
      sessionId: null,
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

  it('surfaces actionable error when Omni command is missing（Omni 命令缺失时给出可执行提示）', async () => {
    const controller = new VoiceRuntimeLabController({
      providerFactory: () => ({
        start: vi.fn(async () => {
          throw new Error('Command omni_realtime_session_start not found');
        }),
        pushAudio: pushAudioMock,
        finish: finishMock,
        cancel: cancelMock,
        dispose: disposeMock,
        getSessionId: () => null,
      }),
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

    controller.updateProvider(VOICE_RUNTIME_OMNI_PROVIDER);
    controller.updateOmniApiKey('dashscope-api-key');
    await controller.startListening();

    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'error',
      connectionStatus: 'error',
      errorMessage: expect.stringContaining('桌面端未加载 Omni Realtime 命令'),
    }));
  });
});
