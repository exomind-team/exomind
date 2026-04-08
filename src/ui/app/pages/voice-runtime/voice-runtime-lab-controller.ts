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
  subscribeVoiceRuntimeProviderChanges,
} from '@/config/voice-runtime-settings';
import {
  getVoiceRuntimeMode,
  setVoiceRuntimeMode,
  subscribeVoiceRuntimeModeChanges,
  type VoiceRuntimeMode,
} from '@/config/voice-runtime-mode';
import type { VoiceRuntimeCloudSessionPolicy } from '@/config/voice-runtime-settings';
import { isTauriWindow } from '@/config/runtime-target';
import { createPcmS16leStreamPlayer, type PcmS16leStreamPlayer } from '@/lib/voice-runtime/pcm-s16le-stream-player';
import { DoubaoE2ERealtimeProvider } from '@/lib/voice-runtime/providers/doubao-e2e-realtime-provider';
import type {
  VoiceRuntimeAudioChunkMeta,
  VoiceRuntimeProvider,
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
  credentialConfigured: boolean;
  runtimeEnabled: boolean;
  autoSpeakEnabled: boolean;
  providerId: string;
  currentMode: string;
  currentCloudSessionPolicy: string;
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
  ) => VoiceRuntimeProvider;
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
    credentialConfigured: Boolean(appId.trim() && accessToken.trim()),
    runtimeEnabled: getVoiceRuntimeEnabled(),
    autoSpeakEnabled: getVoiceRuntimeAutoSpeakEnabled(),
    providerId: getVoiceRuntimeProvider(),
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

function resolveProviderInputMode(mode: string): 'keep_alive' | 'push_to_talk' {
  return mode === 'ambient' ? 'keep_alive' : 'push_to_talk';
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

  private provider: VoiceRuntimeProvider | null = null;
  private capture: VolcanoStreamingCapture | null = null;
  private stream: MediaStream | null = null;
  private sessionStartedAtMs: number | null = null;
  private completedCleanupPending = false;
  private responseTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(dependencies: VoiceRuntimeLabControllerDependencies = {}) {
    this.providerFactory = dependencies.providerFactory ?? ((config, callbacks) =>
      new DoubaoE2ERealtimeProvider(config, callbacks));
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
      this.setError('请先填写 APP ID 和 Access Token（请先配置豆包 S2S 凭据）');
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

    const provider = this.providerFactory(this.buildProviderConfig(), {
      onRawEvent: (rawEvent) => this.handleProviderRawEvent(rawEvent),
      onAudioChunk: (chunk, meta) => this.handleProviderAudioChunk(chunk, meta),
    });

    try {
      const sessionId = await provider.start();
      const stream = await this.getUserMedia({
        audio: {
          ...DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
          sampleRate: 16000,
        },
      });
      const capture = this.createStreamingCapture({
        stream,
        onChunk: async (chunk) => {
          await provider.pushAudio(chunk);
        },
      });

      await capture.start();
      this.provider = provider;
      this.capture = capture;
      this.stream = stream;
      this.sessionStartedAtMs = Date.now();
      this.state.status = 'listening';
      this.state.microphoneStatus = 'capturing';
      this.state.sessionId = sessionId;
      this.emit();
    } catch (error) {
      this.clearResponseTimeout();
      await provider.cancel().catch(() => {});
      await provider.dispose().catch(() => {});
      this.releaseStream();
      this.setError(error instanceof Error ? error.message : String(error));
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
      subscribeVoiceRuntimeEnabledChanges((value) => {
        this.state.runtimeEnabled = value;
        this.emit();
      }),
      subscribeVoiceRuntimeAutoSpeakEnabledChanges((value) => {
        this.state.autoSpeakEnabled = value;
        this.emit();
      }),
      subscribeVoiceRuntimeProviderChanges((value) => {
        this.state.providerId = value;
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
      inputMode: resolveProviderInputMode(this.state.currentMode),
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
      this.clearResponseTimeout();
      this.setError(extractErrorMessage(rawEvent));
      return;
    }

    const normalized = await this.agentService.handleProviderRawEvent(rawEvent);
    const agentState = this.agentService.getState();
    this.state.rawEvents = agentState.rawEvents;
    this.state.liveTranscript = agentState.liveTranscript;
    this.state.finalTranscript = agentState.finalTranscript;
    this.state.lastNormalizedPerception = agentState.lastNormalizedPerception;
    this.state.lastEventType = rawEvent.eventType;

    if (normalized?.isFinal) {
      this.state.status = 'responding';
    }

    if (rawEvent.eventType === 'TTSEnded' || rawEvent.eventType === 'SessionFinished') {
      this.clearResponseTimeout();
      this.state.ttsPlaybackStatus = 'ended';
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
      if (this.provider) {
        await this.provider.dispose().catch(() => {});
        this.provider = null;
      }
      this.capture = null;
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

  private syncCredentialConfigured(): void {
    this.state.credentialConfigured = Boolean(this.state.appId.trim() && this.state.accessToken.trim());
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
