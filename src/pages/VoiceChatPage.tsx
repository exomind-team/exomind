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
import { resolveAsrServerUrl } from '@/config/port-env';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function VoiceChatPage() {
  const service = getVoiceChatService();
  const defaultAsrServerUrl = resolveAsrServerUrl(import.meta.env as Record<string, string | undefined>);

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
        addLog(`  VITE_ASR_SERVER_URL=${defaultAsrServerUrl}`);
      }
    }, 500);
  }, [defaultAsrServerUrl]);

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
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">语音聊天</h1>

      <Card className={cn(
        "shadow-sm",
        isAvailable ? "border-success/30 bg-success/10" : "border-destructive/30 bg-destructive/10"
      )}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">火山引擎 ASR 适配器</CardTitle>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-semibold",
                isAvailable
                  ? "bg-success text-success-foreground"
                  : "bg-destructive text-destructive-foreground"
              )}
            >
              {isAvailable ? '就绪' : '不可用'}
            </span>
          </div>
          {!isAvailable && (
            <div className="text-xs text-muted-foreground whitespace-pre-line mt-2">
              【启动 Bun 后端服务】{'\n'}  bun run src/backend/server.ts{'\n\n'}
              【配置环境变量】{'\n'}  VITE_VOLCANO_APP_KEY=xxx{'\n'}  VITE_VOLCANO_ACCESS_KEY=xxx{'\n'}  VITE_ASR_SERVER_URL={defaultAsrServerUrl}
            </div>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={adapterType === 'http' ? 'brand' : 'outline'}
              onClick={() => handleSwitchAdapter('http')}
              className="flex-1 h-auto py-2 px-3 flex-col items-start gap-0"
            >
              <span className="text-sm">HTTP 模式</span>
              <span className="text-xs opacity-80">需要 Bun 后端</span>
            </Button>
            <Button
              type="button"
              variant={adapterType === 'websocket' ? 'brand' : 'outline'}
              onClick={() => handleSwitchAdapter('websocket')}
              className="flex-1 h-auto py-2 px-3 flex-col items-start gap-0"
            >
              <span className="text-sm">WebSocket 模式</span>
              <span className="text-xs opacity-80">浏览器直接连接</span>
            </Button>
          </div>

          {adapterType === 'websocket' && (
            <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              ⚠️ 注意：WebSocket 模式需要浏览器支持自定义认证头部，可能无法正常工作
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-4 text-sm">
          <span className="font-semibold">状态：</span> {connectionStatus}
        </CardContent>
      </Card>

      <div
        className={cn(
          "rounded-xl border p-4 flex items-center justify-between",
          result
            ? "border-success/30 bg-success/10"
            : isRecording
              ? "border-destructive/30 bg-destructive/10"
              : "bg-muted"
        )}
      >
        <span className="text-sm font-medium">
          {isRecording ? '🔴 录音中' : result ? '✓ 识别完成' : '🎤 点击开始录音'}
        </span>
        {isRecording && (
          <span className="font-mono text-3xl font-bold">
            {formatDuration(duration)}
          </span>
        )}
      </div>

      <div className="flex gap-3">
        {!isRecording && !result ? (
          <Button
            type="button"
            variant="brand"
            onClick={handleStart}
            disabled={!isAvailable}
            className="flex-1 h-auto py-6 text-lg flex-col items-center gap-1"
          >
            <span>🎤 开始录音</span>
            <span className="text-xs opacity-80">
              {adapterType === 'http' ? '自动 3 秒识别' : '手动控制'}
            </span>
          </Button>
        ) : isRecording ? (
          <Button
            type="button"
            variant="destructive"
            onClick={handleStop}
            className="flex-1 h-auto py-6 text-lg"
          >
            ⏹ 停止并识别
          </Button>
        ) : (
          <Button
            type="button"
            variant="brand"
            onClick={handleReset}
            className="flex-1 h-auto py-6 text-lg"
          >
            🔄 重新录音
          </Button>
        )}
      </div>

      {result && (
        <Card className="shadow-sm border-success/30 bg-success/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-success">✓ 识别结果</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <p className="text-lg font-medium">{result.text || '（无识别结果）'}</p>
            <div className="text-xs text-muted-foreground">
              置信度: {(result.confidence * 100).toFixed(1)}%
              {result.duration && ` | 音频时长: ${result.duration}ms`}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">📋 运行日志</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setLogs([])}>
            清空
          </Button>
        </CardHeader>
        <CardContent className="pt-0 font-mono text-xs text-brand space-y-1">
          {logs.map((log, i) => (
            <div key={i} className="leading-relaxed">
              {log}
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-muted-foreground">暂无日志，点击开始录音后显示</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
