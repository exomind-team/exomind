/**
 * 语音识别测试页面
 * 使用浏览器原生 Web Speech API 进行测试
 */

import { useEffect, useRef, useState } from 'react';
import type { ASRResult } from '../lib/ports/asr-port';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

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
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">语音识别测试</h1>

      <div
        className={cn(
          "rounded-lg border p-3 text-center text-sm",
          status === 'success'
            ? "border-success/30 bg-success/10"
            : status === 'error'
              ? "border-destructive/30 bg-destructive/10"
              : status === 'recording'
                ? "border-brand/30 bg-brand/10"
                : "bg-muted"
        )}
      >
        {status === 'idle' && '点击“开始录音”'}
        {status === 'ready' && '✓ 准备就绪'}
        {status === 'recording' && '🔴 录音中...请说话'}
        {status === 'success' && '✓ 识别完成'}
        {status === 'error' && '✗ 出错了'}
      </div>

      <div className="flex gap-3">
        {!apiAvailable ? (
          <Button type="button" disabled className="flex-1 h-auto py-4 text-lg">
            浏览器不支持语音识别
          </Button>
        ) : status === 'success' || status === 'error' ? (
          <Button type="button" variant="brand" onClick={reset} className="flex-1 h-auto py-4 text-lg">
            🔄 重新开始
          </Button>
        ) : status === 'recording' ? (
          <Button
            type="button"
            variant="destructive"
            onClick={toggleRecording}
            className="flex-1 h-auto py-4 text-lg"
          >
            ⏹ 点击停止
          </Button>
        ) : (
          <Button
            type="button"
            variant="brand"
            onClick={toggleRecording}
            className="flex-1 h-auto py-4 text-lg"
          >
            🎤 点击开始录音
          </Button>
        )}
      </div>

      {result && (
        <Card className="shadow-sm border-success/30 bg-success/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-success">识别结果</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <p className="text-lg">{result.text}</p>
            <p className="text-xs text-muted-foreground">
              置信度: {(result.confidence * 100).toFixed(1)}% | 语言: {result.lang}
            </p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="shadow-sm border-destructive/30 bg-destructive/10">
          <CardContent className="p-4 text-sm text-destructive">
            错误: {error}
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">运行日志</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 font-mono text-xs text-brand space-y-1">
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
          {logs.length === 0 && <span className="text-muted-foreground">暂无日志</span>}
        </CardContent>
      </Card>

      <Card className="shadow-sm border-brand/20 bg-brand/10">
        <CardContent className="p-4 text-xs text-brand">
          <span className="font-semibold">Web Speech API 状态：</span>
          <br />
          {apiAvailable ? '✓ 浏览器支持语音识别' : '✗ 浏览器不支持语音识别（请使用 Chrome/Edge/Safari）'}
        </CardContent>
      </Card>
    </div>
  );
}
