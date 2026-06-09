/**
 * Volcano ASR test page（火山 ASR 测试页）
 *
 * Purpose（用途）:
 * - verify official websocket mode/resource settings（核对官方模式与资源配置）
 * - send buffered PCM to Bun or Tauri backend（把录好的 PCM 发到 Bun / Tauri 后端）
 * - compare speed/accuracy presets（对比速度/准确率配置）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  DEFAULT_VOLCANO_ASR_OPTIONS,
  VOLCANO_ENDPOINT_OPTIONS,
  VOLCANO_LANGUAGE_OPTIONS,
  VOLCANO_MODEL_NAME,
  VOLCANO_RESOURCE_PRESETS,
  VOLCANO_STORAGE_KEYS,
  buildVolcanoHttpRequestPayload,
  buildVolcanoRuntimeConfig,
  findVolcanoResourcePreset,
  type VolcanoEndpoint,
} from '@/lib/asr/volcano-config';
import {
  getVolcanoAccessKey,
  getVolcanoAppKey,
  getVolcanoEndpointSetting,
  getVolcanoLanguageSetting,
  getVolcanoResourceIdSetting,
  subscribeVolcanoAccessKeyChanges,
  subscribeVolcanoAppKeyChanges,
  subscribeVolcanoEndpointChanges,
  subscribeVolcanoLanguageChanges,
  subscribeVolcanoResourceIdChanges,
} from '@/config/volcano-asr-settings';
import {
  getRuntimeConfigValueSync,
  setRuntimeConfigValue,
} from '@/config/runtime-config-cache';
import { isTauriWindow } from '@/config/runtime-target';
import { recordVolcanoUsageDuration } from '@/config/volcano-usage-stats';

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

function loadSavedBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = getRuntimeConfigValueSync(key);
    return raw == null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
}

function loadSavedNumber(key: string, fallback: number): number {
  try {
    const raw = getRuntimeConfigValueSync(key);
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function maskKey(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function VolcanoASRTestPage() {
  const navigate = useNavigate();
  const [appKey, setAppKeyState] = useState(() => getVolcanoAppKey());
  const [accessKey, setAccessKeyState] = useState(() => getVolcanoAccessKey());
  const [resourceId, setResourceIdState] = useState(() => getVolcanoResourceIdSetting());
  const [endpoint, setEndpointState] = useState<VolcanoEndpoint>(() => getVolcanoEndpointSetting());
  const [language, setLanguageState] = useState(() => getVolcanoLanguageSetting());
  const [enableNonstream, setEnableNonstream] = useState(() => loadSavedBoolean(
    VOLCANO_STORAGE_KEYS.enableNonstream,
    DEFAULT_VOLCANO_ASR_OPTIONS.enableNonstream
  ));
  const [showUtterances, setShowUtterances] = useState(() => loadSavedBoolean(
    VOLCANO_STORAGE_KEYS.showUtterances,
    DEFAULT_VOLCANO_ASR_OPTIONS.showUtterances
  ));
  const [endWindowSize, setEndWindowSize] = useState(() => loadSavedNumber(
    VOLCANO_STORAGE_KEYS.endWindowSize,
    DEFAULT_VOLCANO_ASR_OPTIONS.endWindowSize
  ));
  const [forceToSpeechTime, setForceToSpeechTime] = useState(() => loadSavedNumber(
    VOLCANO_STORAGE_KEYS.forceToSpeechTime,
    DEFAULT_VOLCANO_ASR_OPTIONS.forceToSpeechTime
  ));
  const [showKeys, setShowKeys] = useState(false);
  const [testOptionsSaved, setTestOptionsSaved] = useState(false);

  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<AsrResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const isTauri = isTauriWindow();
  const isConfigured = !!(appKey && accessKey && resourceId);
  const endpointMeta = useMemo(
    () => VOLCANO_ENDPOINT_OPTIONS.find((item) => item.value === endpoint),
    [endpoint]
  );
  const resourcePresetLabel = useMemo(() => {
    const matched = findVolcanoResourcePreset(resourceId);
    return VOLCANO_RESOURCE_PRESETS.find((item) => item.value === matched)?.label ?? '自定义 Resource ID';
  }, [resourceId]);

  const addLog = useCallback((message: string, text?: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs((prev) => [{ time, message, text }, ...prev.slice(0, 79)]);
  }, []);

  useEffect(() => {
    const unsubscribers = [
      subscribeVolcanoAppKeyChanges(setAppKeyState),
      subscribeVolcanoAccessKeyChanges(setAccessKeyState),
      subscribeVolcanoResourceIdChanges(setResourceIdState),
      subscribeVolcanoEndpointChanges(setEndpointState),
      subscribeVolcanoLanguageChanges(setLanguageState),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const handleSaveTestOptions = () => {
    try {
      setRuntimeConfigValue(VOLCANO_STORAGE_KEYS.enableNonstream, String(enableNonstream), {
        source: 'volcano-test-options',
        sourceOrigin: window.location?.origin,
      });
      setRuntimeConfigValue(VOLCANO_STORAGE_KEYS.showUtterances, String(showUtterances), {
        source: 'volcano-test-options',
        sourceOrigin: window.location?.origin,
      });
      setRuntimeConfigValue(VOLCANO_STORAGE_KEYS.endWindowSize, String(endWindowSize), {
        source: 'volcano-test-options',
        sourceOrigin: window.location?.origin,
      });
      setRuntimeConfigValue(VOLCANO_STORAGE_KEYS.forceToSpeechTime, String(forceToSpeechTime), {
        source: 'volcano-test-options',
        sourceOrigin: window.location?.origin,
      });
      setTestOptionsSaved(true);
      addLog(`测试参数已保存，模式=${endpoint}，资源=${resourceId}`);
      setTimeout(() => setTestOptionsSaved(false), 2000);
    } catch {
      addLog('保存测试参数失败');
    }
  };

  const handleStart = async () => {
    if (!isConfigured) {
      addLog('请先配置 AppKey、AccessKey 和 Resource ID');
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

      addLog(`录音开始，模式=${endpoint}`);
    } catch (err) {
      addLog(`麦克风权限被拒绝: ${err}`);
    }
  };

  const handleStop = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const finalDuration = (Date.now() - startTimeRef.current) / 1000;
    setDuration(finalDuration);
    addLog(`录音结束，时长 ${finalDuration.toFixed(1)}s`);

    processorRef.current?.disconnect();
    audioContextRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());

    const chunks = chunksRef.current;
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
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

    const pcm = new Int16Array(totalLength);
    for (let i = 0; i < totalLength; i++) {
      const sample = Math.max(-1, Math.min(1, merged[i]));
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
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

  const buildRuntimeConfig = () => buildVolcanoRuntimeConfig(
    {
      appKey,
      accessKey,
      resourceId,
      language,
    },
    {
      endpoint,
      enableNonstream,
      showUtterances,
      endWindowSize,
      forceToSpeechTime,
    }
  );

  const recognizeViaTauri = async (pcmBytes: Uint8Array) => {
    addLog(`通过 Tauri Rust 后端发送到火山引擎 (${endpoint})...`);
    const startMs = Date.now();
    const { invoke } = await import('@tauri-apps/api/core');

    const res = (await invoke('volcano_asr_recognize', {
      audioData: Array.from(pcmBytes),
      config: buildRuntimeConfig(),
    })) as AsrResult;

    if (typeof res.duration === 'number' && res.duration > 0) {
      recordVolcanoUsageDuration(res.duration);
    }
    const elapsed = Date.now() - startMs;
    setResult(res);
    setState('idle');
    addLog(`识别完成 (${elapsed}ms)`, res.text);
  };

  const recognizeViaBun = async (pcmBytes: Uint8Array) => {
    addLog(`通过 Bun 后端代理发送到火山引擎 (${endpoint})...`);
    const startMs = Date.now();
    const serverUrl = (import.meta.env?.VITE_ASR_SERVER_URL as string) || 'http://localhost:1949';

    const response = await fetch(`${serverUrl}/api/asr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildVolcanoHttpRequestPayload(
        pcmBytes,
        {
          appKey,
          accessKey,
          resourceId,
          language,
        },
        {
          endpoint,
          enableNonstream,
          showUtterances,
          endWindowSize,
          forceToSpeechTime,
        }
      )),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const res = (await response.json()) as AsrResult;
    if (typeof res.duration === 'number' && res.duration > 0) {
      recordVolcanoUsageDuration(res.duration);
    }
    const elapsed = Date.now() - startMs;
    setResult(res);
    setState('idle');
    addLog(`识别完成 (${elapsed}ms)`, res.text);
  };

  const handleReset = () => {
    setResult(null);
    setDuration(0);
    setState('idle');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">火山引擎 ASR 测试</h1>
      <p className="text-sm text-muted-foreground">
        {isTauri ? 'Tauri 环境 - 使用 Rust 原生 WebSocket' : '浏览器环境 - 使用 Bun 后端代理'}
      </p>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-sm">设置页配置（只读）</CardTitle>
              <p className="text-xs text-muted-foreground">
                AppKey / AccessKey / 识别模式 / 资源模型 / Resource ID / 识别语言 统一在设置页维护。
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowKeys((value) => !value)}
              className="text-xs"
            >
              {showKeys ? '隐藏' : '显示'}密钥
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 rounded-lg border border-dashed p-3">
              <div className="text-xs text-muted-foreground">App Key</div>
              <div className="font-mono text-sm">{showKeys ? (appKey || '未配置') : (maskKey(appKey) || '未配置')}</div>
            </div>
            <div className="space-y-1.5 rounded-lg border border-dashed p-3">
              <div className="text-xs text-muted-foreground">Access Key</div>
              <div className="font-mono text-sm">{showKeys ? (accessKey || '未配置') : (maskKey(accessKey) || '未配置')}</div>
            </div>
            <div className="space-y-1.5 rounded-lg border border-dashed p-3">
              <div className="text-xs text-muted-foreground">识别模式</div>
              <div className="text-sm">{endpointMeta?.label ?? endpoint}</div>
              <p className="text-xs text-muted-foreground">{endpointMeta?.description}</p>
            </div>
            <div className="space-y-1.5 rounded-lg border border-dashed p-3">
              <div className="text-xs text-muted-foreground">资源模型</div>
              <div className="text-sm">{resourcePresetLabel}</div>
            </div>
            <div className="space-y-1.5 rounded-lg border border-dashed p-3">
              <div className="text-xs text-muted-foreground">Resource ID</div>
              <div className="font-mono text-sm">{resourceId || '未配置'}</div>
            </div>
            <div className="space-y-1.5 rounded-lg border border-dashed p-3">
              <div className="text-xs text-muted-foreground">识别语言</div>
              <div className="text-sm">{VOLCANO_LANGUAGE_OPTIONS.find((item) => item.value === language)?.label ?? language}</div>
              <p className="text-xs text-muted-foreground">
                官方文档说明 `audio.language` 目前仅 `bigmodel_nostream` 支持。
              </p>
            </div>
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground md:col-span-2">
              <div className="font-medium text-foreground">模型名固定</div>
              <div>request.model_name = {VOLCANO_MODEL_NAME}</div>
              <div>官方当前通过 Resource ID 切换 1.0 / 2.0 资源模型。</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { void navigate({ to: '/settings' }); }}
            >
              前往设置页
            </Button>
            <span className="text-xs text-muted-foreground">
              测试页保留为诊断工具，核心火山配置请在设置页修改。
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">测试参数</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enableNonstream}
                onChange={(event) => setEnableNonstream(event.target.checked)}
                disabled={endpoint !== 'bigmodel_async'}
              />
              二遍识别（仅 async 推荐）
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showUtterances}
                onChange={(event) => setShowUtterances(event.target.checked)}
              />
              输出分句信息
            </label>
            <div className="space-y-1.5">
              <label htmlFor="volcano-end-window-size" className="text-xs text-muted-foreground">判停阈值(ms)</label>
              <Input
                id="volcano-end-window-size"
                type="number"
                min={200}
                step={100}
                value={String(endWindowSize)}
                disabled={endpoint !== 'bigmodel_async'}
                onChange={(event) => setEndWindowSize(Number.parseInt(event.target.value || '0', 10) || 0)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="volcano-force-to-speech-time" className="text-xs text-muted-foreground">最短语音时长(ms)</label>
              <Input
                id="volcano-force-to-speech-time"
                type="number"
                min={1}
                step={100}
                value={String(forceToSpeechTime)}
                disabled={endpoint !== 'bigmodel_async'}
                onChange={(event) => setForceToSpeechTime(Number.parseInt(event.target.value || '0', 10) || 0)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleSaveTestOptions}>
              保存测试参数
            </Button>
            {testOptionsSaved && <span className="text-xs text-green-600">已保存</span>}
          </div>
        </CardContent>
      </Card>

      <Card
        className={cn(
          'shadow-sm',
          isConfigured ? 'border-green-500/30 bg-green-50 dark:bg-green-950/20' : 'border-red-500/30 bg-red-50 dark:bg-red-950/20'
        )}
      >
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <span className="text-sm font-medium">火山引擎大模型语音识别</span>
            <p className="text-xs text-muted-foreground">
              {isTauri ? 'Rust WebSocket → openspeech.bytedance.com' : 'Bun 后端代理 → openspeech.bytedance.com'}
            </p>
            <p className="text-xs text-muted-foreground">
              当前模式：{endpointMeta?.label} | 当前资源：{resourceId}
            </p>
          </div>
          <span
            className={cn(
              'rounded-md px-2 py-0.5 text-xs font-semibold',
              isConfigured ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
            )}
          >
            {isConfigured ? '就绪' : '未配置'}
          </span>
        </CardContent>
      </Card>

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
          <div className="mt-2 animate-pulse text-sm text-muted-foreground">
            正在调用 {endpoint}...
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

      {result && (
        <Card className="border-green-500/30 bg-green-50 shadow-sm dark:bg-green-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-green-700 dark:text-green-400">识别结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <p className="exomind-selectable text-lg font-medium">{result.text || '（无识别结果）'}</p>
            <div className="text-xs text-muted-foreground">
              {result.confidence && `置信度: ${(result.confidence * 100).toFixed(1)}%`}
              {result.duration != null && ` | 时长: ${result.duration.toFixed(2)}ms`}
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

      <Card className="shadow-sm">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">运行日志</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setLogs([])}>
            清空
          </Button>
        </CardHeader>
        <CardContent className="exomind-selectable space-y-2 pt-0 font-mono text-xs">
          {logs.map((log, index) => (
            <div key={`${log.time}-${index}`} className="leading-relaxed">
              <span className="text-muted-foreground">[{log.time}]</span>{' '}
              <span className="text-foreground">{log.message}</span>
              {log.text && (
                <div className="mt-1 rounded-md border-l-4 border-green-500 bg-green-50 px-3 py-2 text-sm text-foreground dark:bg-green-950/20">
                  {log.text}
                </div>
              )}
            </div>
          ))}
          {logs.length === 0 && <div className="text-muted-foreground">暂无日志</div>}
        </CardContent>
      </Card>
    </div>
  );
}
