import { listen, emit } from '@tauri-apps/api/event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { MOSSASRAdapter } from '../lib/adapters/asr/moss-asr';
import { getClipboardService } from '../lib/services/clipboard.service';
import { getEventLogService } from '../lib/services/eventlog.service';
import {
  getVoiceShortcutHotkey,
  subscribeVoiceShortcutHotkeyChanges,
  type VoiceShortcutHotkey,
} from '../config/voice-shortcut-hotkey';
import {
  getVoiceShortcutMicPrewarmEnabled,
  subscribeVoiceShortcutMicPrewarmChanges,
} from '@/config/voice-shortcut-mic-prewarm';
import {
  createCompatibleMediaRecorder,
  getUserMediaWithConstraintFallback,
  DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
} from '../lib/media/microphone-capture';
import { convertWebmBlobToWav } from '../lib/media/wav-audio';
import type { ASRResult } from '../lib/ports/asr-port';
import {
  getVoiceShortcutAsrProvider,
  subscribeVoiceShortcutAsrProviderChanges,
  type VoiceShortcutAsrProvider,
} from '@/config/voice-shortcut-asr-provider';
import {
  DEFAULT_VOLCANO_RESOURCE_ID,
  VOLCANO_ENDPOINT_OPTIONS,
  VOLCANO_RESOURCE_PRESETS,
  findVolcanoResourcePreset,
  getStoredVolcanoRuntimeConfig,
  type VolcanoRuntimeConfig,
} from '@/lib/asr/volcano-config';
import {
  createDefaultVoiceLivePreviewSource,
  type VoiceLivePreviewSession,
  type VoiceLivePreviewSource,
} from '@/lib/asr/live-preview';
import {
  createVolcanoStreamingCapture,
  type VolcanoStreamingCapture,
} from '@/lib/asr/volcano-streaming-capture';

export type VoiceShortcutState = 'idle' | 'arming' | 'recording' | 'recognizing' | 'done' | 'error';

const LOG_TAG = '[VoiceShortcut]';
const AUTO_HIDE_DONE_MS = 2000;
const AUTO_HIDE_ERROR_MS = 3000;
type OverlayEventPayload = {
  state: VoiceShortcutState;
  duration?: number;
  text: string;
  hintText?: string;
  isLivePreview: boolean;
  providerLabel: string;
  activationMs?: number;
  firstTextMs?: number;
  debugTraceId?: string;
  debugPressedAtMs?: number;
  recognitionMs?: number;
  errorMessage: string;
};

type VolcanoAsrStreamEventPayload = {
  sessionId: string;
  text?: string;
  isFinal?: boolean;
  isDefinite?: boolean;
  errorMessage?: string;
};

export class VoiceShortcutService {
  private state: VoiceShortcutState = 'idle';
  private stream: MediaStream | null = null;
  private warmStream: MediaStream | null = null;
  private warmStreamPromise: Promise<MediaStream | null> | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType: string | null = null;
  private adapter: MOSSASRAdapter;
  private unlisten: (() => void) | null = null;
  private unlistenVolcanoStream: (() => void) | null = null;
  private unlistenHotkey: (() => void) | null = null;
  private unlistenProvider: (() => void) | null = null;
  private unlistenMicPrewarm: (() => void) | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private initializing = false;
  private startPending = false;
  private activationStartedAt: number | null = null;
  private traceStartedAtMs: number | null = null;
  private currentTraceId: string | null = null;
  private latestActivationMs: number | null = null;
  private latestFirstTextMs: number | null = null;
  private asrProvider: VoiceShortcutAsrProvider = getVoiceShortcutAsrProvider();
  private micPrewarmEnabled = getVoiceShortcutMicPrewarmEnabled();
  private livePreviewSource: VoiceLivePreviewSource;
  private livePreviewSession: VoiceLivePreviewSession | null = null;
  private livePreviewText = '';
  private volcanoStreamingCapture: VolcanoStreamingCapture | null = null;
  private volcanoStreamSessionId: string | null = null;
  private volcanoPushQueue: Promise<void> = Promise.resolve();
  private warmVolcanoSessionId: string | null = null;
  private warmVolcanoSessionKey: string | null = null;
  private warmVolcanoSessionPromise: Promise<string | null> | null = null;

  constructor(livePreviewSource: VoiceLivePreviewSource = createDefaultVoiceLivePreviewSource()) {
    this.adapter = new MOSSASRAdapter();
    this.livePreviewSource = livePreviewSource;
  }

  async init(): Promise<void> {
    if (this.unlisten || this.initializing) return;
    if (!isTauri()) {
      console.warn(LOG_TAG, 'not in Tauri environment, service disabled');
      return;
    }
    this.initializing = true;

    try {
      await this.applyShortcut(getVoiceShortcutHotkey());

      this.unlistenHotkey = subscribeVoiceShortcutHotkeyChanges((hotkey) => {
        this.applyShortcut(hotkey).catch((error) => {
          console.error(LOG_TAG, 'failed to apply updated voice shortcut:', error);
        });
      });

      this.unlistenProvider = subscribeVoiceShortcutAsrProviderChanges((provider) => {
        this.asrProvider = provider;
        void this.prewarmResourcesForProvider();
      });

      this.unlistenMicPrewarm = subscribeVoiceShortcutMicPrewarmChanges((enabled) => {
        this.micPrewarmEnabled = enabled;
        void this.prewarmResourcesForProvider();
      });

      this.unlisten = await listen<string>('voice-shortcut', (event) => {
        if (event.payload === 'start') this.handleStart();
        if (event.payload === 'stop') this.handleStop();
        if (event.payload === 'cancel') this.handleCancel();
      });

      this.unlistenVolcanoStream = await listen<VolcanoAsrStreamEventPayload>('volcano-asr-stream-event', (event) => {
        this.handleVolcanoStreamEvent(event.payload);
      });

      if (typeof window !== 'undefined') {
        window.addEventListener('focus', this.handleAppForeground);
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
      }

      void this.prewarmResourcesForProvider();
    } finally {
      this.initializing = false;
    }
  }

  destroy(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.unlistenVolcanoStream?.();
    this.unlistenVolcanoStream = null;
    this.unlistenHotkey?.();
    this.unlistenHotkey = null;
    this.unlistenProvider?.();
    this.unlistenProvider = null;
    this.unlistenMicPrewarm?.();
    this.unlistenMicPrewarm = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.handleAppForeground);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    void this.syncRecordingActive(false);
    this.stopLivePreview('abort');
    void this.cancelWarmVolcanoSession();
    this.releaseWarmStream();
    this.releaseResources();
    this.clearAutoHide();
  }

  getState(): VoiceShortcutState {
    return this.state;
  }

  private readonly handleAppForeground = (): void => {
    if (this.startPending || this.state === 'recording' || this.state === 'recognizing') {
      return;
    }
    void this.prewarmResourcesForProvider();
  };

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    this.handleAppForeground();
  };

  private beginActivationTracking(): void {
    const now = Date.now();
    this.activationStartedAt = now;
    this.traceStartedAtMs = now;
    this.currentTraceId = `voice-${now}`;
    this.latestActivationMs = null;
    this.latestFirstTextMs = null;
    console.info(LOG_TAG, `[trace ${this.currentTraceId}] shortcut pressed at ${now}`);
  }

  private completeActivationTracking(): number | undefined {
    if (this.activationStartedAt == null) {
      return this.latestActivationMs ?? undefined;
    }

    const activationMs = Math.max(0, Date.now() - this.activationStartedAt);
    this.activationStartedAt = null;
    this.latestActivationMs = activationMs;
    if (this.currentTraceId) {
      console.info(LOG_TAG, `[trace ${this.currentTraceId}] entered recording in ${activationMs}ms`);
    }
    return activationMs;
  }

  private markFirstTextSeen(): number | undefined {
    if (this.latestFirstTextMs != null || this.traceStartedAtMs == null) {
      return this.latestFirstTextMs ?? undefined;
    }

    const firstTextMs = Math.max(0, Date.now() - this.traceStartedAtMs);
    this.latestFirstTextMs = firstTextMs;
    if (this.currentTraceId) {
      console.info(LOG_TAG, `[trace ${this.currentTraceId}] first text in ${firstTextMs}ms`);
    }
    return firstTextMs;
  }

  private isLiveStream(stream: MediaStream | null): stream is MediaStream {
    if (!stream) return false;
    const tracks = stream.getTracks();
    return tracks.length > 0 && tracks.every((track) => track.readyState === 'live');
  }

  private async prewarmResourcesForProvider(): Promise<void> {
    if (!this.micPrewarmEnabled) {
      await this.cancelWarmVolcanoSession();
      this.releaseWarmStream();
      return;
    }

    await this.prewarmMicrophoneIfGranted();

    if (this.asrProvider === 'volcano') {
      await this.prewarmVolcanoSessionIfPossible();
      return;
    }

    await this.cancelWarmVolcanoSession();
  }

  private async prewarmMicrophoneIfGranted(): Promise<MediaStream | null> {
    if (!this.micPrewarmEnabled) {
      return null;
    }
    if (this.isLiveStream(this.warmStream)) {
      return this.warmStream;
    }
    if (this.warmStreamPromise) {
      return this.warmStreamPromise;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return null;
    }

    this.warmStreamPromise = (async () => {
      try {
        const permissionState = await navigator.permissions?.query?.({
          name: 'microphone' as PermissionName,
        });
        if (permissionState?.state !== 'granted') {
          return null;
        }

        const stream = await getUserMediaWithConstraintFallback(
          (constraints) => navigator.mediaDevices.getUserMedia(constraints),
          { audio: DEFAULT_RECORDING_AUDIO_CONSTRAINTS },
        );
        this.warmStream = stream;
        return stream;
      } catch (error) {
        console.warn(LOG_TAG, 'microphone prewarm skipped:', error);
        return null;
      } finally {
        this.warmStreamPromise = null;
      }
    })();

    return this.warmStreamPromise;
  }

  private async acquireInputStream(): Promise<MediaStream> {
    if (this.isLiveStream(this.warmStream)) {
      return this.warmStream;
    }

    const pendingWarmStream = await this.warmStreamPromise;
    if (this.isLiveStream(pendingWarmStream)) {
      this.warmStream = pendingWarmStream;
      return pendingWarmStream;
    }

    const stream = await getUserMediaWithConstraintFallback(
      (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      { audio: DEFAULT_RECORDING_AUDIO_CONSTRAINTS },
    );
    this.warmStream = stream;
    return stream;
  }

  private releaseWarmStream(): void {
    if (!this.warmStream) {
      return;
    }
    this.warmStream.getTracks().forEach((track) => track.stop());
    this.warmStream = null;
  }

  private getWarmVolcanoSessionKey(config: VolcanoRuntimeConfig): string {
    return JSON.stringify({
      appKey: config.appKey,
      accessKey: config.accessKey,
      resourceId: config.resourceId,
      endpoint: config.endpoint,
      request: config.request,
    });
  }

  private async cancelWarmVolcanoSession(): Promise<void> {
    const sessionId = this.warmVolcanoSessionId;
    this.warmVolcanoSessionId = null;
    this.warmVolcanoSessionKey = null;
    this.warmVolcanoSessionPromise = null;

    if (!sessionId) {
      return;
    }

    try {
      await invoke('volcano_asr_stream_cancel', { sessionId });
    } catch (error) {
      console.warn(LOG_TAG, 'failed to cancel warm volcano session:', error);
    }
  }

  private clearWarmVolcanoSessionState(): void {
    this.warmVolcanoSessionId = null;
    this.warmVolcanoSessionKey = null;
    this.warmVolcanoSessionPromise = null;
  }

  private async doesVolcanoSessionExist(sessionId: string): Promise<boolean> {
    try {
      return await invoke<boolean>('volcano_asr_stream_session_exists', { sessionId });
    } catch (error) {
      console.warn(LOG_TAG, 'failed to verify volcano session existence:', error);
      return false;
    }
  }

  private async prewarmVolcanoSessionIfPossible(): Promise<string | null> {
    if (this.volcanoStreamSessionId) {
      return null;
    }

    let config: VolcanoRuntimeConfig;
    try {
      config = this.getVolcanoRuntimeConfigOrThrow();
    } catch {
      await this.cancelWarmVolcanoSession();
      return null;
    }

    const warmKey = this.getWarmVolcanoSessionKey(config);
    if (this.warmVolcanoSessionId && this.warmVolcanoSessionKey === warmKey) {
      if (await this.doesVolcanoSessionExist(this.warmVolcanoSessionId)) {
        return this.warmVolcanoSessionId;
      }
      this.clearWarmVolcanoSessionState();
    }
    if (this.warmVolcanoSessionPromise && this.warmVolcanoSessionKey === warmKey) {
      const pendingSessionId = await this.warmVolcanoSessionPromise;
      if (pendingSessionId && await this.doesVolcanoSessionExist(pendingSessionId)) {
        this.warmVolcanoSessionId = pendingSessionId;
        return pendingSessionId;
      }
      this.clearWarmVolcanoSessionState();
    }
    if (this.warmVolcanoSessionId && this.warmVolcanoSessionKey !== warmKey) {
      await this.cancelWarmVolcanoSession();
    }

    this.warmVolcanoSessionKey = warmKey;
    this.warmVolcanoSessionPromise = (async () => {
      try {
        const sessionId = await invoke<string>('volcano_asr_stream_start', { config });
        if (this.warmVolcanoSessionKey !== warmKey) {
          invoke('volcano_asr_stream_cancel', { sessionId }).catch(() => {});
          return null;
        }
        this.warmVolcanoSessionId = sessionId;
        return sessionId;
      } catch (error) {
        console.warn(LOG_TAG, 'volcano session prewarm failed:', error);
        return null;
      } finally {
        this.warmVolcanoSessionPromise = null;
      }
    })();

    return this.warmVolcanoSessionPromise;
  }

  private async acquireVolcanoSession(config: VolcanoRuntimeConfig): Promise<string> {
    const warmKey = this.getWarmVolcanoSessionKey(config);

    if (this.warmVolcanoSessionPromise && this.warmVolcanoSessionKey === warmKey) {
      const pendingSessionId = await this.warmVolcanoSessionPromise;
      if (pendingSessionId && await this.doesVolcanoSessionExist(pendingSessionId)) {
        this.clearWarmVolcanoSessionState();
        return pendingSessionId;
      }
      this.clearWarmVolcanoSessionState();
    }

    if (this.warmVolcanoSessionId && this.warmVolcanoSessionKey === warmKey) {
      const sessionId = this.warmVolcanoSessionId;
      if (await this.doesVolcanoSessionExist(sessionId)) {
        this.clearWarmVolcanoSessionState();
        return sessionId;
      }
      this.clearWarmVolcanoSessionState();
    }

    return invoke<string>('volcano_asr_stream_start', { config });
  }

  private shouldShowArmingState(): boolean {
    if (!this.isLiveStream(this.warmStream)) {
      return true;
    }
    if (this.asrProvider !== 'volcano') {
      return false;
    }

    try {
      const config = this.getVolcanoRuntimeConfigOrThrow();
      const warmKey = this.getWarmVolcanoSessionKey(config);
      return !(this.warmVolcanoSessionId && this.warmVolcanoSessionKey === warmKey);
    } catch {
      return true;
    }
  }

  private async handleStart(): Promise<void> {
    if (this.startPending) {
      return;
    }
    if (this.state === 'recognizing') {
      return;
    }
    if (this.state === 'recording') {
      await this.handleStop();
      return;
    }

    if (this.state === 'done' || this.state === 'error') {
      this.stopLivePreview('abort');
      this.releaseResources();
      this.clearAutoHide();
      this.state = 'idle';
    }

    this.clearAutoHide();
    this.livePreviewText = '';
    this.startPending = true;
    this.beginActivationTracking();
    const needsColdStart = this.shouldShowArmingState();
    this.emitOverlayState('arming', {
      duration: 0,
      text: needsColdStart ? '准备启动语音输入…' : '正在唤起语音输入…',
      hintText: needsColdStart
        ? '正在等待麦克风权限并连接识别链路'
        : '麦克风与语音链路已就绪，正在激活录音',
      isLivePreview: false,
    });

    try {
      if (this.asrProvider === 'volcano') {
        await this.startVolcanoStreaming();
        return;
      }

      this.stream = await this.acquireInputStream();

      const { recorder, mimeType } = createCompatibleMediaRecorder(this.stream);
      this.mediaRecorder = recorder;
      this.mimeType = mimeType;
      this.chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      recorder.start(100);
      this.setState('recording', {
        activationMs: this.completeActivationTracking(),
      });
      this.startLivePreview('zh-CN');
      void this.syncRecordingActive(true);
    } catch (error) {
      this.handleError(`录音失败: ${error}`);
    } finally {
      this.startPending = false;
    }
  }

  private async handleStop(): Promise<void> {
    if (this.state !== 'recording') return;
    if (this.volcanoStreamSessionId && this.volcanoStreamingCapture) {
      await this.handleVolcanoStreamingStop();
      return;
    }

    this.stopLivePreview('stop');
    this.setState('recognizing');
    await this.syncRecordingActive(false);

    const recorder = this.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.mediaRecorder = null;

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.chunks.length === 0) {
      this.handleError('没有录制到音频数据');
      return;
    }

    const blob = new Blob(this.chunks, { type: this.mimeType || 'audio/webm' });
    this.chunks = [];

    try {
      const wavData = await convertWebmBlobToWav(blob, {
        targetSampleRate: 16000,
        gain: 4,
      });
      const recognitionStartedAt = Date.now();
      const result = await this.transcribeWithSelectedProvider(wavData);
      const recognitionMs = Date.now() - recognitionStartedAt;
      const normalizedText = this.normalizeRecognitionText(result?.text);
      if (normalizedText) {
        await this.handleResult({ ...result, text: normalizedText }, recognitionMs, this.getActiveProviderLabel());
      } else {
        this.handleError('未识别到文字');
      }
    } catch (error) {
      this.handleError(`识别失败: ${error}`);
    }
  }

  private async handleCancel(): Promise<void> {
    if (this.state !== 'recording') return;

    if (this.volcanoStreamSessionId) {
      await this.syncRecordingActive(false);
      await this.cancelVolcanoStreaming();
      this.clearAutoHide();
      this.setState('idle');
      invoke('voice_overlay_hide').catch(() => {});
      return;
    }

    await this.syncRecordingActive(false);
    this.stopLivePreview('abort');
    this.livePreviewText = '';
    this.releaseResources();
    this.clearAutoHide();
    this.setState('idle');
    invoke('voice_overlay_hide').catch(() => {});
  }

  private async handleResult(result: ASRResult, recognitionMs: number, providerLabel: string): Promise<void> {
    const [clipboardResult, eventLogResult] = await Promise.allSettled([
      (async () => {
        const writeResult = await getClipboardService().writeText(result.text);
        if (!writeResult.ok) throw new Error(writeResult.title);
        await invoke('simulate_paste');
      })(),
      getEventLogService().addEvent(result.text, new Set(['voice'])),
    ]);

    if (clipboardResult.status === 'rejected') {
      console.error(LOG_TAG, 'clipboard paste failed:', clipboardResult.reason);
    }
    if (eventLogResult.status === 'rejected') {
      console.error(LOG_TAG, 'eventlog write failed:', eventLogResult.reason);
    }

    this.emitOverlayState('done', {
      text: result.text,
      recognitionMs,
      providerLabel,
    });
    this.state = 'done';

    this.autoHideTimer = setTimeout(() => {
      this.setState('idle');
      invoke('voice_overlay_hide').catch(() => {});
    }, AUTO_HIDE_DONE_MS);
  }

  private handleError(message: string): void {
    console.error(LOG_TAG, message);
    this.stopLivePreview('abort');
    this.livePreviewText = '';
    this.releaseResources();
    this.emitOverlayState('error', { errorMessage: message });
    this.state = 'error';

    this.autoHideTimer = setTimeout(() => {
      this.setState('idle');
      invoke('voice_overlay_hide').catch(() => {});
    }, AUTO_HIDE_ERROR_MS);
  }

  private setState(newState: VoiceShortcutState, extra: Partial<OverlayEventPayload> = {}): void {
    this.state = newState;
    if (newState === 'recording') {
      this.emitOverlayState(newState, { duration: 0, ...extra });
      return;
    }
    this.emitOverlayState(newState, extra);
  }

  private emitOverlayState(state: VoiceShortcutState, extra: Partial<OverlayEventPayload> = {}): void {
    emit('voice-overlay-state', this.buildOverlayPayload(state, extra)).catch(() => {});
  }

  private normalizeRecognitionText(text: string | null | undefined): string {
    return text?.trim() ?? '';
  }

  private async transcribeWithSelectedProvider(wavData: Uint8Array): Promise<ASRResult> {
    if (this.asrProvider === 'volcano') {
      const config = this.getVolcanoRuntimeConfigOrThrow();
      const pcmAudio = wavData.slice(44);
      return await invoke<ASRResult>('volcano_asr_recognize', {
        audioData: Array.from(pcmAudio),
        config,
      });
    }

    return await this.adapter.transcribe({
      lang: 'zh-CN',
      preRecordedAudio: wavData,
    });
  }

  private releaseResources(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    if (this.stream) {
      if (this.stream !== this.warmStream) {
        this.stream.getTracks().forEach((track) => track.stop());
      }
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.chunks = [];
  }

  private clearAutoHide(): void {
    if (this.autoHideTimer !== null) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }

  private async syncRecordingActive(active: boolean): Promise<void> {
    try {
      await invoke('voice_recording_set_active', { active });
    } catch (error) {
      console.error(LOG_TAG, `failed to sync recording active=${active}:`, error);
    }
  }

  private async applyShortcut(hotkey: VoiceShortcutHotkey): Promise<void> {
    try {
      const appliedShortcut = await invoke<string>('voice_shortcut_set', { shortcut: hotkey });
      console.log(LOG_TAG, `voice shortcut applied: ${appliedShortcut}`);
    } catch (error) {
      const message = String(error);
      if (message.toLowerCase().includes('already registered')) {
        console.warn(LOG_TAG, `voice shortcut "${hotkey}" already registered, skip re-register`);
        return;
      }
      console.error(LOG_TAG, `failed to apply voice shortcut "${hotkey}":`, error);
    }
  }

  private buildOverlayPayload(state: VoiceShortcutState, extra: Partial<OverlayEventPayload> = {}): OverlayEventPayload {
    const fallbackText = state === 'recording' || state === 'recognizing' ? this.livePreviewText : '';
    return {
      state,
      ...(typeof extra.duration === 'number' ? { duration: extra.duration } : {}),
      text: extra.text ?? fallbackText,
      hintText: extra.hintText,
      isLivePreview: extra.isLivePreview ?? Boolean(fallbackText && state !== 'done'),
      providerLabel: extra.providerLabel ?? this.getActiveProviderLabel(),
      activationMs: extra.activationMs ?? this.latestActivationMs ?? undefined,
      firstTextMs: extra.firstTextMs ?? this.latestFirstTextMs ?? undefined,
      debugTraceId: extra.debugTraceId ?? this.currentTraceId ?? undefined,
      debugPressedAtMs: extra.debugPressedAtMs ?? this.traceStartedAtMs ?? undefined,
      recognitionMs: extra.recognitionMs,
      errorMessage: extra.errorMessage ?? '',
    };
  }

  private startLivePreview(lang: string): void {
    if (this.livePreviewSession || !this.livePreviewSource.isAvailable()) {
      return;
    }

    try {
      const session = this.livePreviewSource.createSession({
        lang,
        onUpdate: ({ text }) => this.handleLivePreviewUpdate(text),
        onError: (error) => console.warn(LOG_TAG, 'live preview unavailable:', error),
      });
      this.livePreviewSession = session;
      session.start();
    } catch (error) {
      console.warn(LOG_TAG, 'failed to start live preview:', error);
      this.livePreviewSession = null;
    }
  }

  private stopLivePreview(mode: 'stop' | 'abort'): void {
    if (!this.livePreviewSession) return;
    const session = this.livePreviewSession;
    this.livePreviewSession = null;
    try {
      if (mode === 'stop') session.stop();
      else session.abort();
    } catch (error) {
      console.warn(LOG_TAG, `failed to ${mode} live preview:`, error);
    }
  }

  private handleLivePreviewUpdate(text: string): void {
    const nextText = text.trim();
    if (!nextText || nextText === this.livePreviewText) {
      return;
    }
    this.livePreviewText = nextText;
    if (this.state !== 'recording' && this.state !== 'recognizing') {
      return;
    }
    const firstTextMs = this.markFirstTextSeen();
    this.emitOverlayState(this.state, {
      text: nextText,
      firstTextMs,
      isLivePreview: true,
    });
  }

  private async startVolcanoStreaming(): Promise<void> {
    const config = this.getVolcanoRuntimeConfigOrThrow();
    const streamPromise = this.acquireInputStream();
    const sessionPromise = this.acquireVolcanoSession(config);

    try {
      const [streamResult, sessionResult] = await Promise.allSettled([streamPromise, sessionPromise]);
      if (streamResult.status !== 'fulfilled' || sessionResult.status !== 'fulfilled') {
        if (streamResult.status === 'fulfilled') {
          streamResult.value.getTracks().forEach((track) => track.stop());
        }
        if (sessionResult.status === 'fulfilled') {
          invoke('volcano_asr_stream_cancel', { sessionId: sessionResult.value }).catch(() => {});
        }
        if (streamResult.status === 'rejected') {
          throw streamResult.reason;
        }
        if (sessionResult.status === 'rejected') {
          throw sessionResult.reason;
        }
        throw new Error('volcano start failed without explicit rejection');
      }

      this.stream = streamResult.value;
      const sessionId = sessionResult.value;
      this.volcanoStreamSessionId = sessionId;
      this.volcanoPushQueue = Promise.resolve();
      this.volcanoStreamingCapture = createVolcanoStreamingCapture({
        stream: this.stream,
        onChunk: async (chunk) => this.enqueueVolcanoStreamingChunk(chunk),
      });
      await this.volcanoStreamingCapture.start();
      this.setState('recording', {
        activationMs: this.completeActivationTracking(),
      });
      void this.syncRecordingActive(true);
    } catch (error) {
      this.cleanupVolcanoStreamingState();
      this.releaseResources();
      throw error;
    }
  }

  private async handleVolcanoStreamingStop(): Promise<void> {
    this.setState('recognizing');
    await this.syncRecordingActive(false);

    const sessionId = this.volcanoStreamSessionId;
    const capture = this.volcanoStreamingCapture;
    if (!sessionId || !capture) {
      this.handleError('火山流式会话不存在');
      return;
    }

    try {
      const trailingChunk = await capture.stop();
      this.volcanoStreamingCapture = null;
      this.releaseResources();
      const recognitionStartedAt = Date.now();
      await this.volcanoPushQueue;
      const result = await invoke<ASRResult>('volcano_asr_stream_finish', {
        sessionId,
        audioData: Array.from(trailingChunk ?? new Uint8Array()),
      });
      const recognitionMs = Date.now() - recognitionStartedAt;
      const normalizedText = this.normalizeRecognitionText(result?.text);
      if (normalizedText) {
        await this.handleResult({ ...result, text: normalizedText }, recognitionMs, this.getActiveProviderLabel());
      } else {
        this.handleError('未识别到文字');
      }
    } catch (error) {
      this.handleError(`识别失败: ${error}`);
    } finally {
      this.cleanupVolcanoStreamingState();
      void this.prewarmVolcanoSessionIfPossible();
    }
  }

  private async cancelVolcanoStreaming(): Promise<void> {
    const sessionId = this.volcanoStreamSessionId;
    try {
      await this.volcanoStreamingCapture?.cancel();
      await this.volcanoPushQueue;
      if (sessionId) {
        await invoke('volcano_asr_stream_cancel', { sessionId });
      }
    } catch (error) {
      console.error(LOG_TAG, 'failed to cancel volcano stream:', error);
    } finally {
      this.cleanupVolcanoStreamingState();
      this.releaseResources();
      void this.prewarmVolcanoSessionIfPossible();
    }
  }

  private async enqueueVolcanoStreamingChunk(chunk: Uint8Array): Promise<void> {
    const sessionId = this.volcanoStreamSessionId;
    if (!sessionId || chunk.length === 0) {
      return;
    }

    this.volcanoPushQueue = this.volcanoPushQueue.then(async () => {
      await invoke('volcano_asr_stream_push', {
        sessionId,
        audioData: Array.from(chunk),
      });
    });
    return this.volcanoPushQueue;
  }

  private handleVolcanoStreamEvent(payload: VolcanoAsrStreamEventPayload): void {
    if (!this.volcanoStreamSessionId || payload.sessionId !== this.volcanoStreamSessionId) {
      return;
    }
    if (payload.errorMessage) {
      this.handleError(payload.errorMessage);
      return;
    }
    const nextText = (payload.text || '').trim();
    if (!nextText) {
      return;
    }
    this.livePreviewText = nextText;
    if (this.state !== 'recording' && this.state !== 'recognizing') {
      return;
    }
    const firstTextMs = this.markFirstTextSeen();
    this.emitOverlayState(this.state, {
      text: nextText,
      firstTextMs,
      isLivePreview: !payload.isFinal,
    });
  }

  private cleanupVolcanoStreamingState(): void {
    this.volcanoStreamingCapture = null;
    this.volcanoStreamSessionId = null;
    this.volcanoPushQueue = Promise.resolve();
  }

  private getVolcanoRuntimeConfigOrThrow(): VolcanoRuntimeConfig {
    const config = getStoredVolcanoRuntimeConfig(import.meta.env as Record<string, string | undefined>);
    if (!config.appKey || !config.accessKey || !config.resourceId) {
      throw new Error('火山配置不完整，请先到火山 ASR 测试页保存 AppKey / AccessKey / Resource ID');
    }
    return config;
  }

  private getActiveProviderLabel(): string {
    if (this.asrProvider !== 'volcano') {
      return 'MOSS · 云端识别';
    }
    const config = getStoredVolcanoRuntimeConfig(import.meta.env as Record<string, string | undefined>);
    const resourceLabel = VOLCANO_RESOURCE_PRESETS.find(
      (item) => item.value === findVolcanoResourcePreset(config.resourceId || DEFAULT_VOLCANO_RESOURCE_ID),
    )?.label ?? '语音识别';
    const endpointLabel = VOLCANO_ENDPOINT_OPTIONS.find(
      (item) => item.value === config.endpoint,
    )?.label ?? config.endpoint;
    return `火山 ${resourceLabel.replace('模型 ', '')} · ${endpointLabel}`;
  }
}

let instance: VoiceShortcutService | null = null;

export function getVoiceShortcutService(): VoiceShortcutService {
  if (!instance) {
    instance = new VoiceShortcutService();
  }
  return instance;
}

export async function initVoiceShortcutService(): Promise<void> {
  await getVoiceShortcutService().init();
}
