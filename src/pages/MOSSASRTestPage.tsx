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
import { getEventLogService } from '@/lib/services';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

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
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          const handleRecorderStop = () => {
            resolve();
          };

          recorder.addEventListener('stop', handleRecorderStop, { once: true });
          recorder.stop();
        });
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

    // 自动添加到事件日志
    const eventLogService = getEventLogService();
    eventLogService.addEvent(text).then(() => {
      addLogEntry('📝 已自动添加到事件日志');
    }).catch((err) => {
      addLogEntry(`⚠️ 添加到事件日志失败: ${err}`);
    });
  };

  const voiceButtonAdapterConfig = apiKey ? { apiKey } : undefined;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">MOSS 语音识别测试</h1>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">MOSS API Key 配置</CardTitle>
          <p className="text-xs text-muted-foreground">
            申请地址:{' '}
            <a
              href="https://studio.mosi.cn/"
              target="_blank"
              rel="noreferrer"
              className="text-brand underline underline-offset-4"
            >
              https://studio.mosi.cn/
            </a>
          </p>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="space-y-1">
            <Label htmlFor="moss-api-key">API Key</Label>
            <div className="flex gap-2">
              <Input
                id="moss-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                className="font-mono"
              />
              <Button type="button" variant="brand" onClick={handleSaveApiKey}>
                保存
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {apiKey ? '✓ 已配置' : '✗ 未配置'}
            {apiKey && ` (${apiKey.slice(0, 4)}...${apiKey.slice(-4)})`}
          </div>
        </CardContent>
      </Card>

      <Card
        className={cn(
          "shadow-sm",
          isAvailable ? "border-success/30 bg-success/10" : "border-destructive/30 bg-destructive/10"
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">MOSS Transcribe-Diarize</CardTitle>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-semibold",
                isAvailable
                  ? "bg-success text-success-foreground"
                  : "bg-destructive text-destructive-foreground"
              )}
            >
              {isAvailable ? '就绪' : '未配置'}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {isAvailable ? '直接调用 MOSS HTTP API，无需后端服务' : '请在上方配置 API Key'}
          </p>
        </CardHeader>
      </Card>

      {recordingState === 'idle' && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">录音方式</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => setRecordingMethod('scriptProcessor')}
                disabled={!isAvailable}
                variant={recordingMethod === 'scriptProcessor' ? 'brand' : 'outline'}
                className="flex-1 h-auto py-2 px-3 flex-col items-start gap-0"
              >
                <span className="text-sm">ScriptProcessor</span>
                <span className="text-xs opacity-80">WAV，~100KB/3秒</span>
              </Button>
              <Button
                type="button"
                onClick={() => setRecordingMethod('mediaRecorder')}
                disabled={!isAvailable}
                variant={recordingMethod === 'mediaRecorder' ? 'brand' : 'outline'}
                className="flex-1 h-auto py-2 px-3 flex-col items-start gap-0"
              >
                <span className="text-sm">MediaRecorder</span>
                <span className="text-xs opacity-80">WebM，~40KB/3秒</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
        <CardContent className="p-4 text-sm">
          <span className="font-semibold">状态：</span> {connectionStatus}
        </CardContent>
      </Card>

      <div
        className={cn(
          "rounded-xl border p-6 text-center",
          recordingState === 'recording'
            ? "border-destructive/30 bg-destructive/10"
            : result
              ? "border-success/30 bg-success/10"
              : "bg-muted"
        )}
      >
        <div className="text-lg font-medium mb-2">
          {recordingState === 'recording' ? '🔴 录音中...' : result ? '✓ 识别完成' : '🎤 点击开始录音'}
        </div>
        {recordingState === 'recording' && (
          <div className="font-mono text-4xl font-bold text-destructive">
            {duration.toFixed(1)}s
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {recordingState === 'idle' && !result && (
          <Button
            type="button"
            onClick={handleStart}
            disabled={!isAvailable}
            variant="brand"
            className="flex-1 h-auto py-6 text-lg"
          >
            🎤 开始录音
          </Button>
        )}

        {recordingState === 'recording' && (
          <Button
            type="button"
            onClick={handleStop}
            variant="destructive"
            className="flex-1 h-auto py-6 text-lg"
          >
            ⏹ 停止并识别
          </Button>
        )}

        {result && (
          <Button
            type="button"
            onClick={handleReset}
            variant="brand"
            className="flex-1 h-auto py-6 text-lg"
          >
            🔄 重新录音
          </Button>
        )}
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">🎤 语音输入</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start gap-6">
            <div className="shrink-0 self-center sm:self-start">
              <VoiceInputButton
                adapterConfig={voiceButtonAdapterConfig}
                onResult={handleVoiceResult}
                onError={(err) => addLogEntry(`❌ ${err}`)}
                onStateChange={(state) => {
                  if (state === 'recording') {
                    addLogEntry('🎤 开始录音');
                  } else if (state === 'recognizing') {
                    addLogEntry('⏳ 识别中...');
                  } else if (state === 'completed') {
                    addLogEntry('✅ 识别完成');
                  }
                }}
                showWaveform={true}
                showTimer={true}
                enableShortcut={true}
                size={72}
              />
            </div>

            <div className="flex-1 space-y-2">
              <Textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="点击上方麦克风按钮开始语音输入..."
                className="min-h-20 resize-y"
              />
              {inputText && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(inputText)}
                  >
                    复制
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInputText('')}
                  >
                    清空
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            <strong className="text-warning">快捷键提示：</strong>
            <ul className="mt-2 list-disc pl-5">
              <li>[空格键] 开始/停止录音</li>
              <li>[Esc] 取消录音</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="shadow-sm border-success/30 bg-success/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-success">识别结果</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <p className="text-lg font-medium">{result.text || '（无识别结果）'}</p>
            <div className="text-xs text-muted-foreground">
              {result.confidence && `置信度: ${(result.confidence * 100).toFixed(1)}%`}
              {result.duration && ` | 时长: ${(result.duration / 1000).toFixed(2)}秒`}
              {result.lang && ` | 语言: ${result.lang}`}
            </div>
            {audioUrl && (
              <Button type="button" asChild variant="brand" size="sm" className="w-fit">
                <a href={audioUrl} download={`moss-recording-${Date.now()}.wav`}>
                  ⬇️ 下载录音文件
                </a>
              </Button>
            )}
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
        <CardContent className="pt-0 font-mono text-xs space-y-2">
          {logs.map((log, i) => (
            <div key={i} className="leading-relaxed">
              <span className="text-muted-foreground">[{log.time}]</span>{' '}
              <span className="text-foreground">{log.message}</span>
              {log.duration !== undefined && (
                <span className="text-muted-foreground ml-2">
                  ({log.duration.toFixed(1)}秒)
                </span>
              )}
              {log.text && (
                <div className="mt-1 rounded-md border-l-4 border-success bg-success/10 px-3 py-2 text-sm text-foreground">
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
