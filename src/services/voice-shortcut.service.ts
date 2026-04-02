import { listen, emit } from '@tauri-apps/api/event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { MOSSASRAdapter } from '../lib/adapters/asr/moss-asr';
import { getClipboardService } from '../lib/services/clipboard.service';
import { appendEventWithEcsReplication } from '@/lib/services/ecs-eventlog-replication.service';
import { publishVoiceTranscriptSignal } from '@/lib/services/voice-signal.service';
import { getActiveInteractionContextService } from '@/lib/services/active-interaction-context.service';
import {
  getVoiceShortcutHotkey,
  subscribeVoiceShortcutHotkeyChanges,
  type VoiceShortcutHotkey,
} from '../config/voice-shortcut-hotkey';
import { getVoiceShortcutSendMode } from '@/config/voice-shortcut-send-mode';
import {
  getVoiceShortcutMicPrewarmEnabled,
  subscribeVoiceShortcutMicPrewarmChanges,
} from '@/config/voice-shortcut-mic-prewarm';
import { getVoiceAutoRecordEnabled } from '@/config/voice-auto-record';
import {
  getDeveloperModeEnabled,
  subscribeDeveloperModeChanges,
} from '@/config/developer-mode';
import {
  createCompatibleMediaRecorder,
  getUserMediaWithConstraintFallback,
  DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
} from '../lib/media/microphone-capture';
import { convertWebmBlobToWav } from '../lib/media/wav-audio';
import type { ASRResult } from '../lib/ports/asr-port';
import { log, setConsoleMinLevel } from '@/lib/logger';
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
  setVolcanoResourceId,
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
import { normalizeRecognitionText } from '@/lib/voice/recognition-text';
import {
  getVoiceOverlayBottomOffset,
  subscribeVoiceOverlayBottomOffsetChanges,
} from '@/config/voice-overlay-preferences';
import { buildVoiceShortcutStorageEvent } from '@/services/voice-shortcut-eventlog';
import { recordVolcanoUsageDuration } from '@/config/volcano-usage-stats';

export type VoiceShortcutState = 'idle' | 'arming' | 'recording' | 'recognizing' | 'done' | 'error';

const LOG_TAG = '[VoiceShortcut]';
const AUTO_HIDE_DONE_MS = 2000;
const AUTO_HIDE_ERROR_MS = 3000;
const AUTO_ENTER_SEND_DELAY_MS = 120;
const VOLCANO_WARM_MAINTENANCE_INTERVAL_MS = 3000;
const VOLCANO_WARM_ROTATE_AFTER_MS = 5000;
const VOLCANO_SEED_DURATION_RESOURCE_ID = 'volc.seedasr.sauc.duration';
const VOLCANO_SEED_CONCURRENT_RESOURCE_ID = 'volc.seedasr.sauc.concurrent';
const VOLCANO_BIG_DURATION_RESOURCE_ID = 'volc.bigasr.sauc.duration';
const VOLCANO_BIG_CONCURRENT_RESOURCE_ID = 'volc.bigasr.sauc.concurrent';

type VolcanoSessionWarmReason =
  | 'prewarmed'
  | 'pending-prewarm'
  | 'stale'
  | 'missing'
  | 'config-changed';

type WarmVolcanoSessionSnapshot = {
  sessionId: string | null;
  createdAtMs: number | null;
  warmKey: string | null;
};

type OverlayEventPayload = {
  state: VoiceShortcutState;
  duration?: number;
  text: string;
  audioLevel?: number;
  hintText?: string;
  isLivePreview: boolean;
  providerLabel: string;
  traceStartedAtMs?: number;
  activationMs?: number;
  inputReadyMs?: number;
  sessionReadyMs?: number;
  inputWarmHit?: boolean;
  sessionWarmHit?: boolean;
  sessionWarmReason?: VolcanoSessionWarmReason;
  firstTextMs?: number;
  debugTraceId?: string;
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

type ForegroundWindowContext = {
  title?: string | null;
  processName?: string | null;
  windowHandle?: string | null;
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
  private unlistenDeveloperMode: (() => void) | null = null;
  private unlistenOverlayBottomOffset: (() => void) | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private warmMaintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private warmRotateTimer: ReturnType<typeof setTimeout> | null = null;
  private initializing = false;
  private startPending = false;
  private activationStartedAt: number | null = null;
  private traceStartedAtMs: number | null = null;
  private currentTraceId: string | null = null;
  private latestActivationMs: number | null = null;
  private latestInputReadyMs: number | null = null;
  private latestSessionReadyMs: number | null = null;
  private latestInputWarmHit: boolean | null = null;
  private latestSessionWarmHit: boolean | null = null;
  private latestSessionWarmReason: VolcanoSessionWarmReason | null = null;
  private latestFirstTextMs: number | null = null;
  private latestAudioLevel = 0;
  private developerModeEnabled = getDeveloperModeEnabled();
  private asrProvider: VoiceShortcutAsrProvider = getVoiceShortcutAsrProvider();
  private micPrewarmEnabled = getVoiceShortcutMicPrewarmEnabled();
  private livePreviewSource: VoiceLivePreviewSource;
  private livePreviewSession: VoiceLivePreviewSession | null = null;
  private livePreviewText = '';
  private volcanoStreamingCapture: VolcanoStreamingCapture | null = null;
  private volcanoStreamSessionId: string | null = null;
  private volcanoAcceptingChunks = false;
  private volcanoPushQueue: Promise<void> = Promise.resolve();
  private warmVolcanoSessionId: string | null = null;
  private warmVolcanoSessionCreatedAtMs: number | null = null;
  private warmVolcanoSessionKey: string | null = null;
  private warmVolcanoSessionPromise: Promise<string | null> | null = null;
  private frozenForegroundWindowContext: ForegroundWindowContext | null = null;
  private frozenForegroundWindowContextPromise: Promise<ForegroundWindowContext | null> | null = null;
  private foregroundWindowCaptureToken = 0;
  private destroyed = false;

  constructor(livePreviewSource: VoiceLivePreviewSource = createDefaultVoiceLivePreviewSource()) {
    this.adapter = new MOSSASRAdapter();
    this.livePreviewSource = livePreviewSource;
  }

  private debugInfo(...args: unknown[]): void {
    if (this.developerModeEnabled) {
      log.debug(args.map(String).join(' '));
    }
  }

  private debugWarn(...args: unknown[]): void {
    if (this.developerModeEnabled) {
      log.warn(args.map(String).join(' '));
    }
  }

  private debugError(...args: unknown[]): void {
    if (this.developerModeEnabled) {
      log.error(args.map(String).join(' '));
    }
  }

  private debugLog(...args: unknown[]): void {
    if (this.developerModeEnabled) {
      log.debug(args.map(String).join(' '));
    }
  }

  private syncDeveloperConsoleLevel(): void {
    setConsoleMinLevel(this.developerModeEnabled ? 'DEBUG' : 'INFO');
  }

  async init(): Promise<void> {
    if (this.unlisten || this.initializing) return;
    if (!isTauri()) {
      this.debugWarn(LOG_TAG, 'not in Tauri environment, service disabled');
      return;
    }
    this.destroyed = false;
    this.initializing = true;
    this.syncDeveloperConsoleLevel();

    try {
      await this.applyShortcut(getVoiceShortcutHotkey());

      this.unlistenHotkey = subscribeVoiceShortcutHotkeyChanges((hotkey) => {
        this.applyShortcut(hotkey).catch((error) => {
          this.debugError(LOG_TAG, 'failed to apply updated voice shortcut:', error);
        });
      });

      this.unlistenProvider = subscribeVoiceShortcutAsrProviderChanges((provider) => {
        this.asrProvider = provider;
        this.syncWarmMaintenanceLoop();
        void this.prewarmResourcesForProvider();
      });

      this.unlistenMicPrewarm = subscribeVoiceShortcutMicPrewarmChanges((enabled) => {
        this.micPrewarmEnabled = enabled;
        this.syncWarmMaintenanceLoop();
        void this.prewarmResourcesForProvider();
      });

      this.unlistenDeveloperMode = subscribeDeveloperModeChanges((enabled) => {
        this.developerModeEnabled = enabled;
        this.syncDeveloperConsoleLevel();
      });

      this.unlistenOverlayBottomOffset = subscribeVoiceOverlayBottomOffsetChanges((offset) => {
        void this.syncVoiceOverlayBottomOffset(offset);
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

      await this.syncVoiceOverlayBottomOffset(getVoiceOverlayBottomOffset());
      this.syncWarmMaintenanceLoop();
      void this.prewarmResourcesForProvider();
    } finally {
      this.initializing = false;
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
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
    this.unlistenDeveloperMode?.();
    this.unlistenDeveloperMode = null;
    this.unlistenOverlayBottomOffset?.();
    this.unlistenOverlayBottomOffset = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.handleAppForeground);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.clearWarmMaintenanceLoop();
    this.clearWarmRotateTimer();
    void this.syncRecordingActive(false);
    this.stopLivePreview('abort');
    void this.cancelWarmVolcanoSession();
    this.releaseWarmStream();
    this.releaseResources();
    this.clearFrozenForegroundWindowContext();
    this.clearAutoHide();
    setConsoleMinLevel('INFO');
  }

  getState(): VoiceShortcutState {
    return this.state;
  }

  private readonly handleAppForeground = (): void => {
    if (this.destroyed) {
      return;
    }
    if (this.startPending || this.state === 'recording' || this.state === 'recognizing') {
      return;
    }
    void this.prewarmResourcesForProvider();
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.destroyed) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    this.handleAppForeground();
  };

  private async syncVoiceOverlayBottomOffset(offset: number): Promise<void> {
    if (!isTauri()) {
      return;
    }

    try {
      await invoke('voice_overlay_set_bottom_offset', { offset });
    } catch (error) {
      this.debugWarn(LOG_TAG, 'failed to sync voice overlay bottom offset:', error);
    }
  }

  private async waitForAutoEnterSend(): Promise<void> {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, AUTO_ENTER_SEND_DELAY_MS);
    });
  }

  private async restoreForegroundWindowFocus(windowHandle?: string | null): Promise<void> {
    const normalizedHandle = windowHandle?.trim();
    if (!normalizedHandle) {
      return;
    }

    try {
      await invoke('foreground_window_focus', { windowHandle: normalizedHandle });
    } catch (error) {
      this.debugWarn(LOG_TAG, 'failed to restore foreground window focus:', error);
    }
  }

  private beginActivationTracking(): void {
    const now = Date.now();
    this.activationStartedAt = now;
    this.traceStartedAtMs = now;
    this.currentTraceId = `voice-${now}`;
    this.latestActivationMs = null;
    this.latestInputReadyMs = null;
    this.latestSessionReadyMs = null;
    this.latestInputWarmHit = null;
    this.latestSessionWarmHit = null;
    this.latestSessionWarmReason = null;
    this.latestFirstTextMs = null;
    this.debugInfo(LOG_TAG, `[trace ${this.currentTraceId}] shortcut pressed at ${now}`);
  }

  private completeActivationTracking(): number | undefined {
    if (this.activationStartedAt == null) {
      return this.latestActivationMs ?? undefined;
    }

    const activationMs = Math.max(0, Date.now() - this.activationStartedAt);
    this.activationStartedAt = null;
    this.latestActivationMs = activationMs;
    if (this.currentTraceId) {
      this.debugInfo(LOG_TAG, `[trace ${this.currentTraceId}] entered recording in ${activationMs}ms`);
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
      this.debugInfo(LOG_TAG, `[trace ${this.currentTraceId}] first text in ${firstTextMs}ms`);
    }
    return firstTextMs;
  }

  private markInputReady(warmHit: boolean): number | undefined {
    if (this.traceStartedAtMs == null) {
      return this.latestInputReadyMs ?? undefined;
    }

    const inputReadyMs = Math.max(0, Date.now() - this.traceStartedAtMs);
    this.latestInputReadyMs = inputReadyMs;
    this.latestInputWarmHit = warmHit;
    if (this.currentTraceId) {
      this.debugInfo(
        LOG_TAG,
        `[trace ${this.currentTraceId}] input ready in ${inputReadyMs}ms (warm=${warmHit ? 'hit' : 'miss'})`,
      );
    }
    return inputReadyMs;
  }

  private markSessionReady(
    warmHit: boolean,
    warmReason: VolcanoSessionWarmReason,
  ): number | undefined {
    if (this.traceStartedAtMs == null) {
      return this.latestSessionReadyMs ?? undefined;
    }

    const sessionReadyMs = Math.max(0, Date.now() - this.traceStartedAtMs);
    this.latestSessionReadyMs = sessionReadyMs;
    this.latestSessionWarmHit = warmHit;
    this.latestSessionWarmReason = warmReason;
    if (this.currentTraceId) {
      this.debugInfo(
        LOG_TAG,
        `[trace ${this.currentTraceId}] session ready in ${sessionReadyMs}ms (warm=${warmHit ? 'hit' : 'miss'}, reason=${warmReason})`,
      );
    }
    return sessionReadyMs;
  }

  private clearWarmMaintenanceLoop(): void {
    if (this.warmMaintenanceTimer !== null) {
      clearInterval(this.warmMaintenanceTimer);
      this.warmMaintenanceTimer = null;
    }
  }

  private clearWarmRotateTimer(): void {
    if (this.warmRotateTimer !== null) {
      clearTimeout(this.warmRotateTimer);
      this.warmRotateTimer = null;
    }
  }

  private scheduleWarmRotateTimer(sessionId: string, createdAtMs: number): void {
    this.clearWarmRotateTimer();
    this.warmRotateTimer = setTimeout(() => {
      void (async () => {
        if (this.destroyed || this.warmVolcanoSessionId !== sessionId || this.startPending) {
          return;
        }
        const warmAgeMs = Math.max(0, Date.now() - createdAtMs);
        this.debugInfo(
          LOG_TAG,
          `[warm] standby exceeded short hot window (${warmAgeMs}ms), rotating in background`,
        );
        await this.cancelWarmVolcanoSession('idle-window-rotation');
        await this.prewarmVolcanoSessionIfPossible();
      })();
    }, VOLCANO_WARM_ROTATE_AFTER_MS);
  }

  private syncWarmMaintenanceLoop(): void {
    this.clearWarmMaintenanceLoop();
    if (!this.micPrewarmEnabled || this.asrProvider !== 'volcano') {
      return;
    }

    this.warmMaintenanceTimer = setInterval(() => {
      void (async () => {
        if (this.destroyed || this.startPending || this.state === 'recording' || this.state === 'recognizing') {
          return;
        }
        await this.prewarmVolcanoSessionIfPossible();
      })();
    }, VOLCANO_WARM_MAINTENANCE_INTERVAL_MS);
  }

  private isLiveStream(stream: MediaStream | null): stream is MediaStream {
    if (!stream) return false;
    const tracks = stream.getTracks();
    return tracks.length > 0 && tracks.every((track) => track.readyState === 'live');
  }

  private async prewarmResourcesForProvider(): Promise<void> {
    if (this.destroyed) {
      return;
    }
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
        if (this.destroyed) {
          stream.getTracks().forEach((track) => track.stop());
          return null;
        }
        this.warmStream = stream;
        return stream;
      } catch (error) {
        this.debugWarn(LOG_TAG, 'microphone prewarm skipped:', error);
        return null;
      } finally {
        this.warmStreamPromise = null;
      }
    })();

    return this.warmStreamPromise;
  }

  private async acquireInputStream(): Promise<{ stream: MediaStream; warmHit: boolean }> {
    if (this.isLiveStream(this.warmStream)) {
      return { stream: this.warmStream, warmHit: true };
    }

    const pendingWarmStream = await this.warmStreamPromise;
    if (this.isLiveStream(pendingWarmStream)) {
      this.warmStream = pendingWarmStream;
      return { stream: pendingWarmStream, warmHit: true };
    }

    const stream = await getUserMediaWithConstraintFallback(
      (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      { audio: DEFAULT_RECORDING_AUDIO_CONSTRAINTS },
    );
    this.warmStream = stream;
    return { stream, warmHit: false };
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

  private async cancelWarmVolcanoSession(reason = 'cancelled'): Promise<void> {
    const snapshot = this.clearWarmVolcanoSessionState();
    const sessionId = snapshot.sessionId;

    if (!sessionId) {
      return;
    }

    try {
      this.logWarmSessionClosed(snapshot, reason);
      await invoke('volcano_asr_stream_cancel', { sessionId });
    } catch (error) {
      this.debugWarn(LOG_TAG, 'failed to cancel warm volcano session:', error);
    }
  }

  private clearWarmVolcanoSessionState(): WarmVolcanoSessionSnapshot {
    const snapshot = {
      sessionId: this.warmVolcanoSessionId,
      createdAtMs: this.warmVolcanoSessionCreatedAtMs,
      warmKey: this.warmVolcanoSessionKey,
    };
    this.clearWarmRotateTimer();
    this.warmVolcanoSessionId = null;
    this.warmVolcanoSessionCreatedAtMs = null;
    this.warmVolcanoSessionKey = null;
    this.warmVolcanoSessionPromise = null;
    return snapshot;
  }

  private logWarmSessionPrepared(sessionId: string, createdAtMs: number): void {
    this.debugInfo(LOG_TAG, `[warm] standby prepared session=${sessionId} createdAt=${createdAtMs}`);
  }

  private logWarmSessionConsumed(snapshot: WarmVolcanoSessionSnapshot, consumedAtMs = Date.now()): void {
    if (!snapshot.sessionId) {
      return;
    }

    const lifetimeMs = typeof snapshot.createdAtMs === 'number'
      ? Math.max(0, consumedAtMs - snapshot.createdAtMs)
      : null;
    this.debugInfo(
      LOG_TAG,
      `[warm] standby consumed session=${snapshot.sessionId}`
      + ` createdAt=${snapshot.createdAtMs ?? 'unknown'}`
      + ` consumedAt=${consumedAtMs}`
      + ` lifetimeMs=${lifetimeMs ?? 'unknown'}`,
    );
  }

  private logWarmSessionClosed(
    snapshot: WarmVolcanoSessionSnapshot,
    reason: string,
    closedAtMs = Date.now(),
  ): void {
    if (!snapshot.sessionId) {
      return;
    }

    const lifetimeMs = typeof snapshot.createdAtMs === 'number'
      ? Math.max(0, closedAtMs - snapshot.createdAtMs)
      : null;
    this.debugInfo(
      LOG_TAG,
      `[warm] standby closed session=${snapshot.sessionId}`
      + ` createdAt=${snapshot.createdAtMs ?? 'unknown'}`
      + ` closedAt=${closedAtMs}`
      + ` lifetimeMs=${lifetimeMs ?? 'unknown'}`
      + ` reason=${reason}`,
    );
  }

  private async doesVolcanoSessionExist(sessionId: string): Promise<boolean> {
    try {
      return await invoke<boolean>('volcano_asr_stream_session_exists', { sessionId });
    } catch (error) {
      this.debugWarn(LOG_TAG, 'failed to verify volcano session existence:', error);
      return false;
    }
  }

  private async prewarmVolcanoSessionIfPossible(): Promise<string | null> {
    if (this.destroyed) {
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
      this.debugInfo(LOG_TAG, '[warm] stale volcano session expired, rebuilding in background');
      this.logWarmSessionClosed(this.clearWarmVolcanoSessionState(), 'stale-verification-miss');
    }
    if (this.warmVolcanoSessionPromise && this.warmVolcanoSessionKey === warmKey) {
      const pendingSessionId = await this.warmVolcanoSessionPromise;
      if (pendingSessionId && await this.doesVolcanoSessionExist(pendingSessionId)) {
        this.warmVolcanoSessionId = pendingSessionId;
        return pendingSessionId;
      }
      this.debugInfo(LOG_TAG, '[warm] pending volcano prewarm became stale, rebuilding in background');
      this.logWarmSessionClosed(this.clearWarmVolcanoSessionState(), 'pending-prewarm-stale');
    }
    if (this.warmVolcanoSessionId && this.warmVolcanoSessionKey !== warmKey) {
      this.debugInfo(LOG_TAG, '[warm] volcano config changed, replacing warm session');
      await this.cancelWarmVolcanoSession();
    }

    this.warmVolcanoSessionKey = warmKey;
    this.warmVolcanoSessionPromise = (async () => {
      try {
        const sessionId = await invoke<string>('volcano_asr_stream_start', { config });
        if (this.destroyed || this.warmVolcanoSessionKey !== warmKey) {
          invoke('volcano_asr_stream_cancel', { sessionId }).catch(() => {});
          return null;
        }
        const createdAtMs = Date.now();
        this.warmVolcanoSessionId = sessionId;
        this.warmVolcanoSessionCreatedAtMs = createdAtMs;
        this.debugInfo(LOG_TAG, '[warm] volcano session prepared in background');
        this.logWarmSessionPrepared(sessionId, createdAtMs);
        this.scheduleWarmRotateTimer(sessionId, createdAtMs);
        return sessionId;
      } catch (error) {
        this.debugWarn(LOG_TAG, 'volcano session prewarm failed:', error);
        return null;
      } finally {
        this.warmVolcanoSessionPromise = null;
      }
    })();

    return this.warmVolcanoSessionPromise;
  }

  private async acquireVolcanoSession(config: VolcanoRuntimeConfig): Promise<{
    sessionId: string;
    warmHit: boolean;
    warmReason: VolcanoSessionWarmReason;
  }> {
    const warmKey = this.getWarmVolcanoSessionKey(config);
    let warmReason: VolcanoSessionWarmReason = 'missing';

    if (this.warmVolcanoSessionPromise && this.warmVolcanoSessionKey === warmKey) {
      const pendingSessionId = await this.warmVolcanoSessionPromise;
      if (pendingSessionId && await this.doesVolcanoSessionExist(pendingSessionId)) {
        const snapshot = this.clearWarmVolcanoSessionState();
        this.logWarmSessionConsumed(snapshot);
        return { sessionId: pendingSessionId, warmHit: true, warmReason: 'pending-prewarm' };
      }
      warmReason = 'stale';
      this.logWarmSessionClosed(this.clearWarmVolcanoSessionState(), 'pending-prewarm-stale');
    }

    if (this.warmVolcanoSessionId && this.warmVolcanoSessionKey === warmKey) {
      const sessionId = this.warmVolcanoSessionId;
      if (await this.doesVolcanoSessionExist(sessionId)) {
        const snapshot = this.clearWarmVolcanoSessionState();
        this.logWarmSessionConsumed(snapshot);
        return { sessionId, warmHit: true, warmReason: 'prewarmed' };
      }
      warmReason = 'stale';
      this.logWarmSessionClosed(this.clearWarmVolcanoSessionState(), 'stale-verification-miss');
    }

    if (
      (this.warmVolcanoSessionId || this.warmVolcanoSessionPromise)
      && this.warmVolcanoSessionKey
      && this.warmVolcanoSessionKey !== warmKey
    ) {
      warmReason = 'config-changed';
    }

    this.debugInfo(LOG_TAG, `[warm] acquiring cold volcano session (reason=${warmReason})`);

    return {
      sessionId: await invoke<string>('volcano_asr_stream_start', { config }),
      warmHit: false,
      warmReason,
    };
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
    this.captureForegroundWindowContext();
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

      const { stream, warmHit } = await this.acquireInputStream();
      this.stream = stream;
      const inputReadyMs = this.markInputReady(warmHit);

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
        inputReadyMs,
        inputWarmHit: warmHit,
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
      const normalizedText = this.normalizeText(result?.text);
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
      this.clearFrozenForegroundWindowContext();
      invoke('voice_overlay_hide').catch(() => {});
      return;
    }

    await this.syncRecordingActive(false);
    this.stopLivePreview('abort');
    this.livePreviewText = '';
    this.releaseResources();
    this.clearAutoHide();
    this.setState('idle');
    this.clearFrozenForegroundWindowContext();
    invoke('voice_overlay_hide').catch(() => {});
  }

  private async handleResult(result: ASRResult, recognitionMs: number, providerLabel: string): Promise<void> {
    this.latestAudioLevel = 0;
    if (this.asrProvider === 'volcano' && typeof result.duration === 'number' && result.duration > 0) {
      recordVolcanoUsageDuration(result.duration);
    }
    const activeInteractionContext = getActiveInteractionContextService().getContext();
    const foregroundWindow = this.frozenForegroundWindowContext
      ?? await this.frozenForegroundWindowContextPromise
      ?? null;
    const traceId = this.currentTraceId ?? undefined;
    const targetScope = activeInteractionContext?.targetScope ?? (foregroundWindow ? 'external-window' : 'unknown');
    const shouldAutoRecord = getVoiceAutoRecordEnabled();
    const [clipboardResult, signalPublishResult] = await Promise.allSettled([
      (async () => {
        const writeResult = await getClipboardService().writeText(result.text);
        if (!writeResult.ok) throw new Error(writeResult.title);
        await this.restoreForegroundWindowFocus(foregroundWindow?.windowHandle);
        await invoke('simulate_paste');
        if (getVoiceShortcutSendMode() === 'auto-enter-send') {
          await this.waitForAutoEnterSend();
          await invoke('simulate_enter');
        }
      })(),
      publishVoiceTranscriptSignal(result, {
        source: 'tauri:voice-shortcut',
        captureSource: 'global-shortcut',
        traceId,
        targetScope,
        window: foregroundWindow ? {
          title: foregroundWindow.title ?? undefined,
          processName: foregroundWindow.processName ?? undefined,
        } : undefined,
        agentContext: activeInteractionContext?.agentContext,
      }),
    ]);

    if (clipboardResult.status === 'rejected') {
      this.debugError(LOG_TAG, 'clipboard paste failed:', clipboardResult.reason);
    }

    if (signalPublishResult.status === 'rejected') {
      this.debugError(LOG_TAG, 'voice signal publish failed (RT may be unavailable):', signalPublishResult.reason);
      if (shouldAutoRecord) {
        try {
          const storageEvent = await buildVoiceShortcutStorageEvent({
            text: result.text,
            startedAtMs: this.traceStartedAtMs ?? Date.now(),
            targetScope,
            window: foregroundWindow ? {
              title: foregroundWindow.title ?? undefined,
              processName: foregroundWindow.processName ?? undefined,
            } : undefined,
            agentContext: activeInteractionContext?.agentContext,
          });
          await appendEventWithEcsReplication(storageEvent);
        } catch (eventlogError) {
          this.debugError(LOG_TAG, 'eventlog fallback append failed:', eventlogError);
        }
      }
    }

    this.emitOverlayState('done', {
      text: result.text,
      recognitionMs,
      providerLabel,
    });
    this.state = 'done';

    this.autoHideTimer = setTimeout(() => {
      this.setState('idle');
      this.clearFrozenForegroundWindowContext();
      invoke('voice_overlay_hide').catch(() => {});
    }, AUTO_HIDE_DONE_MS);
  }

  private async getForegroundWindowContext(): Promise<ForegroundWindowContext | null> {
    try {
      return await invoke<ForegroundWindowContext>('foreground_window_get');
    } catch (error) {
      this.debugWarn(LOG_TAG, 'failed to read foreground window context:', error);
      return null;
    }
  }

  private captureForegroundWindowContext(): void {
    const captureToken = this.foregroundWindowCaptureToken + 1;
    this.foregroundWindowCaptureToken = captureToken;
    this.frozenForegroundWindowContext = null;
    this.frozenForegroundWindowContextPromise = this.getForegroundWindowContext()
      .then((context) => {
        if (this.foregroundWindowCaptureToken !== captureToken) {
          return null;
        }
        this.frozenForegroundWindowContext = context;
        return context;
      })
      .catch(() => null);
  }

  private clearFrozenForegroundWindowContext(): void {
    this.foregroundWindowCaptureToken += 1;
    this.frozenForegroundWindowContext = null;
    this.frozenForegroundWindowContextPromise = null;
  }

  private handleError(message: string): void {
    this.latestAudioLevel = 0;
    this.debugError(LOG_TAG, message);
    this.stopLivePreview('abort');
    this.livePreviewText = '';
    this.releaseResources();
    this.emitOverlayState('error', { errorMessage: message });
    this.state = 'error';
    this.clearFrozenForegroundWindowContext();

    this.autoHideTimer = setTimeout(() => {
      this.setState('idle');
      invoke('voice_overlay_hide').catch(() => {});
    }, AUTO_HIDE_ERROR_MS);
  }

  private setState(newState: VoiceShortcutState, extra: Partial<OverlayEventPayload> = {}): void {
    this.state = newState;
    if (newState !== 'recording') {
      this.latestAudioLevel = 0;
    }
    if (newState === 'recording') {
      this.emitOverlayState(newState, { duration: 0, ...extra });
      return;
    }
    this.emitOverlayState(newState, extra);
  }

  private emitOverlayState(state: VoiceShortcutState, extra: Partial<OverlayEventPayload> = {}): void {
    emit('voice-overlay-state', this.buildOverlayPayload(state, extra)).catch(() => {});
  }

  private normalizeText(text: string | null | undefined): string {
    return normalizeRecognitionText(text?.trim() ?? '');
  }

  private stringifyVolcanoError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error ?? '');
  }

  private getVolcanoResourceLabel(resourceId: string): string {
    const label = VOLCANO_RESOURCE_PRESETS.find((item) => item.value === resourceId)?.label ?? resourceId;
    return label.replace('模型 ', '');
  }

  private resolveVolcanoQuotaFallback(
    error: unknown,
    config: VolcanoRuntimeConfig,
  ): { config?: VolcanoRuntimeConfig; message: string; switched: boolean } | null {
    const normalizedError = this.stringifyVolcanoError(error).toLowerCase();
    const isQuotaExceeded = normalizedError.includes('45000292') || normalizedError.includes('450000292');
    if (!isQuotaExceeded) {
      return null;
    }

    let fallbackResourceId: string | null = null;
    if (normalizedError.includes('audio_duration_lifetime')) {
      fallbackResourceId = config.resourceId === VOLCANO_BIG_DURATION_RESOURCE_ID
        ? VOLCANO_SEED_DURATION_RESOURCE_ID
        : null;
    } else if (normalizedError.includes('audio_concurrent_lifetime')) {
      fallbackResourceId = config.resourceId === VOLCANO_BIG_CONCURRENT_RESOURCE_ID
        ? VOLCANO_SEED_CONCURRENT_RESOURCE_ID
        : null;
    } else if (config.resourceId === VOLCANO_BIG_DURATION_RESOURCE_ID) {
      fallbackResourceId = VOLCANO_SEED_DURATION_RESOURCE_ID;
    } else if (config.resourceId === VOLCANO_BIG_CONCURRENT_RESOURCE_ID) {
      fallbackResourceId = VOLCANO_SEED_CONCURRENT_RESOURCE_ID;
    }

    if (!fallbackResourceId || fallbackResourceId === config.resourceId) {
      const currentLabel = this.getVolcanoResourceLabel(config.resourceId);
      return {
        switched: false,
        message: `火山 ${currentLabel} 额度报错，当前保持 ${currentLabel}，不会再自动回退到 1.0，请检查控制台配额或资源绑定后重试。`,
      };
    }

    const persistedResourceId = setVolcanoResourceId(fallbackResourceId);
    const fallbackConfig: VolcanoRuntimeConfig = {
      ...config,
      resourceId: persistedResourceId,
    };

    const fromLabel = this.getVolcanoResourceLabel(config.resourceId);
    const toLabel = this.getVolcanoResourceLabel(persistedResourceId);
    this.debugWarn(
      LOG_TAG,
      `volcano quota exceeded, fallback resource: ${config.resourceId} -> ${persistedResourceId}`,
    );

    return {
      switched: true,
      config: fallbackConfig,
      message: `火山 ${fromLabel} 额度已用尽，已自动切换到 ${toLabel}，请再试一次。`,
    };
  }

  private async transcribeWithSelectedProvider(wavData: Uint8Array): Promise<ASRResult> {
    if (this.asrProvider === 'volcano') {
      const config = this.getVolcanoRuntimeConfigOrThrow();
      const pcmAudio = wavData.slice(44);
      try {
        return await invoke<ASRResult>('volcano_asr_recognize', {
          audioData: Array.from(pcmAudio),
          config,
        });
      } catch (error) {
        const fallback = this.resolveVolcanoQuotaFallback(error, config);
        if (!fallback) {
          throw error;
        }
        if (!fallback.switched || !fallback.config) {
          throw new Error(fallback.message);
        }
        return await invoke<ASRResult>('volcano_asr_recognize', {
          audioData: Array.from(pcmAudio),
          config: fallback.config,
        });
      }
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
      this.debugError(LOG_TAG, `failed to sync recording active=${active}:`, error);
    }
  }

  private async applyShortcut(hotkey: VoiceShortcutHotkey): Promise<void> {
    try {
      const appliedShortcut = await invoke<string>('voice_shortcut_set', { shortcut: hotkey });
      this.debugLog(LOG_TAG, `voice shortcut applied: ${appliedShortcut}`);
    } catch (error) {
      const message = String(error);
      if (message.toLowerCase().includes('already registered')) {
        this.debugWarn(LOG_TAG, `voice shortcut "${hotkey}" already registered, skip re-register`);
        return;
      }
      this.debugError(LOG_TAG, `failed to apply voice shortcut "${hotkey}":`, error);
    }
  }

  private buildOverlayPayload(state: VoiceShortcutState, extra: Partial<OverlayEventPayload> = {}): OverlayEventPayload {
    const fallbackText = state === 'recording' || state === 'recognizing' ? this.livePreviewText : '';
    return {
      state,
      ...(typeof extra.duration === 'number' ? { duration: extra.duration } : {}),
      text: extra.text ?? fallbackText,
      audioLevel: extra.audioLevel ?? (state === 'recording' ? this.latestAudioLevel : 0),
      hintText: extra.hintText,
      isLivePreview: extra.isLivePreview ?? Boolean(fallbackText && state !== 'done'),
      providerLabel: extra.providerLabel ?? this.getActiveProviderLabel(),
      traceStartedAtMs: extra.traceStartedAtMs ?? this.traceStartedAtMs ?? undefined,
      activationMs: extra.activationMs ?? this.latestActivationMs ?? undefined,
      inputReadyMs: extra.inputReadyMs ?? this.latestInputReadyMs ?? undefined,
      sessionReadyMs: extra.sessionReadyMs ?? this.latestSessionReadyMs ?? undefined,
      inputWarmHit: extra.inputWarmHit ?? this.latestInputWarmHit ?? undefined,
      sessionWarmHit: extra.sessionWarmHit ?? this.latestSessionWarmHit ?? undefined,
      sessionWarmReason: extra.sessionWarmReason ?? this.latestSessionWarmReason ?? undefined,
      firstTextMs: extra.firstTextMs ?? this.latestFirstTextMs ?? undefined,
      debugTraceId: extra.debugTraceId ?? this.currentTraceId ?? undefined,
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
        onError: (error) => this.debugWarn(LOG_TAG, 'live preview unavailable:', error),
      });
      this.livePreviewSession = session;
      session.start();
    } catch (error) {
      this.debugWarn(LOG_TAG, 'failed to start live preview:', error);
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
      this.debugWarn(LOG_TAG, `failed to ${mode} live preview:`, error);
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

  private updateAudioLevel(level: number): void {
    const normalizedLevel = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    if (Math.abs(normalizedLevel - this.latestAudioLevel) < 0.03) {
      return;
    }
    this.latestAudioLevel = normalizedLevel;
    if (this.state !== 'recording') {
      return;
    }
    this.emitOverlayState('recording', { audioLevel: normalizedLevel });
  }

  private async startVolcanoStreaming(): Promise<void> {
    const config = this.getVolcanoRuntimeConfigOrThrow();
    const streamPromise = this.acquireInputStream().then((result) => ({
      ...result,
      inputReadyMs: this.markInputReady(result.warmHit),
    }));
    const sessionPromise = this.acquireVolcanoSession(config).then((result) => ({
      ...result,
      sessionReadyMs: this.markSessionReady(result.warmHit, result.warmReason),
    }));

    try {
      const [streamResult, sessionResult] = await Promise.allSettled([streamPromise, sessionPromise]);
      if (streamResult.status !== 'fulfilled' || sessionResult.status !== 'fulfilled') {
        if (streamResult.status === 'fulfilled') {
          streamResult.value.stream.getTracks().forEach((track) => track.stop());
        }
        if (sessionResult.status === 'fulfilled') {
          invoke('volcano_asr_stream_cancel', { sessionId: sessionResult.value.sessionId }).catch(() => {});
        }
        if (streamResult.status === 'rejected') {
          throw streamResult.reason;
        }
        if (sessionResult.status === 'rejected') {
          throw sessionResult.reason;
        }
        throw new Error('volcano start failed without explicit rejection');
      }

      this.stream = streamResult.value.stream;
      const inputReadyMs = streamResult.value.inputReadyMs;
      const sessionReadyMs = sessionResult.value.sessionReadyMs;
      const sessionId = sessionResult.value.sessionId;
      this.volcanoStreamSessionId = sessionId;
      this.volcanoAcceptingChunks = true;
      this.volcanoPushQueue = Promise.resolve();
      this.volcanoStreamingCapture = createVolcanoStreamingCapture({
        stream: this.stream,
        onChunk: async (chunk) => this.enqueueVolcanoStreamingChunk(chunk),
        onLevel: (level) => this.updateAudioLevel(level),
      });
      await this.volcanoStreamingCapture.start();
      this.setState('recording', {
        inputReadyMs,
        sessionReadyMs,
        inputWarmHit: streamResult.value.warmHit,
        sessionWarmHit: sessionResult.value.warmHit,
        sessionWarmReason: sessionResult.value.warmReason,
        activationMs: this.completeActivationTracking(),
      });
      if (this.micPrewarmEnabled && !this.destroyed) {
        void this.prewarmVolcanoSessionIfPossible();
      }
      void this.syncRecordingActive(true);
    } catch (error) {
      this.cleanupVolcanoStreamingState();
      this.releaseResources();
      throw error;
    }
  }

  private async handleVolcanoStreamingStop(): Promise<void> {
    this.setState('recognizing');
    this.latestAudioLevel = 0;
    await this.syncRecordingActive(false);

    const sessionId = this.volcanoStreamSessionId;
    const capture = this.volcanoStreamingCapture;
    if (!sessionId || !capture) {
      this.handleError('火山流式会话不存在');
      return;
    }

    try {
      this.volcanoAcceptingChunks = false;
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
      const normalizedText = this.normalizeText(result?.text);
      if (normalizedText) {
        await this.handleResult({ ...result, text: normalizedText }, recognitionMs, this.getActiveProviderLabel());
      } else {
        this.handleError('未识别到文字');
      }
    } catch (error) {
      this.handleError(`识别失败: ${error}`);
    } finally {
      this.cleanupVolcanoStreamingState();
      if (!this.destroyed) {
        void this.prewarmVolcanoSessionIfPossible();
      }
    }
  }

  private async cancelVolcanoStreaming(): Promise<void> {
    const sessionId = this.volcanoStreamSessionId;
    try {
      this.volcanoAcceptingChunks = false;
      this.latestAudioLevel = 0;
      await this.volcanoStreamingCapture?.cancel();
      await this.volcanoPushQueue;
      if (sessionId) {
        await invoke('volcano_asr_stream_cancel', { sessionId });
      }
    } catch (error) {
      this.debugError(LOG_TAG, 'failed to cancel volcano stream:', error);
    } finally {
      this.cleanupVolcanoStreamingState();
      this.releaseResources();
      if (!this.destroyed) {
        void this.prewarmVolcanoSessionIfPossible();
      }
    }
  }

  private async enqueueVolcanoStreamingChunk(chunk: Uint8Array): Promise<void> {
    const sessionId = this.volcanoStreamSessionId;
    if (!sessionId || !this.volcanoAcceptingChunks || chunk.length === 0) {
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
    const isActiveSession = Boolean(this.volcanoStreamSessionId && payload.sessionId === this.volcanoStreamSessionId);
    const isWarmSession = Boolean(this.warmVolcanoSessionId && payload.sessionId === this.warmVolcanoSessionId);

    if (!isActiveSession && !isWarmSession) {
      return;
    }

    if (isWarmSession) {
      if (payload.errorMessage) {
        this.debugInfo(LOG_TAG, `[warm] standby volcano session closed, replenishing: ${payload.errorMessage}`);
        this.logWarmSessionClosed(this.clearWarmVolcanoSessionState(), payload.errorMessage);
        if (this.micPrewarmEnabled && this.asrProvider === 'volcano' && !this.startPending && !this.destroyed) {
          void this.prewarmVolcanoSessionIfPossible();
        }
      }
      return;
    }

    if (payload.errorMessage) {
      const config = this.getVolcanoRuntimeConfigOrThrow();
      const fallback = this.resolveVolcanoQuotaFallback(payload.errorMessage, config);
      this.cleanupVolcanoStreamingState();
      void this.syncRecordingActive(false);
      this.handleError(fallback?.message ?? payload.errorMessage);
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
    this.volcanoAcceptingChunks = false;
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
