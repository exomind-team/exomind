import {
  DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
  getUserMediaWithConstraintFallback,
} from '@/lib/media/microphone-capture';
import {
  createVolcanoStreamingCapture,
  type VolcanoStreamingCapture,
} from '@/lib/asr/volcano-streaming-capture';
import {
  publishVoiceRuntimeSpeakCancelSignal,
  publishVoiceRuntimeSpeakRequestSignal,
} from '@/lib/services/voice-signal.service';
import {
  getVoiceRuntimeDoubaoAccessToken,
  getVoiceRuntimeDoubaoAppId,
  getVoiceRuntimeDoubaoConnectId,
  getVoiceRuntimeDoubaoModelVersion,
  getVoiceRuntimeDoubaoSecretKey,
  getVoiceRuntimeDoubaoSpeaker,
  getVoiceRuntimeDoubaoWebsocketUrl,
  setVoiceRuntimeDoubaoAccessToken,
  setVoiceRuntimeDoubaoAppId,
  setVoiceRuntimeDoubaoConnectId,
  setVoiceRuntimeDoubaoModelVersion,
  setVoiceRuntimeDoubaoSecretKey,
  setVoiceRuntimeDoubaoSpeaker,
  setVoiceRuntimeDoubaoWebsocketUrl,
  subscribeVoiceRuntimeDoubaoAccessTokenChanges,
  subscribeVoiceRuntimeDoubaoAppIdChanges,
  subscribeVoiceRuntimeDoubaoConnectIdChanges,
  subscribeVoiceRuntimeDoubaoModelVersionChanges,
  subscribeVoiceRuntimeDoubaoSecretKeyChanges,
  subscribeVoiceRuntimeDoubaoSpeakerChanges,
  subscribeVoiceRuntimeDoubaoWebsocketUrlChanges,
} from '@/config/voice-runtime-doubao';
import {
  getVoiceRuntimeOmniCompatibleAudioFormat,
  getVoiceRuntimeOmniCompatibleBaseUrl,
  getVoiceRuntimeOmniCompatibleModel,
  setVoiceRuntimeOmniCompatibleAudioFormat,
  setVoiceRuntimeOmniCompatibleBaseUrl,
  setVoiceRuntimeOmniCompatibleModel,
  subscribeVoiceRuntimeOmniCompatibleAudioFormatChanges,
  subscribeVoiceRuntimeOmniCompatibleBaseUrlChanges,
  subscribeVoiceRuntimeOmniCompatibleModelChanges,
} from '@/config/voice-runtime-omni-compatible';
import {
  getVoiceRuntimeOmniApiKey,
  getVoiceRuntimeOmniFunctionCallingEnabled,
  getVoiceRuntimeOmniInstructions,
  getVoiceRuntimeOmniModel,
  getVoiceRuntimeOmniSearchEnabled,
  getVoiceRuntimeOmniToolChoice,
  getVoiceRuntimeOmniToolsJson,
  getVoiceRuntimeOmniVoice,
  getVoiceRuntimeOmniWebsocketUrl,
  setVoiceRuntimeOmniApiKey,
  setVoiceRuntimeOmniFunctionCallingEnabled,
  setVoiceRuntimeOmniInstructions,
  setVoiceRuntimeOmniModel,
  setVoiceRuntimeOmniSearchEnabled,
  setVoiceRuntimeOmniToolChoice,
  setVoiceRuntimeOmniToolsJson,
  setVoiceRuntimeOmniVoice,
  setVoiceRuntimeOmniWebsocketUrl,
  subscribeVoiceRuntimeOmniApiKeyChanges,
  subscribeVoiceRuntimeOmniFunctionCallingEnabledChanges,
  subscribeVoiceRuntimeOmniInstructionsChanges,
  subscribeVoiceRuntimeOmniModelChanges,
  subscribeVoiceRuntimeOmniSearchEnabledChanges,
  subscribeVoiceRuntimeOmniToolChoiceChanges,
  subscribeVoiceRuntimeOmniToolsJsonChanges,
  subscribeVoiceRuntimeOmniVoiceChanges,
  subscribeVoiceRuntimeOmniWebsocketUrlChanges,
} from '@/config/voice-runtime-omni';
import {
  VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
  VOICE_RUNTIME_OMNI_PROVIDER,
  getVoiceRuntimeCloudSessionPolicy,
  getVoiceRuntimeAutoSpeakEnabled,
  getVoiceRuntimeEnabled,
  getVoiceRuntimeProvider,
  setVoiceRuntimeAutoSpeakEnabled,
  setVoiceRuntimeCloudSessionPolicy,
  setVoiceRuntimeEnabled,
  subscribeVoiceRuntimeAutoSpeakEnabledChanges,
  subscribeVoiceRuntimeCloudSessionPolicyChanges,
  subscribeVoiceRuntimeEnabledChanges,
} from '@/config/voice-runtime-settings';
import {
  getVoiceRuntimeMode,
  setVoiceRuntimeMode,
  subscribeVoiceRuntimeModeChanges,
  type VoiceRuntimeMode,
} from '@/config/voice-runtime-mode';
import type {
  VoiceRuntimeCloudSessionPolicy,
  VoiceRuntimeProvider as VoiceRuntimeProviderId,
} from '@/config/voice-runtime-settings';
import { isTauriWindow } from '@/config/runtime-target';
import { createPcmS16leStreamPlayer, type PcmS16leStreamPlayer } from '@/lib/voice-runtime/pcm-s16le-stream-player';
import { DoubaoE2ERealtimeProvider } from '@/lib/voice-runtime/providers/doubao-e2e-realtime-provider';
import { QwenOmniCompatibleProvider } from '@/lib/voice-runtime/providers/qwen-omni-compatible-provider';
import { QwenOmniRealtimeProvider } from '@/lib/voice-runtime/providers/qwen-omni-realtime-provider';
import type {
  VoiceRuntimeAudioChunkMeta,
  VoiceRuntimeProvider as VoiceRuntimeProviderClient,
  VoiceRuntimeProviderCallbacks,
  VoiceRuntimeProviderConfig,
} from '@/lib/voice-runtime/providers/types';
import type {
  NormalizedVoicePerception,
  ProviderRawPerception,
} from '@/lib/voice-runtime/types';
import { VoiceRuntimeAgentService } from '@/services/voice-runtime-agent.service';
import {
  VOICE_RUNTIME_SPEAK_CANCEL_TOPIC,
  VOICE_RUNTIME_SPEAK_REQUEST_TOPIC,
} from '@/lib/constants/signal-topics';

type VoiceRuntimeLabStatus = 'idle' | 'connecting' | 'listening' | 'responding' | 'error';
type VoiceRuntimeLabConnectionStatus = 'disconnected' | 'connecting' | 'ready' | 'error';
type VoiceRuntimeLabMicrophoneStatus = 'idle' | 'requesting' | 'capturing';
type VoiceRuntimePlaybackStatus = 'idle' | 'buffering' | 'playing' | 'ended' | 'interrupted' | 'error';

export interface VoiceRuntimeLabState {
  status: VoiceRuntimeLabStatus;
  connectionStatus: VoiceRuntimeLabConnectionStatus;
  microphoneStatus: VoiceRuntimeLabMicrophoneStatus;
  ttsPlaybackStatus: VoiceRuntimePlaybackStatus;
  sessionId: string | null;
  appId: string;
  accessToken: string;
  secretKey: string;
  modelVersion: string;
  speaker: string;
  connectId: string;
  websocketUrl: string;
  omniApiKey: string;
  omniModel: string;
  omniVoice: string;
  omniInstructions: string;
  omniWebsocketUrl: string;
  omniCompatibleModel: string;
  omniCompatibleBaseUrl: string;
  omniCompatibleAudioFormat: 'wav' | 'pcm16';
  omniSearchEnabled: boolean;
  omniFunctionCallingEnabled: boolean;
  omniToolChoice: string;
  omniToolsJson: string;
  credentialConfigured: boolean;
  runtimeEnabled: boolean;
  autoSpeakEnabled: boolean;
  providerId: VoiceRuntimeProviderId;
  currentMode: VoiceRuntimeMode;
  currentCloudSessionPolicy: VoiceRuntimeCloudSessionPolicy;
  rawEvents: ProviderRawPerception[];
  liveTranscript: string;
  finalTranscript: string;
  assistantReplyText: string;
  ttsAudioBytes: number;
  firstAudioLatencyMs: number | null;
  lastNormalizedPerception: NormalizedVoicePerception | null;
  lastEventType: string | null;
  errorMessage: string;
  speakText: string;
  isTauri: boolean;
}

export interface VoiceRuntimeLabControllerDependencies {
  providerFactory?: (
    config: VoiceRuntimeProviderConfig,
    callbacks: VoiceRuntimeProviderCallbacks,
  ) => VoiceRuntimeProviderClient;
  getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  createStreamingCapture?: (options: {
    stream: MediaStream;
    onChunk: (chunk: Uint8Array) => Promise<void>;
    onLevel?: (level: number) => void;
  }) => VolcanoStreamingCapture;
  publishSignal?: (
    topic: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  audioPlayerFactory?: () => PcmS16leStreamPlayer;
}

type StateListener = (state: VoiceRuntimeLabState) => void;

function createDefaultState(): VoiceRuntimeLabState {
  const appId = getVoiceRuntimeDoubaoAppId();
  const accessToken = getVoiceRuntimeDoubaoAccessToken();
  const providerId = getVoiceRuntimeProvider();
  const omniApiKey = getVoiceRuntimeOmniApiKey();
  return {
    status: 'idle',
    connectionStatus: 'disconnected',
    microphoneStatus: 'idle',
    ttsPlaybackStatus: 'idle',
    sessionId: null,
    appId,
    accessToken,
    secretKey: getVoiceRuntimeDoubaoSecretKey(),
    modelVersion: getVoiceRuntimeDoubaoModelVersion(),
    speaker: getVoiceRuntimeDoubaoSpeaker(),
    connectId: getVoiceRuntimeDoubaoConnectId(),
    websocketUrl: getVoiceRuntimeDoubaoWebsocketUrl(),
    omniApiKey,
    omniModel: getVoiceRuntimeOmniModel(),
    omniVoice: getVoiceRuntimeOmniVoice(),
    omniInstructions: getVoiceRuntimeOmniInstructions(),
    omniWebsocketUrl: getVoiceRuntimeOmniWebsocketUrl(),
    omniCompatibleModel: getVoiceRuntimeOmniCompatibleModel(),
    omniCompatibleBaseUrl: getVoiceRuntimeOmniCompatibleBaseUrl(),
    omniCompatibleAudioFormat: getVoiceRuntimeOmniCompatibleAudioFormat(),
    omniSearchEnabled: getVoiceRuntimeOmniSearchEnabled(),
    omniFunctionCallingEnabled: getVoiceRuntimeOmniFunctionCallingEnabled(),
    omniToolChoice: getVoiceRuntimeOmniToolChoice(),
    omniToolsJson: getVoiceRuntimeOmniToolsJson(),
    credentialConfigured: resolveCredentialConfigured(providerId, {
      appId,
      accessToken,
      omniApiKey,
    }),
    runtimeEnabled: getVoiceRuntimeEnabled(),
    autoSpeakEnabled: getVoiceRuntimeAutoSpeakEnabled(),
    providerId,
    currentMode: getVoiceRuntimeMode(),
    currentCloudSessionPolicy: getVoiceRuntimeCloudSessionPolicy(),
    rawEvents: [],
    liveTranscript: '',
    finalTranscript: '',
    assistantReplyText: '',
    ttsAudioBytes: 0,
    firstAudioLatencyMs: null,
    lastNormalizedPerception: null,
    lastEventType: null,
    errorMessage: '',
    speakText: '请提醒我稍后回顾今天的实验记录。',
    isTauri: isTauriWindow(),
  };
}

function appendChatResponse(currentText: string, payload: Record<string, unknown>): string {
  const content = payload.content;
  if (typeof content !== 'string' || !content.trim()) {
    return currentText;
  }
  return currentText ? `${currentText}${content}` : content;
}

function extractErrorMessage(rawEvent: ProviderRawPerception): string {
  const message = rawEvent.payload.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }
  const error = rawEvent.payload.error;
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return `Voice runtime event failed: ${rawEvent.eventType}`;
}

function resolveProviderInputMode(
  providerId: VoiceRuntimeProviderId,
  mode: VoiceRuntimeMode,
): 'keep_alive' | 'push_to_talk' {
  if (providerId === VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER) {
    return 'push_to_talk';
  }
  return mode === 'ambient' ? 'keep_alive' : 'push_to_talk';
}

function parseOmniToolsJson(rawValue: string): Array<Record<string, unknown>> {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Omni tools JSON 解析失败（tools JSON parse failed）: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Omni tools JSON 必须是数组（tools JSON must be an array）');
  }

  const tools = parsed.filter((item): item is Record<string, unknown> => {
    return typeof item === 'object' && item !== null && !Array.isArray(item);
  });

  if (tools.length !== parsed.length) {
    throw new Error('Omni tools JSON 数组中的每一项都必须是对象（each tool must be an object）');
  }

  return tools;
}

function formatStartListeningError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim();

  if (
    normalized.includes('Command omni_realtime_session_start not found')
    || normalized.includes('omni_realtime_session_start not found')
  ) {
    return [
      '桌面端未加载 Omni Realtime 命令（omni_realtime_session_start）。',
      '请完全重启 Tauri 开发进程后再试；若仍失败，请确认当前运行实例来自最新代码。'
    ].join(' ');
  }

  if (
    normalized.includes('Command doubao_realtime_session_start not found')
    || normalized.includes('doubao_realtime_session_start not found')
  ) {
    return [
      '桌面端未加载 Doubao Realtime 命令（doubao_realtime_session_start）。',
      '请完全重启 Tauri 开发进程后再试；若仍失败，请确认当前运行实例来自最新代码。'
    ].join(' ');
  }

  return normalized || '启动语音会话失败（Unknown start error）';
}

function formatRuntimeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim();
  const lower = normalized.toLowerCase();

  if (
    lower.includes('model access denied')
    || (lower.includes('close_code=1007') && lower.includes('model'))
  ) {
    return [
      'Omni 模型访问被拒绝（Model access denied）。',
      '请在百炼控制台确认当前 API Key 已开通目标模型，并确保 Key 地域与当前 endpoint 一致：',
      '中国内地用 dashscope.aliyuncs.com；新加坡用 dashscope-intl.aliyuncs.com。',
      '若 realtime 权限未开通，可改用 compatible-mode 的 qwen3.5-omni-plus；若 flash 也被拒绝，说明该账号同样未开通。'
    ].join(' ');
  }

  return normalized || '语音会话运行失败（Unknown runtime error）';
}

function resolveCredentialConfigured(
  providerId: VoiceRuntimeProviderId,
  values: {
    appId: string;
    accessToken: string;
    omniApiKey: string;
  },
): boolean {
  if (providerId === VOICE_RUNTIME_OMNI_PROVIDER) {
    return Boolean(values.omniApiKey.trim());
  }
  if (providerId === VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER) {
    return Boolean(values.omniApiKey.trim());
  }
  return Boolean(values.appId.trim() && values.accessToken.trim());
}

const VOICE_RUNTIME_RESPONSE_TIMEOUT_MS = 12_000;

export class VoiceRuntimeLabController {
  private readonly listeners = new Set<StateListener>();
  private readonly state: VoiceRuntimeLabState = createDefaultState();
  private readonly configUnsubscribers: Array<() => void> = [];
  private readonly providerFactory: NonNullable<VoiceRuntimeLabControllerDependencies['providerFactory']>;
  private readonly getUserMedia: NonNullable<VoiceRuntimeLabControllerDependencies['getUserMedia']>;
  private readonly createStreamingCapture: NonNullable<VoiceRuntimeLabControllerDependencies['createStreamingCapture']>;
  private readonly publishSignal: NonNullable<VoiceRuntimeLabControllerDependencies['publishSignal']>;
  private readonly audioPlayer: PcmS16leStreamPlayer;
  private readonly agentService = new VoiceRuntimeAgentService();

  private provider: VoiceRuntimeProviderClient | null = null;
  private capture: VolcanoStreamingCapture | null = null;
  private stream: MediaStream | null = null;
  private sessionStartedAtMs: number | null = null;
  private completedCleanupPending = false;
  private runtimeFailureCleanupPending = false;
  private responseTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(dependencies: VoiceRuntimeLabControllerDependencies = {}) {
    this.providerFactory = dependencies.providerFactory ?? ((config, callbacks) =>
      config.provider === VOICE_RUNTIME_OMNI_PROVIDER
        ? new QwenOmniRealtimeProvider(config, callbacks)
        : config.provider === VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER
          ? new QwenOmniCompatibleProvider(config, callbacks)
        : new DoubaoE2ERealtimeProvider(config, callbacks));
    this.getUserMedia = dependencies.getUserMedia ?? ((constraints) =>
      getUserMediaWithConstraintFallback(
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
        constraints,
      ));
    this.createStreamingCapture = dependencies.createStreamingCapture ?? ((options) =>
      createVolcanoStreamingCapture({
        ...options,
        samplesPerChunk: 320,
      }));
    this.publishSignal = dependencies.publishSignal ?? (async (topic, payload) => {
      if (topic === VOICE_RUNTIME_SPEAK_REQUEST_TOPIC) {
        await publishVoiceRuntimeSpeakRequestSignal(String(payload.text ?? ''));
        return;
      }
      if (topic === VOICE_RUNTIME_SPEAK_CANCEL_TOPIC) {
        await publishVoiceRuntimeSpeakCancelSignal();
      }
    });
    this.audioPlayer = (dependencies.audioPlayerFactory ?? (() => createPcmS16leStreamPlayer()))();
    this.bindConfigSubscriptions();
  }

  getState(): VoiceRuntimeLabState {
    return {
      ...this.state,
      rawEvents: [...this.state.rawEvents],
      lastNormalizedPerception: this.state.lastNormalizedPerception,
    };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  updateAppId(value: string): void {
    this.state.appId = setVoiceRuntimeDoubaoAppId(value);
    this.syncCredentialConfigured();
  }

  updateAccessToken(value: string): void {
    this.state.accessToken = setVoiceRuntimeDoubaoAccessToken(value);
    this.syncCredentialConfigured();
  }

  updateSecretKey(value: string): void {
    this.state.secretKey = setVoiceRuntimeDoubaoSecretKey(value);
    this.emit();
  }

  updateModelVersion(value: string): void {
    this.state.modelVersion = setVoiceRuntimeDoubaoModelVersion(value);
    this.emit();
  }

  updateSpeaker(value: string): void {
    this.state.speaker = setVoiceRuntimeDoubaoSpeaker(value);
    this.emit();
  }

  updateConnectId(value: string): void {
    this.state.connectId = setVoiceRuntimeDoubaoConnectId(value);
    this.emit();
  }

  updateWebsocketUrl(value: string): void {
    this.state.websocketUrl = setVoiceRuntimeDoubaoWebsocketUrl(value);
    this.emit();
  }

  updateProvider(value: VoiceRuntimeProviderId): void {
    // Lab provider stays local so Omni manual tests don't hijack shared runtime provider
    // （实验台 Provider 仅作用于本页，避免抢占全局运行时 Provider）。
    this.state.providerId = value;
    this.syncCredentialConfigured();
  }

  updateOmniApiKey(value: string): void {
    this.state.omniApiKey = setVoiceRuntimeOmniApiKey(value);
    this.syncCredentialConfigured();
  }

  updateOmniModel(value: string): void {
    this.state.omniModel = setVoiceRuntimeOmniModel(value);
    this.emit();
  }

  updateOmniVoice(value: string): void {
    this.state.omniVoice = setVoiceRuntimeOmniVoice(value);
    this.emit();
  }

  updateOmniInstructions(value: string): void {
    this.state.omniInstructions = setVoiceRuntimeOmniInstructions(value);
    this.emit();
  }

  updateOmniWebsocketUrl(value: string): void {
    this.state.omniWebsocketUrl = setVoiceRuntimeOmniWebsocketUrl(value);
    this.emit();
  }

  updateOmniCompatibleModel(value: string): void {
    this.state.omniCompatibleModel = setVoiceRuntimeOmniCompatibleModel(value);
    this.emit();
  }

  updateOmniCompatibleBaseUrl(value: string): void {
    this.state.omniCompatibleBaseUrl = setVoiceRuntimeOmniCompatibleBaseUrl(value);
    this.emit();
  }

  updateOmniCompatibleAudioFormat(value: 'wav' | 'pcm16'): void {
    this.state.omniCompatibleAudioFormat = setVoiceRuntimeOmniCompatibleAudioFormat(value);
    this.emit();
  }

  updateOmniSearchEnabled(value: boolean): void {
    this.state.omniSearchEnabled = setVoiceRuntimeOmniSearchEnabled(value);
    this.emit();
  }

  updateOmniFunctionCallingEnabled(value: boolean): void {
    this.state.omniFunctionCallingEnabled = setVoiceRuntimeOmniFunctionCallingEnabled(value);
    this.emit();
  }

  updateOmniToolChoice(value: string): void {
    this.state.omniToolChoice = setVoiceRuntimeOmniToolChoice(value);
    this.emit();
  }

  updateOmniToolsJson(value: string): void {
    this.state.omniToolsJson = setVoiceRuntimeOmniToolsJson(value);
    this.emit();
  }

  updateSpeakText(value: string): void {
    this.state.speakText = value;
    this.emit();
  }

  updateRuntimeEnabled(value: boolean): void {
    this.state.runtimeEnabled = setVoiceRuntimeEnabled(value);
    this.emit();
  }

  updateAutoSpeakEnabled(value: boolean): void {
    this.state.autoSpeakEnabled = setVoiceRuntimeAutoSpeakEnabled(value);
    this.emit();
  }

  updateRuntimeMode(value: VoiceRuntimeMode): void {
    this.state.currentMode = setVoiceRuntimeMode(value);
    this.emit();
  }

  updateCloudSessionPolicy(value: VoiceRuntimeCloudSessionPolicy): void {
    this.state.currentCloudSessionPolicy = setVoiceRuntimeCloudSessionPolicy(value);
    this.emit();
  }

  async startListening(): Promise<void> {
    if (!this.state.credentialConfigured) {
      this.setError(
        this.state.providerId === VOICE_RUNTIME_OMNI_PROVIDER
        || this.state.providerId === VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER
          ? '请先填写 Omni API Key（请先配置 Omni 凭据）'
          : '请先填写 APP ID 和 Access Token（请先配置豆包 S2S 凭据）',
      );
      return;
    }

    if (this.provider) {
      const isSessionActive = this.state.status === 'connecting' || this.state.status === 'listening';
      if (isSessionActive) {
        this.setError('当前已有进行中的语音会话，请先停止或取消（Session already running）');
        return;
      }
      await this.cancelListening();
    }

    this.clearResponseTimeout();
    this.state.status = 'connecting';
    this.state.connectionStatus = 'connecting';
    this.state.microphoneStatus = 'requesting';
    this.state.ttsPlaybackStatus = 'idle';
    this.state.errorMessage = '';
    this.state.assistantReplyText = '';
    this.state.ttsAudioBytes = 0;
    this.state.firstAudioLatencyMs = null;
    this.emit();

    let provider: VoiceRuntimeProviderClient | null = null;

    try {
      provider = this.providerFactory(this.buildProviderConfig(), {
        onRawEvent: (rawEvent) => this.handleProviderRawEvent(rawEvent),
        onAudioChunk: (chunk, meta) => this.handleProviderAudioChunk(chunk, meta),
      });
      const activeProvider = provider;
      const sessionId = await activeProvider.start();
      const stream = await this.getUserMedia({
        audio: {
          ...DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
          sampleRate: 16000,
        },
      });
      const capture = this.createStreamingCapture({
        stream,
        onChunk: async (chunk) => {
          try {
            await activeProvider.pushAudio(chunk);
          } catch (error) {
            await this.handleRuntimeFailure(error);
          }
        },
      });

      this.provider = activeProvider;
      this.capture = capture;
      this.stream = stream;
      await capture.start();
      this.sessionStartedAtMs = Date.now();
      this.state.status = 'listening';
      this.state.microphoneStatus = 'capturing';
      this.state.sessionId = sessionId;
      this.emit();
    } catch (error) {
      this.clearResponseTimeout();
      await provider?.cancel().catch(() => {});
      await provider?.dispose().catch(() => {});
      this.releaseStream();
      this.setError(formatStartListeningError(error));
    }
  }

  async stopListening(): Promise<void> {
    if (!this.capture || !this.provider) {
      return;
    }

    this.state.status = 'responding';
    this.state.microphoneStatus = 'idle';
    this.emit();

    try {
      const trailingChunk = await this.capture.stop();
      this.capture = null;
      this.releaseStream();
      await this.provider.finish(trailingChunk ?? new Uint8Array());
      this.armResponseTimeout();
    } catch (error) {
      this.setError(error instanceof Error ? error.message : String(error));
    }
  }

  async cancelListening(): Promise<void> {
    this.clearResponseTimeout();
    if (this.capture) {
      await this.capture.cancel().catch(() => {});
      this.capture = null;
    }
    if (this.provider) {
      await this.provider.cancel().catch(() => {});
      await this.provider.dispose().catch(() => {});
      this.provider = null;
    }
    await this.audioPlayer.interrupt().catch(() => {});
    this.releaseStream();
    this.resetTransientState();
    this.emit();
  }

  async sendSpeakRequest(): Promise<void> {
    await this.publishSignal(VOICE_RUNTIME_SPEAK_REQUEST_TOPIC, {
      text: this.state.speakText.trim(),
    });
  }

  async sendSpeakCancel(): Promise<void> {
    await this.publishSignal(VOICE_RUNTIME_SPEAK_CANCEL_TOPIC, {});
  }

  async dispose(): Promise<void> {
    this.clearResponseTimeout();
    await this.cancelListening();
    await this.audioPlayer.dispose().catch(() => {});
    for (const unsubscribe of this.configUnsubscribers.splice(0)) {
      unsubscribe();
    }
    this.listeners.clear();
  }

  private bindConfigSubscriptions(): void {
    this.configUnsubscribers.push(
      subscribeVoiceRuntimeDoubaoAppIdChanges((value) => {
        this.state.appId = value;
        this.syncCredentialConfigured();
      }),
      subscribeVoiceRuntimeDoubaoAccessTokenChanges((value) => {
        this.state.accessToken = value;
        this.syncCredentialConfigured();
      }),
      subscribeVoiceRuntimeDoubaoSecretKeyChanges((value) => {
        this.state.secretKey = value;
        this.emit();
      }),
      subscribeVoiceRuntimeDoubaoModelVersionChanges((value) => {
        this.state.modelVersion = value;
        this.emit();
      }),
      subscribeVoiceRuntimeDoubaoSpeakerChanges((value) => {
        this.state.speaker = value;
        this.emit();
      }),
      subscribeVoiceRuntimeDoubaoConnectIdChanges((value) => {
        this.state.connectId = value;
        this.emit();
      }),
      subscribeVoiceRuntimeDoubaoWebsocketUrlChanges((value) => {
        this.state.websocketUrl = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniApiKeyChanges((value) => {
        this.state.omniApiKey = value;
        this.syncCredentialConfigured();
      }),
      subscribeVoiceRuntimeOmniModelChanges((value) => {
        this.state.omniModel = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniVoiceChanges((value) => {
        this.state.omniVoice = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniInstructionsChanges((value) => {
        this.state.omniInstructions = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniWebsocketUrlChanges((value) => {
        this.state.omniWebsocketUrl = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniCompatibleModelChanges((value) => {
        this.state.omniCompatibleModel = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniCompatibleBaseUrlChanges((value) => {
        this.state.omniCompatibleBaseUrl = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniCompatibleAudioFormatChanges((value) => {
        this.state.omniCompatibleAudioFormat = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniSearchEnabledChanges((value) => {
        this.state.omniSearchEnabled = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniFunctionCallingEnabledChanges((value) => {
        this.state.omniFunctionCallingEnabled = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniToolChoiceChanges((value) => {
        this.state.omniToolChoice = value;
        this.emit();
      }),
      subscribeVoiceRuntimeOmniToolsJsonChanges((value) => {
        this.state.omniToolsJson = value;
        this.emit();
      }),
      subscribeVoiceRuntimeEnabledChanges((value) => {
        this.state.runtimeEnabled = value;
        this.emit();
      }),
      subscribeVoiceRuntimeAutoSpeakEnabledChanges((value) => {
        this.state.autoSpeakEnabled = value;
        this.emit();
      }),
      subscribeVoiceRuntimeModeChanges((value) => {
        this.state.currentMode = value;
        this.emit();
      }),
      subscribeVoiceRuntimeCloudSessionPolicyChanges((value) => {
        this.state.currentCloudSessionPolicy = value;
        this.emit();
      }),
    );
  }

  private buildProviderConfig(): VoiceRuntimeProviderConfig {
    if (this.state.providerId === VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER) {
      return {
        provider: VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
        modelVersion: this.state.omniCompatibleModel,
        sampleRate: 16000,
        language: 'zh-CN',
        apiKey: this.state.omniApiKey,
        baseUrl: this.state.omniCompatibleBaseUrl,
        websocketUrl: this.state.omniCompatibleBaseUrl,
        speaker: this.state.omniVoice,
        instructions: this.state.omniInstructions,
        inputMode: resolveProviderInputMode(this.state.providerId, this.state.currentMode),
        ttsAudioFormat: 'pcm_s16le',
        ttsSampleRate: 24000,
        audioOutputFormat: this.state.omniCompatibleAudioFormat,
      };
    }

    if (this.state.providerId === VOICE_RUNTIME_OMNI_PROVIDER) {
      const tools = this.state.omniFunctionCallingEnabled
        ? parseOmniToolsJson(this.state.omniToolsJson)
        : [];
      return {
        provider: VOICE_RUNTIME_OMNI_PROVIDER,
        modelVersion: this.state.omniModel,
        sampleRate: 16000,
        language: 'zh-CN',
        apiKey: this.state.omniApiKey,
        websocketUrl: this.state.omniWebsocketUrl,
        speaker: this.state.omniVoice,
        instructions: this.state.omniInstructions,
        inputMode: resolveProviderInputMode(this.state.providerId, this.state.currentMode),
        ttsAudioFormat: 'pcm_s16le',
        ttsSampleRate: 24000,
        enableSearch: this.state.omniSearchEnabled,
        searchOptions: this.state.omniSearchEnabled
          ? {
            enableSource: true,
          }
          : undefined,
        tools: this.state.omniFunctionCallingEnabled ? tools : undefined,
        toolChoice: this.state.omniFunctionCallingEnabled
          ? this.state.omniToolChoice.trim() || 'auto'
          : undefined,
      };
    }

    return {
      provider: 'doubao-o2-realtime',
      modelVersion: this.state.modelVersion,
      sampleRate: 16000,
      language: 'zh-CN',
      appId: this.state.appId,
      accessToken: this.state.accessToken,
      secretKey: this.state.secretKey,
      websocketUrl: this.state.websocketUrl,
      connectId: this.state.connectId,
      speaker: this.state.speaker,
      inputMode: resolveProviderInputMode(this.state.providerId, this.state.currentMode),
      ttsAudioFormat: 'pcm_s16le',
      ttsSampleRate: 24000,
    };
  }

  private async handleProviderRawEvent(rawEvent: ProviderRawPerception): Promise<void> {
    if (rawEvent.eventType === 'SessionStarted') {
      this.state.connectionStatus = 'ready';
    }

    if (rawEvent.eventType === 'ChatResponse') {
      this.state.assistantReplyText = appendChatResponse(this.state.assistantReplyText, rawEvent.payload);
    }

    if (rawEvent.eventType === 'TTSSentenceStart') {
      this.state.ttsPlaybackStatus = 'buffering';
    }

    if (rawEvent.eventType === 'ASRInfo') {
      await this.audioPlayer.interrupt().catch(() => {});
      this.state.ttsPlaybackStatus = 'interrupted';
    }

    if (
      rawEvent.eventType === 'SessionFailed'
      || rawEvent.eventType === 'ConnectionFailed'
      || rawEvent.eventType === 'DialogCommonError'
      || rawEvent.eventType === 'error'
    ) {
      await this.handleRuntimeFailure(extractErrorMessage(rawEvent));
      return;
    }

    await this.agentService.handleProviderRawEvent(rawEvent);
    const agentState = this.agentService.getState();
    this.state.rawEvents = agentState.rawEvents;
    this.state.liveTranscript = agentState.liveTranscript;
    this.state.finalTranscript = agentState.finalTranscript;
    this.state.lastNormalizedPerception = agentState.lastNormalizedPerception;
    this.state.lastEventType = rawEvent.eventType;

    if (rawEvent.eventType === 'TTSEnded') {
      this.clearResponseTimeout();
      this.state.ttsPlaybackStatus = 'ended';
      const shouldKeepListeningInAmbientMode =
        this.state.currentMode === 'ambient'
        && this.provider != null
        && this.capture != null;
      if (shouldKeepListeningInAmbientMode) {
        this.state.status = 'listening';
        this.state.connectionStatus = 'ready';
        this.state.microphoneStatus = 'capturing';
        this.emit();
        return;
      }
      this.state.status = 'idle';
      this.state.connectionStatus = 'disconnected';
      this.state.microphoneStatus = 'idle';
      this.state.sessionId = null;
      this.emit();
      await this.cleanupAfterCompleted();
      return;
    }

    if (rawEvent.eventType === 'SessionFinished' || rawEvent.eventType === 'ConnectionFinished') {
      this.clearResponseTimeout();
      this.state.status = 'idle';
      this.state.connectionStatus = 'disconnected';
      this.state.microphoneStatus = 'idle';
      this.state.sessionId = null;
      this.emit();
      await this.cleanupAfterCompleted();
      return;
    }

    this.emit();
  }

  private async handleProviderAudioChunk(
    chunk: Uint8Array,
    _meta: VoiceRuntimeAudioChunkMeta,
  ): Promise<void> {
    try {
      await this.audioPlayer.enqueuePcm16(chunk);
      this.state.ttsPlaybackStatus = 'playing';
      this.state.ttsAudioBytes += chunk.byteLength;
      if (this.state.firstAudioLatencyMs == null && this.sessionStartedAtMs != null) {
        this.state.firstAudioLatencyMs = Math.max(0, Date.now() - this.sessionStartedAtMs);
      }
      this.emit();
    } catch (error) {
      this.state.ttsPlaybackStatus = 'error';
      this.state.errorMessage = error instanceof Error ? error.message : String(error);
      this.emit();
    }
  }

  private async cleanupAfterCompleted(): Promise<void> {
    if (this.completedCleanupPending) {
      return;
    }
    this.completedCleanupPending = true;
    try {
      this.clearResponseTimeout();
      // Do not interrupt queued PCM on normal completion（正常完成时不要打断本地 PCM 队列）.
      // `interrupt()` should only be used for explicit cancel / barge-in.
      if (this.capture) {
        await this.capture.cancel().catch(() => {});
        this.capture = null;
      }
      if (this.provider) {
        await this.provider.dispose().catch(() => {});
        this.provider = null;
      }
      this.releaseStream();
      this.sessionStartedAtMs = null;
    } finally {
      this.completedCleanupPending = false;
    }
  }

  private releaseStream(): void {
    if (!this.stream) {
      return;
    }

    for (const track of this.stream.getTracks()) {
      track.stop?.();
    }
    this.stream = null;
  }

  private resetTransientState(): void {
    this.state.status = 'idle';
    this.state.connectionStatus = 'disconnected';
    this.state.microphoneStatus = 'idle';
    this.state.ttsPlaybackStatus = 'idle';
    this.state.sessionId = null;
    this.sessionStartedAtMs = null;
  }

  private setError(message: string): void {
    this.clearResponseTimeout();
    this.state.status = 'error';
    this.state.connectionStatus = 'error';
    this.state.microphoneStatus = 'idle';
    this.state.sessionId = null;
    this.state.errorMessage = message;
    this.emit();
  }

  private async handleRuntimeFailure(error: unknown): Promise<void> {
    const message = formatRuntimeFailureMessage(error);
    this.setError(message);
    await this.cleanupRuntimeResources();
  }

  private async cleanupRuntimeResources(): Promise<void> {
    if (this.runtimeFailureCleanupPending) {
      return;
    }
    this.runtimeFailureCleanupPending = true;
    try {
      this.clearResponseTimeout();
      if (this.capture) {
        await this.capture.cancel().catch(() => {});
        this.capture = null;
      }
      if (this.provider) {
        await this.provider.cancel().catch(() => {});
        await this.provider.dispose().catch(() => {});
        this.provider = null;
      }
      await this.audioPlayer.interrupt().catch(() => {});
      this.releaseStream();
      this.sessionStartedAtMs = null;
    } finally {
      this.runtimeFailureCleanupPending = false;
    }
  }

  private syncCredentialConfigured(): void {
    this.state.credentialConfigured = resolveCredentialConfigured(this.state.providerId, {
      appId: this.state.appId,
      accessToken: this.state.accessToken,
      omniApiKey: this.state.omniApiKey,
    });
    this.emit();
  }

  private clearResponseTimeout(): void {
    if (!this.responseTimeoutHandle) {
      return;
    }
    clearTimeout(this.responseTimeoutHandle);
    this.responseTimeoutHandle = null;
  }

  private armResponseTimeout(): void {
    this.clearResponseTimeout();
    this.responseTimeoutHandle = setTimeout(() => {
      if (this.state.status !== 'responding') {
        return;
      }
      this.state.status = 'idle';
      this.state.connectionStatus = 'disconnected';
      this.state.microphoneStatus = 'idle';
      this.state.sessionId = null;
      this.state.errorMessage = '等待会话结束事件超时，已自动回收会话（Session timeout recovered）';
      this.emit();
      void this.cleanupAfterCompleted();
    }, VOICE_RUNTIME_RESPONSE_TIMEOUT_MS);
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
