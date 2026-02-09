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
  // 主状态（只包含必要的渲染状态）
  const [state, setState] = useState<RecordingState>({
    state: 'idle',
    duration: 0,
    startTime: 0,
  });

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

  // canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 停止录音并释放所有资源
  const stopRecordingAndRelease = useCallback((reason: 'complete' | 'cancel') => {
    // 停止动画
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    // 停止 MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // 停止音频流
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // 关闭 AudioContext
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(console.error);
      audioContextRef.current = null;
    }

    // 清理 analyser
    analyserRef.current = null;

    if (reason === 'complete') {
      // 延迟处理数据，确保 MediaRecorder 数据可用
      setTimeout(() => {
        const recordedChunks = recordedChunksRef.current;
        recordedChunksRef.current = [];

        if (recordedChunks.length > 0) {
          const webmBlob = new Blob(recordedChunks, { type: 'audio/webm' });

          setState(prev => ({ ...prev, state: 'recognizing', duration: prev.duration }));

          // WebM 转 WAV
          MOSSASRAdapter.webmToWav(webmBlob)
            .then((wavData) => {
              // 调用识别
              return adapterRef.current?.transcribe({
                lang: 'zh-CN',
                preRecordedAudio: wavData,
              });
            })
            .then((result) => {
              if (result) {
                setState({ state: 'completed', duration: 0, startTime: 0 });
                callbacksRef.current.onResult(result.text);
              }
            })
            .catch((error) => {
              setState({ state: 'idle', duration: 0, startTime: 0 });
              callbacksRef.current.onError?.(`识别失败: ${error}`);
            });
        } else {
          setState({ state: 'idle', duration: 0, startTime: 0 });
          callbacksRef.current.onError?.('没有录制到音频数据');
        }
      }, 100);
    } else {
      // 取消
      setState({ state: 'idle', duration: 0, startTime: 0 });
      recordedChunksRef.current = [];
    }
  }, []);

  // 开始录音
  const startRecording = useCallback(async () => {
    try {
      // 获取麦克风
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      });
      streamRef.current = stream;

      // 创建 AudioContext 和 Analyser
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // 创建 MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100);

      // 更新状态
      setState({
        state: 'recording',
        duration: 0,
        startTime: Date.now(),
      });

    } catch (error) {
      callbacksRef.current.onError?.(`麦克风访问失败: ${error}`);
    }
  }, []);

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
      const target = e.target as HTMLElement;

      // 排除输入区域
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('[contenteditable="true"]')
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
      {enableShortcut && state.state === 'idle' && (
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
    </div>
  );
}
