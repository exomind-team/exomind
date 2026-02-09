/**
 * MOSS ASR 测试页面
 *
 * ┌─────────────────────────────────────────┐
 * │  L4 UI                                  │
 * │  ─────────────────────────────────     │
 * │  测试 MOSS 语音识别功能                  │
 * │  - 可在页面配置 API Key                 │
 * │  - 原有的测试功能                       │
 * │  - 新增：VoiceInputButton 语音输入      │
 * └─────────────────────────────────────────┘
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { MOSSASRAdapter, MOSSASRResult } from '../lib/adapters/asr/moss-asr';
import { VoiceInputButton } from '../components/VoiceInputButton';
import type { ASRResult } from '../lib/environment/interfaces/asr.port';

// 录音状态
type RecordingState = 'idle' | 'recording';

// 录音方式
type RecordingMethod = 'scriptProcessor' | 'mediaRecorder';

// 日志条目
interface LogEntry {
  time: string;
  message: string;
  duration?: number;
  text?: string;
}

export function MOSSASRTestPage() {
  const [apiKey, setApiKey] = useState('');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingMethod, setRecordingMethod] = useState<RecordingMethod>('mediaRecorder');
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<ASRResult | null>(null);
  const [inputText, setInputText] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string>('未检测');

  const adapterRef = useRef<MOSSASRAdapter | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 初始化适配器
  const getAdapter = useCallback(() => {
    if (!adapterRef.current) {
      adapterRef.current = new MOSSASRAdapter({ apiKey: apiKey || import.meta.env?.VITE_MOSS_API_KEY || '' });
    } else {
      adapterRef.current = new MOSSASRAdapter({ apiKey: apiKey || import.meta.env?.VITE_MOSS_API_KEY || '' });
    }
    return adapterRef.current;
  }, [apiKey]);

  // 从 localStorage 恢复 API Key
  useEffect(() => {
    const savedKey = localStorage.getItem('moss_api_key');
    if (savedKey) {
      setApiKey(savedKey);
      addLog('已恢复保存的 API Key');
    }
  }, []);

  // 检查可用性
  useEffect(() => {
    const adapter = getAdapter();
    setIsAvailable(adapter.isAvailable());
    setConnectionStatus(adapter.isAvailable() ? '就绪' : '未配置');
    addLog(adapter.isAvailable() ? '✓ MOSS ASR 已就绪' : '✗ 请配置 API Key');
    if (!adapter.isAvailable()) {
      addLog('');
      addLog('【配置步骤】');
      addLog('  1. 访问 https://studio.mosi.cn/');
      addLog('  2. 注册账号并获取 API Key');
      addLog('  3. 在下方输入框中粘贴 API Key');
    }
  }, [apiKey]);

  // 计时器
  useEffect(() => {
    if (recordingState === 'recording') {
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 0.1);
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [recordingState]);

  // 添加日志
  const addLogEntry = (msg: string, options?: { duration?: number; text?: string }) => {
    const time = new Date().toLocaleTimeString();
    const entry: LogEntry = { time, message: msg };
    if (options?.duration !== undefined) {
      entry.duration = options.duration;
    }
    if (options?.text !== undefined) {
      entry.text = options.text;
    }
    setLogs(prev => [entry, ...prev.slice(0, 19)]);
  };

  // 兼容旧代码
  const addLog = (msg: string) => {
    addLogEntry(msg);
  };

  const handleSaveApiKey = () => {
    if (apiKey) {
      localStorage.setItem('moss_api_key', apiKey);
      addLog('✓ API Key 已保存到本地');
    }
  };

  // WebM 转 WAV（不做重采样，不做增益）
  const webmToWav = async (webmBlob: Blob): Promise<Uint8Array> => {
    addLog('🔄 WebM 转 WAV 中...');

    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // 提取音频数据
    const rawData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    addLog(`📊 原始采样率: ${sampleRate}Hz`);

    // 直接转换为 PCM 16bit（不做重采样，不做增益）
    const pcmData = new Int16Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      const s = Math.max(-1, Math.min(1, rawData[i]));  // 只裁剪，不放大
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // 编码为 WAV（使用原始采样率）
    const wavData = encodeWAV(new Uint8Array(pcmData.buffer), sampleRate);
    await audioContext.close();

    addLog(`✓ WAV 转换完成: ${(wavData.length / 1024).toFixed(2)} KB`);
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

  // 开始录音
  const handleStart = async () => {
    const adapter = getAdapter();

    if (!adapter.isAvailable()) {
      addLog('错误: 请先配置有效的 API Key');
      setConnectionStatus('❌ 未配置');
      return;
    }

    try {
      addLog(`🔴 开始录音 (${recordingMethod === 'scriptProcessor' ? 'ScriptProcessor' : 'MediaRecorder'})...`);
      setConnectionStatus('🔴 录音中...');
      setRecordingState('recording');
      setDuration(0);
      setResult(null);

      // 获取麦克风
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      });
      startTimeRef.current = Date.now();

      if (recordingMethod === 'scriptProcessor') {
        // ScriptProcessor 方式：直接调用 transcribe
        (window as any).__asrRecordingActive = true;

        const transcribePromise = adapter.transcribe({
          lang: 'zh-CN',
          stream: streamRef.current,
        });

        transcribePromise
          .then((res: MOSSASRResult) => {
            if (recordingState !== 'idle') {
              setRecordingState('idle');
              if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
              }
            }
            setResult(res);

            if (res.audioData && res.audioData.length > 0) {
              const blob = new Blob([res.audioData], { type: 'audio/wav' });
              const url = URL.createObjectURL(blob);
              setAudioUrl(url);
              addLog(`📦 音频文件: ${(res.audioData.length / 1024).toFixed(2)} KB`);
            }

            setConnectionStatus('✓ 识别完成');
            addLog(`✓ 识别完成: ${res.text}`);
            if (res.confidence) {
              addLog(`  置信度: ${(res.confidence * 100).toFixed(1)}%`);
            }
          })
          .catch((error) => {
            if (recordingState !== 'idle') {
              setRecordingState('idle');
              if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
              }
            }
            addLog(`识别错误: ${error}`);
            setConnectionStatus('❌ 识别失败');
          });
      } else {
        // MediaRecorder 方式：先录制，停止时再转换
        addLog('⏳ 请开始说话...');

        // 创建 MediaRecorder
        const mediaRecorder = new MediaRecorder(streamRef.current, {
          mimeType: 'audio/webm;codecs=opus'
        });
        mediaRecorderRef.current = mediaRecorder;
        recordedChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          addLog('🔄 正在处理录音...');
        };

        mediaRecorder.start(100);  // 每 100ms 收集一次数据
        addLog('✓ MediaRecorder 已启动');
      }

    } catch (error) {
      addLog(`错误: ${error}`);
      setConnectionStatus('❌ 麦克风获取失败');
      setRecordingState('idle');
    }
  };

  // 停止并识别
  const handleStop = async () => {
    addLog('⏹ 停止录音...');
    setConnectionStatus('⏳ 处理中...');
    setRecordingState('idle');

    if (recordingMethod === 'scriptProcessor') {
      (window as any).__asrRecordingActive = false;
    } else {
      // MediaRecorder 方式
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    }

    const recDuration = Math.floor((Date.now() - startTimeRef.current) / 1000);
    addLog(`📊 录音时长: ${recDuration}秒`);

    // 关闭麦克风
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (recordingMethod === 'mediaRecorder') {
      // 处理 MediaRecorder 数据
      setTimeout(async () => {
        try {
          if (recordedChunksRef.current.length === 0) {
            throw new Error('没有录制到音频数据');
          }

          const webmBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
          addLog(`📦 WebM 文件: ${(webmBlob.size / 1024).toFixed(2)} KB`);

          // WebM 转 WAV（不做重采样，不做增益）
          const wavData = await webmToWav(webmBlob);

          // 发送到 MOSS 识别
          setConnectionStatus('⏳ 识别中...');
          const adapter = getAdapter();

          const res = await adapter.transcribe({
            lang: 'zh-CN',
            preRecordedAudio: wavData,
          });

          // 保存录音文件
          const wavBlob = new Blob([wavData], { type: 'audio/wav' });
          const url = URL.createObjectURL(wavBlob);
          setAudioUrl(url);

          setResult(res);
          setConnectionStatus('✓ 识别完成');
          addLog(`✓ 识别完成: ${res.text}`);
          if (res.confidence) {
            addLog(`  置信度: ${(res.confidence * 100).toFixed(1)}%`);
          }
        } catch (error) {
          addLog(`处理错误: ${error}`);
          setConnectionStatus('❌ 处理失败');
        }
      }, 100);
    }
  };

  // 重置
  const handleReset = () => {
    // 释放之前的音频 URL
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setResult(null);
    setLogs([]);
    setConnectionStatus('就绪');
    setDuration(0);
    setInputText('');
    addLog('就绪');
  };

  // VoiceInputButton 回调函数
  const handleVoiceResult = (text: string) => {
    setInputText(text);
    addLogEntry('✅ 语音识别完成', { text });
  };

  const handleVoiceError = (error: string) => {
    addLogEntry(`❌ 语音识别失败: ${error}`);
  };

  const handleVoiceStateChange = (state: 'idle' | 'recording' | 'recognizing' | 'completed') => {
    if (state === 'recording') {
      addLogEntry('🎤 开始录音');
    } else if (state === 'recognizing') {
      addLogEntry('⏳ 识别中...');
    } else if (state === 'completed') {
      addLogEntry('✅ 识别完成');
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '700px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '20px' }}>🎤 MOSS 语音识别测试</h1>

      {/* API Key 配置卡片 */}
      <div style={{
        padding: '16px',
        background: '#f8fafc',
        borderRadius: '12px',
        marginBottom: '16px',
        border: '1px solid #e2e8f0',
      }}>
        <div style={{ marginBottom: '12px' }}>
          <strong style={{ fontSize: '14px' }}>MOSS API Key 配置</strong>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            申请地址: <a href="https://studio.mosi.cn/" target="_blank" style={{ color: '#3b82f6' }}>https://studio.mosi.cn/</a>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
            style={{
              flex: 1,
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '14px',
              fontFamily: 'monospace',
            }}
          />
          <button
            onClick={handleSaveApiKey}
            style={{
              padding: '10px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            保存
          </button>
        </div>

        <div style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
          {apiKey ? '✓ 已配置' : '✗ 未配置'}
          {apiKey && ` (${apiKey.slice(0, 4)}...${apiKey.slice(-4)})`}
        </div>
      </div>

      {/* 状态卡片 */}
      <div style={{
        padding: '16px',
        background: isAvailable ? '#dcfce7' : '#fee2e2',
        borderRadius: '12px',
        marginBottom: '16px',
        fontSize: '13px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>MOSS Transcribe-Diarize</strong>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            background: isAvailable ? '#22c55e' : '#ef4444',
            color: 'white',
            fontSize: '11px',
          }}>
            {isAvailable ? '就绪' : '未配置'}
          </span>
        </div>
        <div style={{ marginTop: '8px', color: '#666' }}>
          {isAvailable ? '直接调用 MOSS HTTP API，无需后端服务' : '请在上方配置 API Key'}
        </div>
      </div>

      {/* 录音方式切换 */}
      {recordingState === 'idle' && (
        <div style={{
          padding: '12px',
          background: '#f8fafc',
          borderRadius: '8px',
          marginBottom: '16px',
          border: '1px solid #e2e8f0',
        }}>
          <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: '500' }}>
            录音方式
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setRecordingMethod('scriptProcessor')}
              disabled={!isAvailable}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '12px',
                background: recordingMethod === 'scriptProcessor' ? '#3b82f6' : '#e5e7eb',
                color: recordingMethod === 'scriptProcessor' ? 'white' : '#374151',
                border: 'none',
                borderRadius: '6px',
                cursor: isAvailable ? 'pointer' : 'not-allowed',
              }}
            >
              ScriptProcessor
              <br />
              <small style={{ opacity: 0.8 }}>WAV，~100KB/3秒</small>
            </button>
            <button
              onClick={() => setRecordingMethod('mediaRecorder')}
              disabled={!isAvailable}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '12px',
                background: recordingMethod === 'mediaRecorder' ? '#3b82f6' : '#e5e7eb',
                color: recordingMethod === 'mediaRecorder' ? 'white' : '#374151',
                border: 'none',
                borderRadius: '6px',
                cursor: isAvailable ? 'pointer' : 'not-allowed',
              }}
            >
              MediaRecorder
              <br />
              <small style={{ opacity: 0.8 }}>WebM，~40KB/3秒</small>
            </button>
          </div>
        </div>
      )}

      {/* 连接状态 */}
      <div style={{
        padding: '12px',
        background: '#f8fafc',
        borderRadius: '8px',
        marginBottom: '16px',
        fontSize: '12px',
        border: '1px solid #e2e8f0',
      }}>
        <strong>状态：</strong> {connectionStatus}
      </div>

      {/* 录音状态 */}
      <div style={{
        padding: '24px',
        background: recordingState === 'recording' ? '#fee2e2' :
                    result ? '#dcfce7' : '#f3f4f6',
        borderRadius: '12px',
        marginBottom: '16px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '18px', marginBottom: '8px', fontWeight: '500' }}>
          {recordingState === 'recording' ? '🔴 录音中...' :
           result ? '✓ 识别完成' : '🎤 点击开始录音'}
        </div>
        {recordingState === 'recording' && (
          <div style={{ fontSize: '40px', fontWeight: 'bold', fontFamily: 'monospace', color: '#dc2626' }}>
            {duration.toFixed(1)}s
          </div>
        )}
      </div>

      {/* 控制按钮 */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        {recordingState === 'idle' && !result && (
          <button
            onClick={handleStart}
            disabled={!isAvailable}
            style={{
              flex: 1,
              padding: '24px',
              fontSize: '18px',
              background: isAvailable ? '#3b82f6' : '#9ca3af',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              cursor: isAvailable ? 'pointer' : 'not-allowed',
            }}
          >
            🎤 开始录音
          </button>
        )}

        {recordingState === 'recording' && (
          <button
            onClick={handleStop}
            style={{
              flex: 1,
              padding: '24px',
              fontSize: '18px',
              background: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
            }}
          >
            ⏹ 停止并识别
          </button>
        )}

        {result && (
          <button
            onClick={handleReset}
            style={{
              flex: 1,
              padding: '24px',
              fontSize: '18px',
              background: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
            }}
          >
            🔄 重新录音
          </button>
        )}
      </div>

      {/* VoiceInputButton 语音输入区域 */}
      <div style={{
        padding: '20px',
        background: '#f8fafc',
        borderRadius: '12px',
        marginBottom: '16px',
        border: '1px solid #e2e8f0',
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#374151' }}>
          🎤 语音输入
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          {/* 语音输入按钮 */}
          <VoiceInputButton
            onResult={handleVoiceResult}
            onError={handleVoiceError}
            onStateChange={handleVoiceStateChange}
            defaultMethod="mediaRecorder"
            showWaveform={true}
            showTimer={true}
            enableShortcut={true}
            size={72}
          />

          {/* 语音输入框 */}
          <div style={{ flex: 1 }}>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="点击上方麦克风按钮开始语音输入..."
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '12px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                fontSize: '14px',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
            {inputText && (
              <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => navigator.clipboard.writeText(inputText)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    background: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  复制
                </button>
                <button
                  onClick={() => setInputText('')}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    background: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  清空
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{
          marginTop: '12px',
          padding: '12px',
          background: '#fef3c7',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#92400e',
        }}>
          <strong>快捷键提示：</strong>
          <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
            <li>[空格键] 开始/停止录音</li>
            <li>[Ctrl + 空格] 切换录音方式</li>
            <li>[Esc] 取消录音</li>
          </ul>
        </div>
      </div>

      {/* 原有的识别结果（仅显示，不使用） */}
      {result && (
        <div style={{
          padding: '20px',
          background: '#f0fdf4',
          borderRadius: '12px',
          marginTop: '16px',
          border: '1px solid #86efac',
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#166534' }}>
            识别结果
          </h3>
          <p style={{ margin: 0, fontSize: '20px', fontWeight: '500' }}>
            {result.text || '（无识别结果）'}
          </p>
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
            {result.confidence && `置信度: ${(result.confidence * 100).toFixed(1)}%`}
            {result.duration && ` | 时长: ${(result.duration / 1000).toFixed(2)}秒`}
            {result.lang && ` | 语言: ${result.lang}`}
          </div>
          {audioUrl && (
            <a
              href={audioUrl}
              download={`moss-recording-${Date.now()}.wav`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '12px',
                padding: '8px 12px',
                background: '#3b82f6',
                color: 'white',
                borderRadius: '6px',
                textDecoration: 'none',
                fontSize: '12px',
              }}
            >
              ⬇️ 下载录音文件
            </a>
          )}
        </div>
      )}

      {/* 日志面板 */}
      <div style={{
        padding: '16px',
        background: '#1e293b',
        borderRadius: '12px',
        marginTop: '20px',
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#22d3ee',
      }}>
        <div style={{ marginBottom: '12px', color: '#94a3b8', fontSize: '11px' }}>
          📋 运行日志
          <button
            onClick={() => setLogs([])}
            style={{
              marginLeft: '8px',
              padding: '2px 6px',
              fontSize: '10px',
              background: '#334155',
              color: '#94a3b8',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            清空
          </button>
        </div>
        {logs.map((log, i) => (
          <div key={i} style={{ marginBottom: '8px', lineHeight: '1.5' }}>
            <span style={{ color: '#64748b' }}>[{log.time}]</span>{' '}
            <span>{log.message}</span>
            {log.duration !== undefined && (
              <span style={{ color: '#94a3b8', marginLeft: 8 }}>
                ({log.duration.toFixed(1)}秒)
              </span>
            )}
            {log.text && (
              <div style={{
                marginTop: 4,
                padding: '8px 12px',
                background: 'rgba(81, 207, 102, 0.2)',
                borderRadius: '6px',
                borderLeft: '3px solid #51cf66',
                fontSize: '13px',
                color: '#fff',
              }}>
                {log.text}
              </div>
            )}
          </div>
        ))}
        {logs.length === 0 && (
          <div style={{ color: '#475569' }}>暂无日志</div>
        )}
      </div>
    </div>
  );
}
