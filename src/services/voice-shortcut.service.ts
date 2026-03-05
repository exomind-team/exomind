/**
 * VoiceShortcutService - 全局语音快捷键服务
 *
 * T3: 监听 Tauri event → 录音 → ASR → 双路输出
 *
 * 流程:
 *   Alt+Q pressed  → Rust emits "voice-shortcut" "start" → startRecording
 *   Alt+Q released → Rust emits "voice-shortcut" "stop"  → stopRecording → ASR
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
  createCompatibleMediaRecorder,
  getUserMediaWithConstraintFallback,
  DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
} from '../lib/media/microphone-capture';
import type { ASRResult } from '../lib/ports/asr-port';

export type VoiceShortcutState = 'idle' | 'recording' | 'recognizing' | 'done' | 'error';

const LOG_TAG = '[VoiceShortcut]';
const AUTO_HIDE_DONE_MS = 2000;
const AUTO_HIDE_ERROR_MS = 3000;

// --- WAV encoding (same as useVoiceCapture) ---

function encodeWAV(samples: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer).set(samples, 44);
  return new Uint8Array(buffer);
}

async function webmToWav(webmBlob: Blob): Promise<Uint8Array> {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const audioContext = new AudioContext();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const rawData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  const pcmData = new Int16Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    const s = Math.max(-1, Math.min(1, rawData[i]));
    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const wavData = encodeWAV(new Uint8Array(pcmData.buffer), sampleRate);
  await audioContext.close();
  return wavData;
}

// --- Service ---

export class VoiceShortcutService {
  private state: VoiceShortcutState = 'idle';
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType: string | null = null;
  private adapter: MOSSASRAdapter;
  private unlisten: (() => void) | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.adapter = new MOSSASRAdapter();
  }

  async init(): Promise<void> {
    if (!isTauri()) {
      console.warn(LOG_TAG, 'not in Tauri environment, service disabled');
      return;
    }

    this.unlisten = await listen<string>('voice-shortcut', (event) => {
      if (event.payload === 'start') this.handleStart();
      if (event.payload === 'stop') this.handleStop();
    });

    console.log(LOG_TAG, 'initialized, listening for Alt+Q');
  }

  destroy(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.releaseResources();
    this.clearAutoHide();
  }

  getState(): VoiceShortcutState {
    return this.state;
  }

  // --- Event handlers ---

  private async handleStart(): Promise<void> {
    if (this.state !== 'idle') return;
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
      this.setState('recording');
    } catch (err) {
      this.handleError(`录音失败: ${err}`);
    }
  }

  private async handleStop(): Promise<void> {
    if (this.state !== 'recording') return;

    // Stop MediaRecorder
    const recorder = this.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }

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

    this.setState('recognizing');

    try {
      const wavData = await webmToWav(blob);
      const result = await this.adapter.transcribe({
        lang: 'zh-CN',
        preRecordedAudio: wavData,
      });

      if (result?.text) {
        await this.handleResult(result);
      } else {
        this.handleError('未识别到文字');
      }
    } catch (err) {
      this.handleError(`识别失败: ${err}`);
    }
  }

  // --- Dual-path output (T5 integration) ---

  private async handleResult(result: ASRResult): Promise<void> {
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

    this.emitOverlayState('done', { text: result.text });
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
    this.emitOverlayState(newState);
  }

  private emitOverlayState(
    state: string,
    extra?: Record<string, string>,
  ): void {
    emit('voice-overlay-state', { state, ...extra }).catch(() => {});
  }

  // --- Cleanup ---

  private releaseResources(): void {
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
