/**
 * VoiceInputButton - 语音输入按钮
 *
 * ┌─────────────────────────────────────────┐
 * │  L4 UI                                  │
 * │  ─────────────────────────────────     │
 * │  - 圆形麦克风按钮                        │
 * │  - 录音/识别状态动画                     │
 * │  - 音量波形可视化                        │
 * │  - 快捷键支持（仅非输入区域）            │
 * │  - 依赖注入（可选 IASRPort）             │
 * │  - 使用原生 MediaRecorder API            │
 * └─────────────────────────────────────────┘
 */

import React, { useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
import type { IASRPort, IASRConfig } from '../lib/ports/asr-port';
import { MOSSASRAdapter } from '../lib/adapters/asr/moss-asr';
import { cn } from '../lib/utils';
import {
  createCompatibleMediaRecorder,
  DEFAULT_RECORDING_AUDIO_CONSTRAINTS,
  getUserMediaWithConstraintFallback,
} from '../lib/media/microphone-capture';

// 按钮状态
export type VoiceButtonState = 'idle' | 'recording' | 'recognizing' | 'completed';

// Props
export interface VoiceInputButtonProps {
  /** 识别结果回调 */
  onResult: (text: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
  /** 状态变化回调 */
  onStateChange?: (state: VoiceButtonState) => void;

  /** ASR 适配器（可选，默认使用 MOSSAdapter） */
  adapter?: IASRPort;
  /** 适配器配置（API Key 等） */
  adapterConfig?: IASRConfig;

  /** 是否显示波形 */
  showWaveform?: boolean;
  /** 是否显示计时器 */
  showTimer?: boolean;
  /** 权限未授予时是否显示解锁按钮（permission unlock button） */
  showPermissionUnlockButton?: boolean;
  /** 启用快捷键（仅非输入区域生效） */
  enableShortcut?: boolean;
  /** 按钮大小 */
  size?: number;
  /** 类名 */
  className?: string;
  /** 样式 */
  style?: React.CSSProperties;
  /** 录音频谱颜色变量（例如 --brand-accent） */
  waveformColorVar?: `--${string}` | string;
  /** 主按钮额外类名 */
  buttonClassName?: string;
  /** idle 状态主按钮额外类名 */
  idleButtonClassName?: string;
  /** 主按钮额外样式 */
  buttonStyle?: React.CSSProperties;
  /** idle 状态主按钮额外样式 */
  idleButtonStyle?: React.CSSProperties;
  /** 图标覆盖 */
  icons?: Partial<Record<VoiceButtonState, React.ReactNode>>;
}

export interface VoiceInputButtonHandle {
  start: () => void;
}

// 录音状态管理
interface RecordingState {
  state: VoiceButtonState;
  duration: number;
  startTime: number;
}

// 使用 ref 来存储动画帧 ID，避免触发重渲染
let animationFrameId: number | null = null;

export const VoiceInputButton = React.forwardRef<VoiceInputButtonHandle, VoiceInputButtonProps>(function VoiceInputButton({
  onResult,
  onError,
  onStateChange,
  adapter,
  adapterConfig,
  showWaveform = true,
  showTimer = true,
  showPermissionUnlockButton = true,
  enableShortcut = true,
  size = 64,
  className,
  style,
  waveformColorVar = '--destructive',
  buttonClassName,
  idleButtonClassName,
  buttonStyle,
  idleButtonStyle,
  icons,
}, ref) {
  // 权限状态类型
  type PermissionState = 'checking' | 'granted' | 'denied' | 'prompt' | 'unavailable';

  // 主状态（只包含必要的渲染状态）
  const [state, setState] = useState<RecordingState>({
    state: 'idle',
    duration: 0,
    startTime: 0,
  });

  // 麦克风权限状态
  const [permissionState, setPermissionState] = useState<PermissionState>('checking');

  // 上一次状态（用于检测变化）
  const prevStateRef = useRef<VoiceButtonState>('idle');

  // 适配器 ref
  const adapterRef = useRef<IASRPort | null>(null);

  // 资源 refs - 使用原生 MediaRecorder
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const operationTokenRef = useRef(0);

  // 使用 ref 存储回调，避免闭包问题
  const callbacksRef = useRef({
    onResult,
    onError,
    onStateChange,
  });

  // 保持 ref 更新
  useEffect(() => {
    callbacksRef.current = { onResult, onError, onStateChange };
  }, [onResult, onError, onStateChange]);

  // 使用 useEffect 通知父组件状态变化（避免在渲染期间调用 setState）
  useEffect(() => {
    if (prevStateRef.current !== state.state) {
      callbacksRef.current.onStateChange?.(state.state);
      prevStateRef.current = state.state;
    }
  }, [state.state]);

  // 初始化适配器
  useEffect(() => {
    console.log('[VoiceInput] 初始化, isSecureContext:', window.isSecureContext);
    console.log('[VoiceInput] location:', window.location.href, 'protocol:', window.location.protocol);
    if (adapter) {
      adapterRef.current = adapter;
    } else {
      // 默认 MOSSAdapter
      adapterRef.current = new MOSSASRAdapter(adapterConfig);
    }
  }, [adapter, adapterConfig]);

  // 配置适配器（API Key 等）
  useEffect(() => {
    if (adapterRef.current && adapterConfig) {
      adapterRef.current.configure(adapterConfig);
    }
  }, [adapterConfig]);

  // 检查麦克风权限状态
  useEffect(() => {
    const checkPermission = async () => {
      // 检查 mediaDevices API 是否可用
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionState('unavailable');
        return;
      }

      // 尝试查询权限状态
      if (navigator.permissions?.query) {
        try {
          const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          if (permissionStatus.state === 'granted') {
            setPermissionState('granted');
          } else if (permissionStatus.state === 'denied') {
            setPermissionState('denied');
          } else {
            setPermissionState('prompt');
          }
        } catch {
          // 无法查询权限，假设需要提示用户
          setPermissionState('prompt');
        }
      } else {
        // 权限 API 不可用，需要提示用户
        setPermissionState('prompt');
      }
    };

    checkPermission();
  }, []);

  // canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 请求麦克风权限
  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const error = new Error('您的浏览器不支持语音录制功能');
      (error as Error & { code: string; userTip: string }).code = 'API_NOT_SUPPORTED';
      (error as Error & { userTip: string }).userTip = '请使用最新版本的 Chrome、Edge 或 Safari 浏览器';
      const extError = error as Error & { userTip: string };
      callbacksRef.current.onError?.(`${error.message}\n提示: ${extError.userTip}`);
      setPermissionState('unavailable');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 释放刚获取的 stream
      stream.getTracks().forEach(track => track.stop());
      setPermissionState('granted');
      return true;
    } catch (error) {
      const errorName = (error as DOMException).name;
      // Android runtime guidance（Android 端引导文案）
      const permissionGuide = /Android/i.test(navigator.userAgent)
        ? '请在系统设置 > 应用 > ExoMind > 权限中允许麦克风访问'
        : '请在浏览器设置中允许麦克风访问';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setPermissionState('denied');
        callbacksRef.current.onError?.(`麦克风权限被拒绝\n提示: ${permissionGuide}`);
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setPermissionState('denied');
        callbacksRef.current.onError?.('未检测到麦克风设备\n提示: 请确保电脑已连接麦克风');
      } else {
        setPermissionState('denied');
        callbacksRef.current.onError?.(`麦克风访问失败: ${errorName || error}`);
      }
      return false;
    }
  }, []);

  // 释放资源
  const releaseRecordingResources = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    recordedMimeTypeRef.current = null;
  }, []);

  // WebM 转 WAV（与 moss-test 页面相同）
  const webmToWav = async (webmBlob: Blob): Promise<Uint8Array> => {
    console.log('[VoiceInput] WebM 转 WAV 中...');

    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // 提取音频数据
    const rawData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    console.log(`[VoiceInput] 原始采样率: ${sampleRate}Hz`);

    // 直接转换为 PCM 16bit
    const pcmData = new Int16Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      const s = Math.max(-1, Math.min(1, rawData[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // 编码为 WAV
    const wavData = encodeWAV(new Uint8Array(pcmData.buffer), sampleRate);
    await audioContext.close();

    console.log(`[VoiceInput] WAV 转换完成: ${(wavData.length / 1024).toFixed(2)} KB`);
    return wavData;
  };

  // 编码 WAV 格式
  const encodeWAV = (samples: Uint8Array, sampleRate: number): Uint8Array => {
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
  };

  // 开始录音（使用原生 MediaRecorder）
  const startRecording = useCallback(async () => {
    const currentToken = ++operationTokenRef.current;

    try {
      console.log('[VoiceInput] 开始录音流程', { state: state.state, token: currentToken });

      // 1. 检查权限状态
      if (permissionState === 'unavailable') {
        console.log('[VoiceInput] mediaDevices API 不可用');
        throw new Error('您的浏览器不支持语音录制功能');
      }

      // 如果权限未授予，先请求权限
      if (permissionState !== 'granted') {
        console.log('[VoiceInput] 权限未授予，先请求权限');
        const granted = await requestPermission();
        if (!granted) {
          console.log('[VoiceInput] 权限请求失败');
          return;
        }
        if (currentToken !== operationTokenRef.current) {
          console.log('[VoiceInput] 操作已被取消，跳过录音');
          return;
        }
      }

      // 2. 检测 mediaDevices API 可用性
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.log('[VoiceInput] mediaDevices API 不可用');
        throw new Error('您的浏览器不支持语音录制功能');
      }
      console.log('[VoiceInput] mediaDevices API 检查通过');

      // 3. 获取麦克风
      console.log('[VoiceInput] 获取麦克风...');
      streamRef.current = await getUserMediaWithConstraintFallback(
        (constraints) => navigator.mediaDevices.getUserMedia(constraints),
        { audio: DEFAULT_RECORDING_AUDIO_CONSTRAINTS }
      );
      startTimeRef.current = Date.now();
      console.log('[VoiceInput] 麦克风获取成功');

      // 4. 创建 MediaRecorder
      const { recorder: mediaRecorder, mimeType } = createCompatibleMediaRecorder(streamRef.current);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];
      recordedMimeTypeRef.current = mimeType;

      // 5. 设置数据收集回调
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          if (!recordedMimeTypeRef.current && event.data.type) {
            recordedMimeTypeRef.current = event.data.type;
          }
          recordedChunksRef.current.push(event.data);
          console.log('[VoiceInput] 收到音频数据:', event.data.size, 'bytes');
        }
      };

      // 6. 开始录音
      mediaRecorder.start(100); // 每 100ms 收集一次数据
      console.log('[VoiceInput] MediaRecorder 已启动');

      // 7. 设置波形可视化（使用 analyser）
      if (showWaveform && streamRef.current) {
        audioContextRef.current = new AudioContext();
        const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
        analyserRef.current = audioContextRef.current.createAnalyser();
        analyserRef.current.fftSize = 64;
        source.connect(analyserRef.current);
      }

      // 8. 更新状态
      if (currentToken === operationTokenRef.current) {
        setState({
          state: 'recording',
          duration: 0,
          startTime: Date.now(),
        });
      }

    } catch (error) {
      console.error('[VoiceInput] 开始录音失败:', error);
      releaseRecordingResources();

      if (currentToken === operationTokenRef.current) {
        setState({ state: 'idle', duration: 0, startTime: 0 });
        callbacksRef.current.onError?.(`录音失败: ${error}`);
      }
    }
  }, [requestPermission, permissionState, showWaveform, releaseRecordingResources, state.state]);

  // 停止录音并识别
  const stopRecording = useCallback(async () => {
    const operationToken = ++operationTokenRef.current;
    console.log('[VoiceInput] 停止录音...', { token: operationToken });

    // 停止动画
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      // 等待 stop 完成
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
      console.log('[VoiceInput] MediaRecorder 已停止');
    }

    const recDuration = Math.floor((Date.now() - startTimeRef.current) / 1000);
    console.log(`[VoiceInput] 录音时长: ${recDuration}秒`);

    // 检查是否有录音数据
    if (recordedChunksRef.current.length === 0) {
      console.error('[VoiceInput] 没有录制到音频数据');
      releaseRecordingResources();
      if (operationToken === operationTokenRef.current) {
        setState({ state: 'idle', duration: 0, startTime: 0 });
        callbacksRef.current.onError?.('没有录制到音频数据');
      }
      return;
    }

    // 获取录音 blob
    const recordedMimeType = recordedMimeTypeRef.current || 'audio/webm';
    const webmBlob = new Blob(recordedChunksRef.current, { type: recordedMimeType });
    console.log(`[VoiceInput] 音频文件(${recordedMimeType}): ${(webmBlob.size / 1024).toFixed(2)} KB`);

    // 释放麦克风
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // 更新状态为识别中
    if (operationToken === operationTokenRef.current) {
      setState(prev => ({ ...prev, state: 'recognizing' }));
    }

    try {
      // WebM 转 WAV
      const wavData = await webmToWav(webmBlob);

      if (operationToken !== operationTokenRef.current) {
        return;
      }

      // 调用 ASR 识别
      console.log('[VoiceInput] 调用 ASR 识别...');
      const result = await adapterRef.current?.transcribe({
        lang: 'zh-CN',
        preRecordedAudio: wavData,
      });

      if (operationToken !== operationTokenRef.current) {
        return;
      }

      if (result) {
        console.log(`[VoiceInput] 识别完成: "${result.text}"`);
        setState({ state: 'completed', duration: 0, startTime: 0 });
        callbacksRef.current.onResult(result.text);
      }
    } catch (error) {
      console.error('[VoiceInput] 识别失败:', error);
      releaseRecordingResources();
      if (operationToken === operationTokenRef.current) {
        setState({ state: 'idle', duration: 0, startTime: 0 });
        callbacksRef.current.onError?.(`识别失败: ${error}`);
      }
    }
  }, [releaseRecordingResources]);

  // 处理按钮点击
  const handleClick = useCallback(() => {
    if (state.state === 'idle' || state.state === 'completed') {
      startRecording();
    } else if (state.state === 'recording') {
      stopRecording();
    }
  }, [state.state, startRecording, stopRecording]);

  useImperativeHandle(ref, () => ({
    start: () => {
      if (state.state === 'idle' || state.state === 'completed') {
        startRecording();
      }
    },
  }), [startRecording, state.state]);

  // 快捷键处理（仅非输入区域）
  useEffect(() => {
    if (!enableShortcut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // 获取当前焦点元素
      const target = e.target;
      const targetElement = target instanceof HTMLElement ? target : null;

      // 排除输入区域
      if (
        targetElement &&
        (
          targetElement.tagName === 'INPUT' ||
          targetElement.tagName === 'TEXTAREA' ||
          targetElement.isContentEditable ||
          targetElement.closest('[contenteditable="true"]')
        )
      ) {
        return; // 不拦截
      }

      // 空格键开始/停止录音
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        handleClick();
      }
      // Escape 取消
      else if (e.key === 'Escape' || e.code === 'Escape') {
        if (state.state === 'recording' || state.state === 'recognizing') {
          releaseRecordingResources();
          setState({ state: 'idle', duration: 0, startTime: 0 });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableShortcut, handleClick, state.state, releaseRecordingResources]);

  const formatCssVarColor = (triplet: string, alpha: number): string | null => {
    const parts = triplet.trim().split(/\s+/);
    if (parts.length < 3) return null;
    return `hsla(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  };

  // 音量波形动画
  useEffect(() => {
    if (!showWaveform || state.state !== 'recording' || !canvasRef.current) {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const baseRadius = (size / 2) - 8;
    const rootStyle = getComputedStyle(document.documentElement);
    const normalizedWaveformVar = waveformColorVar.startsWith('--')
      ? waveformColorVar
      : `--${waveformColorVar}`;
    const waveformTriplet = rootStyle.getPropertyValue(normalizedWaveformVar)
      || rootStyle.getPropertyValue('--destructive');
    const waveform0 = formatCssVarColor(waveformTriplet, 0.9) ?? '#ff6b6b';
    const waveform1 = formatCssVarColor(waveformTriplet, 0.6) ?? '#ee5a5a';

    const draw = () => {
      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 绘制波形环绕
      const bars = 32;
      const angleStep = (Math.PI * 2) / bars;

      for (let i = 0; i < bars; i++) {
        const value = dataArray[i] || 0;
        const barHeight = (value / 255) * 30 + 5;
        const angle = i * angleStep - Math.PI / 2;

        const x1 = centerX + Math.cos(angle) * baseRadius;
        const y1 = centerY + Math.sin(angle) * baseRadius;
        const x2 = centerX + Math.cos(angle) * (baseRadius + barHeight);
        const y2 = centerY + Math.sin(angle) * (baseRadius + barHeight);

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, waveform0);
        gradient.addColorStop(1, waveform1);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    };

    draw();

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };
  }, [showWaveform, size, state.state, waveformColorVar]);

  // 计时器
  useEffect(() => {
    if (state.state !== 'recording') return;

    const interval = setInterval(() => {
      const duration = (Date.now() - state.startTime) / 1000;
      setState(prev => ({ ...prev, duration }));
    }, 100);

    return () => clearInterval(interval);
  }, [state.state, state.startTime]);

  // 自动重置到 idle
  useEffect(() => {
    if (state.state === 'completed') {
      const timer = setTimeout(() => {
        setState(prev => ({ ...prev, state: 'idle' }));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state.state]);

  // 获取按钮颜色
  const getButtonColors = () => {
    switch (state.state) {
      case 'recording':
        return {
          background:
            'linear-gradient(135deg, hsl(var(--destructive)) 0%, hsl(var(--destructive) / 0.85) 100%)',
          shadow: '0 0 20px hsl(var(--destructive) / 0.6)',
          icon: '🎤',
          iconColor: 'hsl(var(--destructive-foreground))',
        };
      case 'recognizing':
        return {
          background:
            'linear-gradient(135deg, hsl(var(--brand)) 0%, hsl(var(--brand) / 0.85) 100%)',
          shadow: '0 0 20px hsl(var(--brand) / 0.6)',
          icon: '⏳',
          iconColor: 'hsl(var(--brand-foreground))',
        };
      case 'completed':
        return {
          background:
            'linear-gradient(135deg, hsl(var(--success)) 0%, hsl(var(--success) / 0.85) 100%)',
          shadow: '0 0 20px hsl(var(--success) / 0.6)',
          icon: '✓',
          iconColor: 'hsl(var(--success-foreground))',
        };
      default:
        return {
          background:
            'linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--secondary)) 100%)',
          shadow: '0 4px 12px hsl(var(--ring) / 0.2)',
          icon: '🎤',
          iconColor: 'inherit',
        };
    }
  };

  const colors = getButtonColors();
  const iconNode = icons?.[state.state] ?? colors.icon;
  const isIdle = state.state === 'idle';
  const useIdleClassVisual = isIdle && Boolean(idleButtonClassName);
  const buttonSize = size;

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block', ...style }} className={className}>
      {/* 录音波形画布 */}
      {showWaveform && state.state === 'recording' && (
        <canvas
          ref={canvasRef}
          width={buttonSize + 80}
          height={buttonSize + 80}
          style={{
            position: 'absolute',
            top: -40,
            left: -40,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* 录音/识别状态文字 */}
      {showTimer && state.state !== 'idle' && (
        <div style={{
          position: 'absolute',
          top: -28,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 12,
          fontWeight: 500,
          color:
            state.state === 'recording'
              ? 'hsl(var(--destructive))'
              : state.state === 'recognizing'
                ? 'hsl(var(--brand))'
                : 'hsl(var(--success))',
          whiteSpace: 'nowrap',
        }}>
          {state.state === 'recording' ? formatTime(state.duration) :
           state.state === 'recognizing' ? '识别中...' : '完成'}
        </div>
      )}

      {/* 主按钮 */}
      <button
        ref={buttonRef}
        onClick={handleClick}
        className={cn(buttonClassName, isIdle && idleButtonClassName)}
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: '50%',
          border: 'none',
          background: useIdleClassVisual ? undefined : colors.background,
          boxShadow: useIdleClassVisual ? undefined : colors.shadow,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: buttonSize * 0.4,
          color: colors.iconColor,
          transition: 'all 0.3s ease',
          transform: state.state === 'recording' ? 'scale(1.05)' : 'scale(1)',
          animation: state.state === 'recording'
            ? 'pulse 1.5s ease-in-out infinite'
            : 'none',
          position: 'relative',
          overflow: 'hidden',
          ...(isIdle ? idleButtonStyle : undefined),
          ...buttonStyle,
        }}
      >
        {/* 录音时的脉动效果 */}
        {state.state === 'recording' && (
          <style>{`
            @keyframes pulse {
              0%, 100% { transform: scale(1.05); }
              50% { transform: scale(1.1); }
            }
          `}</style>
        )}

        {/* 识别时的旋转效果 */}
        {state.state === 'recognizing' && (
          <style>{`
            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
        )}

        {/* 完成时的闪烁效果 */}
        {state.state === 'completed' && (
          <style>{`
            @keyframes flash {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.5; }
            }
          `}</style>
        )}

        {/* 录音指示灯 */}
        {state.state === 'recording' && (
          <span style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'hsl(var(--foreground))',
            animation: 'blink 1s ease-in-out infinite',
          }}>
            <style>{`
              @keyframes blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.3; }
              }
            `}</style>
          </span>
        )}

        {/* 图标 */}
        <span style={{
          transform: state.state === 'recognizing' ? 'scale(0.9)' : 'scale(1)',
        }}>
          {iconNode}
        </span>
      </button>

      {/* 快捷键提示 */}
      {enableShortcut && state.state === 'idle' && permissionState === 'granted' && (
        <div style={{
          position: 'absolute',
          bottom: -20,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 10,
          color: 'hsl(var(--muted-foreground))',
          whiteSpace: 'nowrap',
        }}>
          按 [空格] 开始/停止
        </div>
      )}

      {/* 权限未授予时显示获取权限按钮 */}
      {showPermissionUnlockButton && permissionState !== 'granted' && permissionState !== 'checking' && (
        <button
          onClick={requestPermission}
          style={{
            width: buttonSize,
            height: buttonSize,
            borderRadius: '50%',
            border: 'none',
            background:
              'linear-gradient(135deg, hsl(var(--warning)) 0%, hsl(var(--warning) / 0.85) 100%)',
            boxShadow: '0 4px 12px hsl(var(--warning) / 0.4)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: buttonSize * 0.3,
            transition: 'all 0.3s ease',
          }}
          title="点击获取麦克风权限"
        >
          🔓
        </button>
      )}

      {/* 权限提示文字 */}
      {permissionState !== 'granted' && permissionState !== 'checking' && (
        <div style={{
          position: 'absolute',
          bottom: -20,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 10,
          color: 'hsl(var(--warning))',
          whiteSpace: 'nowrap',
        }}>
          {permissionState === 'unavailable' ? '不支持' : '需要权限'}
        </div>
      )}
    </div>
  );
});
