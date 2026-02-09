/**
 * 语音识别测试页面
 * 使用浏览器原生 Web Speech API 进行测试
 */

import { useEffect, useRef, useState } from 'react';
import type { ASRResult } from '../lib/ports/asr-port';

// 获取 SpeechRecognition 构造函数
const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
};

export function ASRTestPage() {
  const [status, setStatus] = useState<'idle' | 'ready' | 'recording' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<ASRResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [apiAvailable, setApiAvailable] = useState<boolean>(false);

  // 保存正在运行的 recognition 实例
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // 添加日志
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 19)]);
    console.log(`[ASR-Test] ${msg}`);
  };

  // 开始录音
  const startRecording = () => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      addLog('✗ 浏览器不支持语音识别');
      setStatus('error');
      setApiAvailable(false);
      return;
    }

    // 创建新实例
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    // 保存引用
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      const results = event.results;
      let finalText = '';
      let finalConfidence = 0;

      for (let i = 0; i < results.length; i++) {
        const r = results[i];  // 用 r 避免与 state.result 冲突
        if (r.isFinal) {
          finalText += r[0].transcript;
          finalConfidence = Math.max(finalConfidence, r[0].confidence);
          addLog(`[最终] ${r[0].transcript}`);
        } else {
          addLog(`[中间] ${r[0].transcript}`);
        }
      }

      if (finalText) {
        setResult({
          text: finalText,
          confidence: finalConfidence,
          lang: 'zh-CN',
        });
        setStatus('success');
      }
    };

    recognition.onerror = (event: any) => {
      addLog(`识别错误: ${event.error}`);
      if (event.error === 'no-speech') {
        addLog('没有检测到语音');
        setStatus('ready');
      } else {
        setError(`语音识别失败: ${event.error}`);
        setStatus('error');
      }
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      addLog('录音结束');
      recognitionRef.current = null;
      // 只有还在 recording 状态时才重置为 ready
      setStatus(prev => prev === 'recording' ? 'ready' : prev);
    };

    setStatus('recording');
    addLog('🔴 开始录音...');
    recognition.start();
  };

  // 停止录音
  const stopRecording = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
        addLog('⏹ 用户停止录音');
      } catch (e) {
        addLog(`停止失败: ${e}`);
      }
    } else {
      addLog('⚠️ 没有正在运行的识别器');
    }
    setStatus('ready');
  };

  // 录音控制
  const toggleRecording = () => {
    if (status === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // 重新开始
  const reset = () => {
    setResult(null);
    setError(null);
    setLogs([]);
    setStatus('ready');
    addLog('就绪，请开始录音');
  };

  // 检查 API 可用性
  useEffect(() => {
    const SpeechRecognition = getSpeechRecognition();
    if (SpeechRecognition) {
      addLog('✓ Web Speech API 可用');
      setStatus('ready');
      setApiAvailable(true);
    } else {
      addLog('✗ 浏览器不支持语音识别');
      setStatus('error');
      setApiAvailable(false);
    }
  }, []);

  return (
    <div style={{
      padding: '24px',
      maxWidth: '600px',
      margin: '0 auto',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>语音识别测试</h1>
      </div>

      {/* 状态显示 */}
      <div style={{
        padding: '12px',
        background: status === 'success' ? '#dcfce7' :
                    status === 'error' ? '#fee2e2' :
                    status === 'recording' ? '#fee2e2' :
                    '#f3f4f6',
        borderRadius: '8px',
        marginBottom: '16px',
        textAlign: 'center',
      }}>
        {status === 'idle' && '点击"开始录音"'}
        {status === 'ready' && '✓ 准备就绪'}
        {status === 'recording' && '🔴 录音中...请说话'}
        {status === 'success' && '✓ 识别完成'}
        {status === 'error' && '✗ 出错了'}
      </div>

      {/* 控制按钮 */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        {!apiAvailable ? (
          <button
            disabled
            style={{
              flex: 1,
              padding: '16px',
              fontSize: '18px',
              background: '#9ca3af',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'not-allowed',
            }}
          >
            浏览器不支持语音识别
          </button>
        ) : status === 'success' || status === 'error' ? (
          <button
            onClick={reset}
            style={{
              flex: 1,
              padding: '16px',
              fontSize: '18px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            🔄 重新开始
          </button>
        ) : (
          <button
            onClick={toggleRecording}
            style={{
              flex: 1,
              padding: '16px',
              fontSize: '18px',
              background: status === 'recording' ? '#ef4444' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            {status === 'recording' ? '⏹ 点击停止' : '🎤 点击开始录音'}
          </button>
        )}
      </div>

      {/* 识别结果 */}
      {result && (
        <div style={{
          padding: '16px',
          background: '#f0fdf4',
          borderRadius: '8px',
          marginTop: '16px',
        }}>
          <h3 style={{ margin: '0 0 8px 0' }}>识别结果：</h3>
          <p style={{ margin: 0, fontSize: '18px' }}>{result.text}</p>
          <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#666' }}>
            置信度: {(result.confidence * 100).toFixed(1)}% | 语言: {result.lang}
          </p>
        </div>
      )}

      {/* 错误信息 */}
      {error && (
        <div style={{
          padding: '12px',
          background: '#fef2f2',
          borderRadius: '8px',
          marginTop: '16px',
          color: '#dc2626',
        }}>
          错误: {error}
        </div>
      )}

      {/* 日志 */}
      <div style={{
        padding: '12px',
        background: '#1f2937',
        borderRadius: '8px',
        marginTop: '16px',
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#10b981',
      }}>
        <div style={{ marginBottom: '8px', color: '#9ca3af' }}>运行日志：</div>
        {logs.map((log, i) => (
          <div key={i} style={{ marginBottom: '4px' }}>{log}</div>
        ))}
        {logs.length === 0 && <span style={{ color: '#4b5563' }}>暂无日志</span>}
      </div>

      {/* API 状态 */}
      <div style={{
        marginTop: '24px',
        padding: '12px',
        background: '#f0f9ff',
        borderRadius: '8px',
        fontSize: '12px',
        color: '#0369a1',
      }}>
        <strong>Web Speech API 状态：</strong>
        <br />
        {apiAvailable ? '✓ 浏览器支持语音识别' : '✗ 浏览器不支持语音识别（请使用 Chrome/Edge/Safari）'}
      </div>
    </div>
  );
}
