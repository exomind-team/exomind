/**
 * VoiceChatPage - 语音聊天页面
 *
 * ┌─────────────────────────────────────────┐
 * │  L4 UI                                  │
 * │  ─────────────────────────────────     │
 * │  - 只调 Service                         │
 * │  - 展示状态和结果                       │
 * │  - 不关心底层实现细节                   │
 * └─────────────────────────────────────────┘
 */

import { useEffect, useState } from 'react';
import { getVoiceChatService, setASRAdapterType, ASRAdapterType } from '../lib/services/voice-chat.service';
import type { ASRResult } from '../lib/environment/interfaces/asr.port';

export function VoiceChatPage() {
  const service = getVoiceChatService();

  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<ASRResult | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);
  const [adapterType, setAdapterType] = useState<ASRAdapterType>('http');
  const [logs, setLogs] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string>('未检测');

  // 初始化适配器状态
  useEffect(() => {
    // 延迟检查以确保服务已初始化
    setTimeout(() => {
      setIsAvailable(service.isAvailable);
      setAdapterType(service.adapterType);
      addLog(`检测到 ${service.adapterType === 'http' ? 'HTTP' : 'WebSocket'} 适配器`);
      addLog(service.isAvailable ? '✓ ASR 服务已就绪' : '✗ ASR 服务不可用');

      if (!service.isAvailable) {
        addLog('');
        addLog('【启动 Bun 后端服务】');
        addLog('  bun run src/backend/server.ts');
        addLog('');
        addLog('【配置环境变量】');
        addLog('  VITE_VOLCANO_APP_KEY=xxx');
        addLog('  VITE_VOLCANO_ACCESS_KEY=xxx');
        addLog('  VITE_ASR_SERVER_URL=http://localhost:1949');
      }
    }, 500);
  }, []);

  // 轮询服务状态
  useEffect(() => {
    const interval = setInterval(() => {
      setIsRecording(service.isRecording);
      setDuration(service.duration);
      setResult(service.lastResult);
      setIsAvailable(service.isAvailable);
      setAdapterType(service.adapterType);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 24)]);
  };

  const handleStart = async () => {
    try {
      await service.startRecording();
      setConnectionStatus('🔗 录音中...');
      addLog('🔴 开始录音...');
    } catch (error) {
      addLog(`错误: ${error}`);
      setConnectionStatus('❌ 启动失败');
    }
  };

  const handleStop = async () => {
    addLog('⏹ 停止录音...');
    setConnectionStatus('⏳ 识别中...');

    await service.stopRecording();

    setTimeout(() => {
      if (service.lastResult) {
        setResult(service.lastResult);
        setConnectionStatus('✓ 识别完成');
        addLog(`✓ 识别结果: ${service.lastResult.text}`);
      } else {
        setConnectionStatus('⚠️ 无结果');
        addLog('⚠️ 未收到识别结果');
      }
    }, 500);
  };

  const handleReset = () => {
    service.reset();
    setResult(null);
    setLogs([]);
    setConnectionStatus('就绪');
    addLog('就绪');
  };

  const handleSwitchAdapter = (type: ASRAdapterType) => {
    setASRAdapterType(type);
    setAdapterType(type);
    addLog(`切换到 ${type === 'http' ? 'HTTP' : 'WebSocket'} 适配器`);
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ padding: '24px', maxWidth: '700px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '20px' }}>🎤 语音聊天</h1>

      {/* ASR 状态卡片 */}
      <div style={{
        padding: '16px',
        background: isAvailable ? '#dcfce7' : '#fee2e2',
        borderRadius: '12px',
        marginBottom: '16px',
        fontSize: '13px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <strong>火山引擎 ASR 适配器</strong>
          <span style={{
            padding: '2px 8px',
            borderRadius: '4px',
            background: isAvailable ? '#22c55e' : '#ef4444',
            color: 'white',
            fontSize: '11px',
          }}>
            {isAvailable ? '就绪' : '不可用'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            onClick={() => handleSwitchAdapter('http')}
            style={{
              flex: 1,
              padding: '8px',
              fontSize: '12px',
              background: adapterType === 'http' ? '#3b82f6' : '#e5e7eb',
              color: adapterType === 'http' ? 'white' : '#374151',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            HTTP 模式
            <br />
            <small>需要 Bun 后端</small>
          </button>
          <button
            onClick={() => handleSwitchAdapter('websocket')}
            style={{
              flex: 1,
              padding: '8px',
              fontSize: '12px',
              background: adapterType === 'websocket' ? '#3b82f6' : '#e5e7eb',
              color: adapterType === 'websocket' ? 'white' : '#374151',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            WebSocket 模式
            <br />
            <small>浏览器直接连接</small>
          </button>
        </div>

        {adapterType === 'websocket' && (
          <div style={{ marginTop: '8px', padding: '8px', background: '#fef3c7', borderRadius: '6px', fontSize: '11px' }}>
            ⚠️ 注意：WebSocket 模式需要浏览器支持自定义认证头部，可能无法正常工作
          </div>
        )}
      </div>

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

      {/* 状态栏 */}
      <div style={{
        padding: '16px',
        background: result ? '#dcfce7' :
                    isRecording ? '#fee2e2' :
                    '#f3f4f6',
        borderRadius: '12px',
        marginBottom: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: '14px', fontWeight: '500' }}>
          {isRecording ? '🔴 录音中' :
           result ? '✓ 识别完成' : '🎤 点击开始录音'}
        </span>
        {isRecording && (
          <span style={{ fontSize: '28px', fontWeight: 'bold', fontFamily: 'monospace' }}>
            {formatDuration(duration)}
          </span>
        )}
      </div>

      {/* 控制按钮 */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        {!isRecording && !result ? (
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
            <br />
            <small style={{ fontSize: '12px', opacity: 0.9 }}>
              {adapterType === 'http' ? '自动 3 秒识别' : '手动控制'}
            </small>
          </button>
        ) : isRecording ? (
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
        ) : (
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

      {/* 识别结果 */}
      {result && (
        <div style={{
          padding: '20px',
          background: '#f0fdf4',
          borderRadius: '12px',
          marginTop: '16px',
          border: '1px solid #86efac',
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#166534' }}>
            ✓ 识别结果
          </h3>
          <p style={{ margin: 0, fontSize: '20px', fontWeight: '500' }}>
            {result.text || '（无识别结果）'}
          </p>
          <div style={{ marginTop: '12px', fontSize: '12px', color: '#666' }}>
            置信度: {(result.confidence * 100).toFixed(1)}%
            {result.duration && ` | 音频时长: ${result.duration}ms`}
          </div>
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
          <div key={i} style={{ marginBottom: '4px', lineHeight: '1.5' }}>
            {log}
          </div>
        ))}
        {logs.length === 0 && (
          <div style={{ color: '#475569' }}>暂无日志，点击开始录音后显示</div>
        )}
      </div>
    </div>
  );
}
