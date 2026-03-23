/**
 * useVoiceCapture - 语音录制 + ASR 识别 hook
 *
 * 从 VoiceInputButton 提取的独立录音逻辑，供全局快捷键服务和 UI 组件复用。
 *
 * 职责：
 * 1. getUserMedia → MediaStream
 * 2. createCompatibleMediaRecorder → MediaRecorder
 * 3. 收集 audio chunks
 * 4. 停止时：WebM→WAV 转换 → adapter.transcribe()
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { IASRPort, ASRResult } from '../lib/ports/asr-port';
import {
  createCompatibleMediaRecorder,
  DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
  getUserMediaWithConstraintFallback,
} from '../lib/media/microphone-capture';

export type VoiceCaptureState = 'idle' | 'recording' | 'recognizing';

export type PermissionState = 'checking' | 'granted' | 'denied' | 'prompt' | 'unavailable';

export interface UseVoiceCaptureOptions {
  adapter: IASRPort;
  onResult: (result: ASRResult) => void;
  onError: (error: string) => void;
  onStateChange?: (state: VoiceCaptureState) => void;
}

export interface UseVoiceCaptureReturn {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancel: () => void;
  state: VoiceCaptureState;
  isRecording: boolean;
  duration: number;
  permissionState: PermissionState;
  requestPermission: () => Promise<boolean>;
}

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
    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  const wavData = encodeWAV(new Uint8Array(pcmData.buffer), sampleRate);
  await audioContext.close();
  return wavData;
}

export function useVoiceCapture(options: UseVoiceCaptureOptions): UseVoiceCaptureReturn {
  const [state, setState] = useState<VoiceCaptureState>('idle');
  const [duration, setDuration] = useState(0);
  const [permissionState, setPermissionState] = useState<PermissionState>('checking');

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef<string | null>(null);
  const startTimeRef = useRef(0);
  const operationTokenRef = useRef(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  }, [options]);

  const prevStateRef = useRef<VoiceCaptureState>('idle');
  useEffect(() => {
    if (prevStateRef.current !== state) {
      callbacksRef.current.onStateChange?.(state);
      prevStateRef.current = state;
    }
  }, [state]);

  // Check microphone permission on mount
  useEffect(() => {
    const checkPermission = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermissionState('unavailable');
        return;
      }
      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          setPermissionState(status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt');
        } catch {
          setPermissionState('prompt');
        }
      } else {
        setPermissionState('prompt');
      }
    };
    checkPermission();
  }, []);

  const releaseResources = useCallback(() => {
    if (durationIntervalRef.current !== null) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    recordedMimeTypeRef.current = null;
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionState('unavailable');
      callbacksRef.current.onError('您的浏览器不支持语音录制功能');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      setPermissionState('granted');
      return true;
    } catch (error) {
      const errorName = (error as DOMException).name;
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setPermissionState('denied');
        callbacksRef.current.onError('麦克风权限被拒绝');
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setPermissionState('denied');
        callbacksRef.current.onError('未检测到麦克风设备');
      } else {
        setPermissionState('denied');
        callbacksRef.current.onError(`麦克风访问失败: ${errorName || error}`);
      }
      return false;
    }
  }, []);

  const startRecording = useCallback(async () => {
    const currentToken = ++operationTokenRef.current;

    try {
      if (permissionState === 'unavailable') {
        throw new Error('您的浏览器不支持语音录制功能');
      }

      if (permissionState !== 'granted') {
        const granted = await requestPermission();
        if (!granted || currentToken !== operationTokenRef.current) return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('您的浏览器不支持语音录制功能');
      }

      streamRef.current = await getUserMediaWithConstraintFallback(
        (constraints) => navigator.mediaDevices.getUserMedia(constraints),
        { audio: DEFAULT_RECORDING_AUDIO_CONSTRAINTS }
      );
      startTimeRef.current = Date.now();

      const { recorder: mediaRecorder, mimeType } = createCompatibleMediaRecorder(streamRef.current);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];
      recordedMimeTypeRef.current = mimeType;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          if (!recordedMimeTypeRef.current && event.data.type) {
            recordedMimeTypeRef.current = event.data.type;
          }
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100);

      if (currentToken === operationTokenRef.current) {
        setState('recording');
        setDuration(0);
        durationIntervalRef.current = setInterval(() => {
          setDuration((Date.now() - startTimeRef.current) / 1000);
        }, 100);
      }
    } catch (error) {
      releaseResources();
      if (currentToken === operationTokenRef.current) {
        setState('idle');
        callbacksRef.current.onError(`录音失败: ${error}`);
      }
    }
  }, [permissionState, requestPermission, releaseResources]);

  const stopRecording = useCallback(async () => {
    const currentToken = ++operationTokenRef.current;

    if (durationIntervalRef.current !== null) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      streamRef.current = null;
    }

    if (recordedChunksRef.current.length === 0) {
      releaseResources();
      if (currentToken === operationTokenRef.current) {
        setState('idle');
        callbacksRef.current.onError('没有录制到音频数据');
      }
      return;
    }

    const recordedMimeType = recordedMimeTypeRef.current || 'audio/webm';
    const webmBlob = new Blob(recordedChunksRef.current, { type: recordedMimeType });
    recordedChunksRef.current = [];

    if (currentToken === operationTokenRef.current) {
      setState('recognizing');
    }

    try {
      const wavData = await webmToWav(webmBlob);
      if (currentToken !== operationTokenRef.current) return;

      const result = await callbacksRef.current.adapter.transcribe({
        lang: 'zh-CN',
        preRecordedAudio: wavData,
      });

      if (currentToken !== operationTokenRef.current) return;

      if (result) {
        setState('idle');
        callbacksRef.current.onResult(result);
      }
    } catch (error) {
      releaseResources();
      if (currentToken === operationTokenRef.current) {
        setState('idle');
        callbacksRef.current.onError(`识别失败: ${error}`);
      }
    }
  }, [releaseResources]);

  const cancel = useCallback(() => {
    ++operationTokenRef.current;
    releaseResources();
    setState('idle');
    setDuration(0);
  }, [releaseResources]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      releaseResources();
    };
  }, [releaseResources]);

  return {
    startRecording,
    stopRecording,
    cancel,
    state,
    isRecording: state === 'recording',
    duration,
    permissionState,
    requestPermission,
  };
}
