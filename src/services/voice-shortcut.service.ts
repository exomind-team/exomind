/**
 * VoiceShortcutService - 全局语音快捷键服务
 *
 * T3: 监听 Tauri event → 录音 → ASR → 双路输出
 *
 * 流程:
 *   Alt+Q pressed(first)  → Rust emits "voice-shortcut" "start" → startRecording
 *   Alt+Q pressed(second) → Rust emits "voice-shortcut" "start" → stopRecording → ASR
 *   （保留兼容）Alt+Q released(old flow) → Rust may emit "voice-shortcut" "stop"
 *     → Path A: clipboard.writeText + simulate_paste (光标位置输出)
 *     → Path B: EventLog.addEvent (voice 标签)
 *
 * 同时通过 Tauri event "voice-overlay-state" 驱动悬浮窗状态。
 */

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
  createCompatibleMediaRecorder,
  getUserMediaWithConstraintFallback,
  DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
} from '../lib/media/microphone-capture';
import { convertWebmBlobToWav } from '../lib/media/wav-audio';
import type { ASRResult } from '../lib/ports/asr-port';
import {
  getVoiceShortcutAsrProvider,
  getVoiceShortcutAsrProviderLabel,
  subscribeVoiceShortcutAsrProviderChanges,
  type VoiceShortcutAsrProvider,
} from '@/config/voice-shortcut-asr-provider';
import { getStoredVolcanoRuntimeConfig } from '@/lib/asr/volcano-config';

export type VoiceShortcutState = 'idle' | 'recording' | 'recognizing' | 'done' | 'error';

const LOG_TAG = '[VoiceShortcut]';
const AUTO_HIDE_DONE_MS = 2000;
const AUTO_HIDE_ERROR_MS = 3000;

// --- Service ---

export class VoiceShortcutService {
  private state: VoiceShortcutState = 'idle';
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType: string | null = null;
  private adapter: MOSSASRAdapter;
  private unlisten: (() => void) | null = null;
  private unlistenHotkey: (() => void) | null = null;
  private unlistenProvider: (() => void) | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private initializing = false;
  private asrProvider: VoiceShortcutAsrProvider = getVoiceShortcutAsrProvider();

  constructor() {
    this.adapter = new MOSSASRAdapter();
  }

  async init(): Promise<void> {
    if (this.unlisten || this.initializing) {
      return;
    }
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
        console.log(LOG_TAG, `voice asr provider switched: ${provider}`);
      });

      this.unlisten = await listen<string>('voice-shortcut', (event) => {
        if (event.payload === 'start') this.handleStart();
        if (event.payload === 'stop') this.handleStop();
        if (event.payload === 'cancel') this.handleCancel();
      });

      console.log(LOG_TAG, 'initialized');
    } finally {
      this.initializing = false;
    }
  }

  destroy(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.unlistenHotkey?.();
    this.unlistenHotkey = null;
    this.unlistenProvider?.();
    this.unlistenProvider = null;
    void this.syncRecordingActive(false);
    this.releaseResources();
    this.clearAutoHide();
  }

  getState(): VoiceShortcutState {
    return this.state;
  }

  // --- Event handlers ---

  private async handleStart(): Promise<void> {
    // Toggle behavior（切换模式）:
    // - idle/error/done: start recording
    // - recording: stop and recognize
    if (this.state === 'recognizing') {
      return;
    }
    if (this.state === 'recording') {
      await this.handleStop();
      return;
    }

    if (this.state === 'done' || this.state === 'error') {
      this.releaseResources();
      this.clearAutoHide();
      this.state = 'idle';
      invoke('voice_overlay_hide').catch(() => {});
    }

    this.clearAutoHide();

    try {
      this.stream = await getUserMediaWithConstraintFallback(
        (c) => navigator.mediaDevices.getUserMedia(c),
        { audio: DEFAULT_RECORDING_AUDIO_CONSTRAINTS },
      );

      const { recorder, mimeType } = createCompatibleMediaRecorder(this.stream);
      this.mediaRecorder = recorder;
      this.mimeType = mimeType;
      this.chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };

      recorder.start(100);
      await this.syncRecordingActive(true);
      this.setState('recording');
    } catch (err) {
      this.handleError(`录音失败: ${err}`);
    }
  }

  private async handleStop(): Promise<void> {
    if (this.state !== 'recording') return;
    this.setState('recognizing');
    await this.syncRecordingActive(false);

    // Stop MediaRecorder
    const recorder = this.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.mediaRecorder = null;

    // Release mic immediately
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
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

      if (result?.text) {
        await this.handleResult(result, recognitionMs, getVoiceShortcutAsrProviderLabel(this.asrProvider));
      } else {
        this.handleError('未识别到文字');
      }
    } catch (err) {
      this.handleError(`识别失败: ${err}`);
    }
  }

  private async handleCancel(): Promise<void> {
    if (this.state !== 'recording') {
      return;
    }

    await this.syncRecordingActive(false);
    this.releaseResources();
    this.clearAutoHide();
    this.setState('idle');
    invoke('voice_overlay_hide').catch(() => {});
  }

  // --- Dual-path output (T5 integration) ---

  private async handleResult(
    result: ASRResult,
    recognitionMs: number,
    providerLabel: string,
  ): Promise<void> {
    const [clipboardResult, eventLogResult] = await Promise.allSettled([
      // Path A: clipboard + paste
      (async () => {
        const writeResult = await getClipboardService().writeText(result.text);
        if (!writeResult.ok) throw new Error(writeResult.title);
        await invoke('simulate_paste');
      })(),
      // Path B: EventLog
      getEventLogService().addEvent(result.text, new Set(['voice'])),
    ]);

    if (clipboardResult.status === 'rejected') {
      console.error(LOG_TAG, 'clipboard paste failed:', clipboardResult.reason);
    }
    if (eventLogResult.status === 'rejected') {
      console.error(LOG_TAG, 'eventlog write failed:', eventLogResult.reason);
    }

    this.emitOverlayState('done', { text: result.text, recognitionMs, providerLabel });
    this.state = 'done';

    this.autoHideTimer = setTimeout(() => {
      this.setState('idle');
      invoke('voice_overlay_hide').catch(() => {});
    }, AUTO_HIDE_DONE_MS);
  }

  private handleError(message: string): void {
    console.error(LOG_TAG, message);
    this.releaseResources();
    this.emitOverlayState('error', { errorMessage: message });
    this.state = 'error';

    this.autoHideTimer = setTimeout(() => {
      this.setState('idle');
      invoke('voice_overlay_hide').catch(() => {});
    }, AUTO_HIDE_ERROR_MS);
  }

  // --- State & overlay ---

  private setState(newState: VoiceShortcutState): void {
    this.state = newState;
    if (newState === 'recording') {
      this.emitOverlayState(newState, { duration: 0 });
      return;
    }
    this.emitOverlayState(newState);
  }

  private emitOverlayState(
    state: string,
    extra?: Record<string, string | number>,
  ): void {
    emit('voice-overlay-state', { state, ...extra }).catch(() => {});
  }

  private async transcribeWithSelectedProvider(wavData: Uint8Array): Promise<ASRResult> {
    if (this.asrProvider === 'volcano') {
      const config = getStoredVolcanoRuntimeConfig(import.meta.env as Record<string, string | undefined>);
      if (!config.appKey || !config.accessKey || !config.resourceId) {
        throw new Error('火山配置不完整，请先到火山 ASR 测试页保存 AppKey / AccessKey / Resource ID');
      }

      // Volcano command expects PCM payload（火山命令要的是纯 PCM，不要 WAV 头）
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

  // --- Cleanup ---

  private releaseResources(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // Ignore stop errors during forced cleanup.
      }
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
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
        // Ignore duplicate registration races from dev reload / strict-mode re-init paths.
        console.warn(LOG_TAG, `voice shortcut "${hotkey}" already registered, skip re-register`);
        return;
      }
      console.error(LOG_TAG, `failed to apply voice shortcut "${hotkey}":`, error);
    }
  }
}

// --- Singleton ---

let instance: VoiceShortcutService | null = null;

export function getVoiceShortcutService(): VoiceShortcutService {
  if (!instance) {
    instance = new VoiceShortcutService();
  }
  return instance;
}

export async function initVoiceShortcutService(): Promise<void> {
  const service = getVoiceShortcutService();
  await service.init();
}
