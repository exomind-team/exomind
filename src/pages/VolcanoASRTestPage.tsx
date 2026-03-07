/**
 * 火山引擎 ASR 测试页面
 *
 * 功能：
 * - 配置火山引擎 ASR 凭证（AppKey / AccessKey / ResourceId）
 * - 麦克风录音 → PCM 16kHz → Tauri Rust 后端 → 火山引擎 WebSocket API
 * - 浏览器环境回退到 Bun 后端代理
 * - 实时显示识别结果和运行日志
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ========== 类型 ==========

type RecordingState = 'idle' | 'recording' | 'recognizing';

interface AsrResult {
  text: string;
  confidence: number;
  lang: string;
  duration?: number;
}

interface LogEntry {
  time: string;
  message: string;
  text?: string;
}

// ========== 常量 ==========

const STORAGE_KEYS = {
  appKey: 'volcano_asr_app_key',
  accessKey: 'volcano_asr_access_key',
  resourceId: 'volcano_asr_resource_id',
} as const;

const DEFAULT_RESOURCE_ID = 'volc.bigasr.sauc.duration';

function loadSaved(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function maskKey(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

// ========== 组件 ==========

export function VolcanoASRTestPage() {
  // 配置
  const [appKey, setAppKey] = useState(() => loadSaved(STORAGE_KEYS.appKey, ''));
  const [accessKey, setAccessKey] = useState(() => loadSaved(STORAGE_KEYS.accessKey, ''));
  const [resourceId, setResourceId] = useState(() => loadSaved(STORAGE_KEYS.resourceId, DEFAULT_RESOURCE_ID));
  const [showKeys, setShowKeys] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  // 录音状态
  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<AsrResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // refs
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const isTauri = !!(window as any).__TAURI__;
  const isConfigured = !!(appKey && accessKey);

  const addLog = useCallback((message: string, text?: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs((prev) => [{ time, message, text }, ...prev.slice(0, 49)]);
  }, []);

  // 加载 env 配置作为默认值
  useEffect(() => {
    if (!appKey) {
      const envKey = (import.meta.env?.VITE_VOLCANO_APP_KEY as string) || '';
      if (envKey) setAppKey(envKey);
    }
    if (!accessKey) {
      const envAccess = (import.meta.env?.VITE_VOLCANO_ACCESS_KEY as string) || '';
      if (envAccess) setAccessKey(envAccess);
    }
  }, []);

  // 保存配置
  const handleSaveConfig = () => {
    try {
      localStorage.setItem(STORAGE_KEYS.appKey, appKey);
      localStorage.setItem(STORAGE_KEYS.accessKey, accessKey);
      localStorage.setItem(STORAGE_KEYS.resourceId, resourceId);
      setConfigSaved(true);
      addLog('配置已保存');
      setTimeout(() => setConfigSaved(false), 2000);
    } catch {
      addLog('保存配置失败');
    }
  };

  // 开始录音
  const handleStart = async () => {
    if (!isConfigured) {
      addLog('请先配置 AppKey 和 AccessKey');
      return;
    }

    try {
      addLog('请求麦克风权限...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      chunksRef.current = [];

      processor.onaudioprocess = (event) => {
        chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };

      // 静音输出避免回声
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      silentGain.connect(audioContext.destination);
      source.connect(processor);
      processor.connect(silentGain);

      setState('recording');
      setResult(null);
      setDuration(0);
      startTimeRef.current = Date.now();

      timerRef.current = setInterval(() => {
        setDuration((Date.now() - startTimeRef.current) / 1000);
      }, 100);

      addLog('录音开始');
    } catch (err) {
      addLog(`麦克风权限被拒绝: ${err}`);
    }
  };

  // 停止录音并识别
  const handleStop = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const finalDuration = (Date.now() - startTimeRef.current) / 1000;
    setDuration(finalDuration);
    addLog(`录音结束，时长 ${finalDuration.toFixed(1)}s`);

    // 停止音频处理
    processorRef.current?.disconnect();
    audioContextRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    // 合并 PCM
    const chunks = chunksRef.current;
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);

    if (totalLength === 0) {
      addLog('没有录到音频数据');
      setState('idle');
      return;
    }

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Float32 → PCM 16bit
    const pcm = new Int16Array(totalLength);
    for (let i = 0; i < totalLength; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const pcmBytes = new Uint8Array(pcm.buffer);

    addLog(`PCM 数据: ${pcmBytes.length} bytes (${totalLength} samples)`);
    setState('recognizing');

    try {
      if (isTauri) {
        await recognizeViaTauri(pcmBytes);
      } else {
        await recognizeViaBun(pcmBytes);
      }
    } catch (err) {
      addLog(`识别失败: ${err}`);
      setState('idle');
    }
  };

  // Tauri Rust 后端识别
  const recognizeViaTauri = async (pcmBytes: Uint8Array) => {
    addLog('通过 Tauri Rust 后端发送到火山引擎...');
    const startMs = Date.now();

    const { invoke } = await import('@tauri-apps/api/core');
    const res = (await invoke('volcano_asr_recognize', {
      audioData: Array.from(pcmBytes),
      config: {
        appKey,
        accessKey,
        resourceId,
        language: 'zh-CN',
      },
    })) as AsrResult;

    const elapsed = Date.now() - startMs;
    setResult(res);
    setState('idle');
    addLog(`识别完成 (${elapsed}ms)`, res.text);
  };

  // Bun 后端代理识别
  const recognizeViaBun = async (pcmBytes: Uint8Array) => {
    addLog('通过 Bun 后端代理发送到火山引擎...');
    const startMs = Date.now();

    const serverUrl = (import.meta.env?.VITE_ASR_SERVER_URL as string) || 'http://localhost:1949';

    const response = await fetch(`${serverUrl}/api/asr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: pcmBytes,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const res = (await response.json()) as AsrResult;
    const elapsed = Date.now() - startMs;
    setResult(res);
    setState('idle');
    addLog(`识别完成 (${elapsed}ms)`, res.text);
  };

  // 重置
  const handleReset = () => {
    setResult(null);
    setDuration(0);
    setState('idle');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">火山引擎 ASR 测试</h1>
      <p className="text-sm text-muted-foreground">
        {isTauri ? 'Tauri 环境 - 使用 Rust 原生 WebSocket' : '浏览器环境 - 使用 Bun 后端代理 (localhost:1949)'}
      </p>

      {/* 配置区域 */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">API 配置</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowKeys(!showKeys)}
              className="text-xs"
            >
              {showKeys ? '隐藏' : '显示'}密钥
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">App Key</label>
            <Input
              type={showKeys ? 'text' : 'password'}
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
              placeholder="火山引擎 App Key"
              className="h-9 font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Access Key</label>
            <Input
              type={showKeys ? 'text' : 'password'}
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder="火山引擎 Access Key"
              className="h-9 font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Resource ID</label>
            <Input
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              placeholder="volc.bigasr.sauc.duration"
              className="h-9 font-mono text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleSaveConfig}>
              保存配置
            </Button>
            {configSaved && <span className="text-xs text-green-600">已保存</span>}
            {isConfigured && !showKeys && (
              <span className="text-xs text-muted-foreground">
                AppKey: {maskKey(appKey)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 状态指示 */}
      <Card
        className={cn(
          'shadow-sm',
          isConfigured ? 'border-green-500/30 bg-green-50 dark:bg-green-950/20' : 'border-red-500/30 bg-red-50 dark:bg-red-950/20'
        )}
      >
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <span className="text-sm font-medium">
              火山引擎大模型流式语音识别
            </span>
            <p className="text-xs text-muted-foreground">
              {isTauri
                ? 'Rust WebSocket → wss://openspeech.bytedance.com'
                : 'Bun 后端代理 → 火山引擎 API'}
            </p>
          </div>
          <span
            className={cn(
              'rounded-md px-2 py-0.5 text-xs font-semibold',
              isConfigured
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white'
            )}
          >
            {isConfigured ? '就绪' : '未配置'}
          </span>
        </CardContent>
      </Card>

      {/* 录音控制 */}
      <div
        className={cn(
          'rounded-xl border p-6 text-center',
          state === 'recording'
            ? 'border-red-500/30 bg-red-50 dark:bg-red-950/20'
            : state === 'recognizing'
              ? 'border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/20'
              : result
                ? 'border-green-500/30 bg-green-50 dark:bg-green-950/20'
                : 'bg-muted'
        )}
      >
        <div className="mb-2 text-lg font-medium">
          {state === 'recording'
            ? '录音中...'
            : state === 'recognizing'
              ? '识别中...'
              : result
                ? '识别完成'
                : '点击开始录音'}
        </div>
        {(state === 'recording' || (state === 'idle' && duration > 0)) && (
          <div className="font-mono text-4xl font-bold text-red-500">
            {duration.toFixed(1)}s
          </div>
        )}
        {state === 'recognizing' && (
          <div className="mt-2 text-sm text-muted-foreground animate-pulse">
            正在连接火山引擎 API...
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {state === 'idle' && !result && (
          <Button
            type="button"
            onClick={handleStart}
            disabled={!isConfigured}
            variant="default"
            className="h-auto flex-1 py-6 text-lg"
          >
            开始录音
          </Button>
        )}
        {state === 'recording' && (
          <Button
            type="button"
            onClick={handleStop}
            variant="destructive"
            className="h-auto flex-1 py-6 text-lg"
          >
            停止并识别
          </Button>
        )}
        {state === 'recognizing' && (
          <Button type="button" disabled className="h-auto flex-1 py-6 text-lg">
            识别中...
          </Button>
        )}
        {result && (
          <Button
            type="button"
            onClick={handleReset}
            variant="default"
            className="h-auto flex-1 py-6 text-lg"
          >
            重新录音
          </Button>
        )}
      </div>

      {/* 识别结果 */}
      {result && (
        <Card className="border-green-500/30 bg-green-50 shadow-sm dark:bg-green-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-green-700 dark:text-green-400">识别结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <p className="text-lg font-medium">{result.text || '（无识别结果）'}</p>
            <div className="text-xs text-muted-foreground">
              {result.confidence && `置信度: ${(result.confidence * 100).toFixed(1)}%`}
              {result.duration != null && ` | 时长: ${result.duration.toFixed(2)}s`}
              {result.lang && ` | 语言: ${result.lang}`}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(result.text);
                addLog('已复制识别文本');
              }}
            >
              复制文本
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 运行日志 */}
      <Card className="shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">运行日志</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setLogs([])}>
            清空
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 font-mono text-xs">
          {logs.map((log, i) => (
            <div key={i} className="leading-relaxed">
              <span className="text-muted-foreground">[{log.time}]</span>{' '}
              <span className="text-foreground">{log.message}</span>
              {log.text && (
                <div className="mt-1 rounded-md border-l-4 border-green-500 bg-green-50 px-3 py-2 text-sm text-foreground dark:bg-green-950/20">
                  {log.text}
                </div>
              )}
            </div>
          ))}
          {logs.length === 0 && (
            <div className="text-muted-foreground">暂无日志</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
