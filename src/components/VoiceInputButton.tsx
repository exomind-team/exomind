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
 * └─────────────────────────────────────────┘
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { IASRPort, IASRConfig } from '../lib/ports/asr-port';
import { MOSSASRAdapter } from '../lib/adapters/asr/moss-asr';

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
  /** 启用快捷键（仅非输入区域生效） */
  enableShortcut?: boolean;
  /** 按钮大小 */
  size?: number;
  /** 类名 */
  className?: string;
  /** 样式 */
  style?: React.CSSProperties;
}

// 录音状态管理
interface RecordingState {
  state: VoiceButtonState;
  duration: number;
  startTime: number;
}

// 使用 ref 来存储动画帧 ID，避免触发重渲染
let animationFrameId: number | null = null;

export function VoiceInputButton({
  onResult,
  onError,
  onStateChange,
  adapter,
  adapterConfig,
  showWaveform = true,
  showTimer = true,
  enableShortcut = true,
  size = 64,
  className,
  style,
}: VoiceInputButtonProps) {
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

  // 资源 refs
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
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
      callbacksRef.current.onError?.(`${error.message}\n提示: ${error.userTip}`);
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
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setPermissionState('denied');
        callbacksRef.current.onError?.('麦克风权限被拒绝\n提示: 请在浏览器设置中允许麦克风访问');
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
  }, []);

  // 停止录音并释放所有资源
  const stopRecordingAndRelease = useCallback((reason: 'complete' | 'cancel') => {
    const operationToken = ++operationTokenRef.current;

    // Stop button animation
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    const finish = async () => {
      releaseRecordingResources();

      if (reason === 'cancel') {
        recordedChunksRef.current = [];
        if (operationToken === operationTokenRef.current) {
          setState({ state: 'idle', duration: 0, startTime: 0 });
        }
        return;
      }

      const recordedChunks = [...recordedChunksRef.current];
      recordedChunksRef.current = [];

      if (recordedChunks.length === 0) {
        if (operationToken === operationTokenRef.current) {
          setState({ state: 'idle', duration: 0, startTime: 0 });
          callbacksRef.current.onError?.('No recorded audio data');
        }
        return;
      }

      if (operationToken !== operationTokenRef.current) {
        return;
      }

      setState(prev => ({ ...prev, state: 'recognizing' }));

      try {
        const webmBlob = new Blob(recordedChunks, { type: 'audio/webm' });
        const wavData = await MOSSASRAdapter.webmToWav(webmBlob);

        if (operationToken !== operationTokenRef.current) {
          return;
        }

        const result = await adapterRef.current?.transcribe({
          lang: 'zh-CN',
          preRecordedAudio: wavData,
        });

        if (operationToken !== operationTokenRef.current) {
          return;
        }

        if (result) {
          setState({ state: 'completed', duration: 0, startTime: 0 });
          callbacksRef.current.onResult(result.text);
        }
      } catch (error) {
        if (operationToken !== operationTokenRef.current) {
          return;
        }

        setState({ state: 'idle', duration: 0, startTime: 0 });
        callbacksRef.current.onError?.(`Recognition failed: ${error}`);
      }
    };

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      const handleStop = () => {
        void finish();
      };

      recorder.addEventListener('stop', handleStop, { once: true });
      recorder.stop();
      return;
    }

    void finish();
  }, [releaseRecordingResources]);

  // 调试日志函数
  const logDebug = useCallback((type: string, message: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[VoiceInput][${timestamp}][${type}] ${message}`;
    if (data !== undefined) {
      console.log(logEntry, data);
    } else {
      console.log(logEntry);
    }
  }, []);

  // 检测 HTTPS 环境（完整检测）
  const isSecureContext = useCallback(() => {
    // 完整检测：使用 browser 内置的 isSecureContext
    // getUserMedia 要求 HTTPS 或 localhost
    return window.isSecureContext;
  }, []);

  // 获取详细的错误信息和用户提示
  const getErrorInfo = useCallback((error: Error | DOMException): { message: string; userTip: string; code: string } => {
    const errorName = error.name || 'UnknownError';
    const errorMessage = error.message || String(error);

    // NotAllowedError - 权限被拒绝
    if (errorName === 'NotAllowedError' || errorMessage.includes('Permission denied') || errorMessage.includes('permission')) {
      return {
        message: '麦克风权限被拒绝',
        userTip: '请在浏览器设置中允许麦克风访问：点击地址栏左侧的锁图标 -> 权限 -> 麦克风 -> 允许',
        code: 'PERMISSION_DENIED',
      };
    }

    // NotFoundError - 找不到设备
    if (errorName === 'NotFoundError' || errorMessage.includes('Requested device not found') || errorMessage.includes('No device')) {
      return {
        message: '未检测到麦克风设备',
        userTip: '请确保电脑已连接麦克风，并检查设备是否正常工作',
        code: 'DEVICE_NOT_FOUND',
      };
    }

    // NotReadableError - 设备被占用
    if (errorName === 'NotReadableError' || errorMessage.includes('device in use') || errorMessage.includes('busy')) {
      return {
        message: '麦克风正在被其他程序使用',
        userTip: '请关闭其他使用麦克风的程序（如视频会议软件、录音软件等），然后重试',
        code: 'DEVICE_IN_USE',
      };
    }

    // NotSupportedError - 不支持的环境
    if (errorName === 'NotSupportedError' || errorMessage.includes('secure context') || errorMessage.includes('HTTPS')) {
      return {
        message: '当前环境不支持语音录制',
        userTip: '语音功能需要 HTTPS 环境或 localhost。请确保使用安全连接，或在开发环境下使用 localhost',
        code: 'NOT_SUPPORTED',
      };
    }

    // OverconstrainedError - 约束条件不支持
    if (errorName === 'OverconstrainedError' || errorMessage.includes('constraint')) {
      return {
        message: '麦克风不支持所请求的音频配置',
        userTip: '正在尝试使用默认音频配置...',
        code: 'CONSTRAINT_FAILED',
      };
    }

    // 其他错误
    return {
      message: `麦克风访问失败: ${errorMessage}`,
      userTip: '请检查麦克风连接或浏览器权限设置后重试',
      code: errorName.toUpperCase().replace(/ERROR$/, '') || 'UNKNOWN',
    };
  }, []);

  // 尝试获取麦克风（带重试逻辑）
  const tryGetUserMedia = useCallback(async (retryCount = 0): Promise<MediaStream | null> => {
    const maxRetries = 2;

    try {
      logDebug('INFO', `尝试获取麦克风权限 (第 ${retryCount + 1} 次)`);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      });
      logDebug('SUCCESS', '麦克风获取成功', { tracks: stream.getTracks().length });
      return stream;
    } catch (error) {
      const errorInfo = getErrorInfo(error as Error | DOMException);
      logDebug('ERROR', `麦克风获取失败 (第 ${retryCount + 1} 次)`, { error, errorInfo });

      // 如果是约束失败且还有重试次数，尝试不使用约束
      if (errorInfo.code === 'CONSTRAINT_FAILED' && retryCount < maxRetries) {
        logDebug('INFO', '约束条件不被支持，尝试使用默认配置');
        return tryGetUserMedia(retryCount + 1);
      }

      // 抛出带有详细信息的错误
      const enhancedError = new Error(errorInfo.message);
      (enhancedError as Error & { code: string; userTip: string }).code = errorInfo.code;
      (enhancedError as Error & { userTip: string }).userTip = errorInfo.userTip;
      throw enhancedError;
    }
  }, [logDebug, getErrorInfo]);

  // 开始录音
  const startRecording = useCallback(async () => {
    const currentToken = ++operationTokenRef.current;

    try {
      logDebug('INFO', '开始录音流程', { state: state.state, token: currentToken });

      // 1. 检查权限状态
      if (permissionState === 'unavailable') {
        logDebug('ERROR', 'mediaDevices API 不可用');
        const error = new Error('您的浏览器不支持语音录制功能');
        (error as Error & { code: string; userTip: string }).code = 'API_NOT_SUPPORTED';
        (error as Error & { code: string; userTip: string }).userTip = '请使用最新版本的 Chrome、Edge 或 Safari 浏览器';
        throw error;
      }

      // 如果权限未授予，先请求权限
      if (permissionState !== 'granted') {
        logDebug('INFO', '权限未授予，先请求权限');
        const granted = await requestPermission();
        if (!granted) {
          logDebug('WARN', '权限请求失败');
          return;
        }
        if (currentToken !== operationTokenRef.current) {
          logDebug('INFO', '操作已被取消，跳过录音');
          return;
        }
      }

      // 2. 检测 mediaDevices API 可用性（双重检查）
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        logDebug('ERROR', 'mediaDevices API 不可用');
        const error = new Error('您的浏览器不支持语音录制功能');
        (error as Error & { code: string; userTip: string }).code = 'API_NOT_SUPPORTED';
        (error as Error & { code: string; userTip: string }).userTip = '请使用最新版本的 Chrome、Edge 或 Safari 浏览器';
        throw error;
      }
      logDebug('INFO', 'mediaDevices API 检查通过');

      // 3. 获取麦克风（带重试逻辑）
      const stream = await tryGetUserMedia();
      if (!stream) {
        logDebug('WARN', '无法获取麦克风权限');
        return;
      }
      if (currentToken !== operationTokenRef.current) {
        logDebug('INFO', '操作已被取消，跳过录音');
        return;
      }
      streamRef.current = stream;
      logDebug('INFO', 'MediaStream 已获取', {
        audioTracks: stream.getAudioTracks().length,
        label: stream.getAudioTracks()[0]?.label || 'unknown'
      });

      // 5. 创建 AudioContext 和 Analyser
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      logDebug('INFO', 'AudioContext 和 Analyser 创建成功', { state: audioContext.state });

      // 6. 创建 MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg;codecs=opus';
      logDebug('INFO', `选择的 MIME 类型: ${mimeType}`);

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100);
      logDebug('INFO', 'MediaRecorder 已启动');

      // 7. 更新状态
      setState({
        state: 'recording',
        duration: 0,
        startTime: Date.now(),
      });
      logDebug('SUCCESS', '录音状态已更新为 recording');

    } catch (error) {
      const errorInfo = getErrorInfo(error as Error | DOMException);
      const userTip = (error as Error & { userTip: string }).userTip || errorInfo.userTip;
      const code = (error as Error & { code: string }).code || errorInfo.code;

      logDebug('ERROR', `录音失败: ${errorInfo.message}`, { code, userTip });

      // 更新状态为 idle
      if (currentToken === operationTokenRef.current) {
        setState(prev => {
          if (prev.state !== 'idle') {
            return { state: 'idle', duration: 0, startTime: 0 };
          }
          return prev;
        });

        // 调用错误回调（包含详细信息）
        callbacksRef.current.onError?.(`${errorInfo.message}\n提示: ${userTip}`);
      }
    }
  }, [requestPermission, permissionState, tryGetUserMedia, getErrorInfo, logDebug, state.state]);

  // 处理按钮点击
  const handleClick = useCallback(() => {
    if (state.state === 'idle' || state.state === 'completed') {
      startRecording();
    } else if (state.state === 'recording') {
      const duration = (Date.now() - state.startTime) / 1000;
      setState(prev => ({ ...prev, duration }));
      stopRecordingAndRelease('complete');
    }
  }, [state.state, state.startTime, startRecording, stopRecordingAndRelease]);

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
          stopRecordingAndRelease('cancel');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableShortcut, handleClick, state.state, stopRecordingAndRelease]);

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
        gradient.addColorStop(0, '#ff6b6b');
        gradient.addColorStop(1, '#ee5a5a');

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
  }, [showWaveform, state.state, size]);

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
          background: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%)',
          shadow: '0 0 20px rgba(255, 107, 107, 0.6)',
          icon: '🎤',
        };
      case 'recognizing':
        return {
          background: 'linear-gradient(135deg, #4dabf7 0%, #339af0 100%)',
          shadow: '0 0 20px rgba(77, 171, 247, 0.6)',
          icon: '⏳',
        };
      case 'completed':
        return {
          background: 'linear-gradient(135deg, #51cf66 0%, #40c057 100%)',
          shadow: '0 0 20px rgba(81, 207, 102, 0.6)',
          icon: '✓',
        };
      default:
        return {
          background: 'linear-gradient(135deg, #868e96 0%, #6c757d 100%)',
          shadow: '0 4px 12px rgba(108, 117, 125, 0.3)',
          icon: '🎤',
        };
    }
  };

  const colors = getButtonColors();
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
          color: state.state === 'recording' ? '#ff6b6b' :
                 state.state === 'recognizing' ? '#4dabf7' : '#51cf66',
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
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: '50%',
          border: 'none',
          background: colors.background,
          boxShadow: colors.shadow,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: buttonSize * 0.4,
          transition: 'all 0.3s ease',
          transform: state.state === 'recording' ? 'scale(1.05)' : 'scale(1)',
          animation: state.state === 'recording'
            ? 'pulse 1.5s ease-in-out infinite'
            : 'none',
          position: 'relative',
          overflow: 'hidden',
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
            background: '#fff',
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
          {colors.icon}
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
          color: '#adb5bd',
          whiteSpace: 'nowrap',
        }}>
          按 [空格] 开始/停止
        </div>
      )}

      {/* 权限未授予时显示获取权限按钮 */}
      {permissionState !== 'granted' && permissionState !== 'checking' && (
        <button
          onClick={requestPermission}
          style={{
            width: buttonSize,
            height: buttonSize,
            borderRadius: '50%',
            border: 'none',
            background: 'linear-gradient(135deg, #ffa500 0%, #ff8c00 100%)',
            boxShadow: '0 4px 12px rgba(255, 140, 0, 0.4)',
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
          color: '#ffa500',
          whiteSpace: 'nowrap',
        }}>
          {permissionState === 'unavailable' ? '不支持' : '需要权限'}
        </div>
      )}
    </div>
  );
}
