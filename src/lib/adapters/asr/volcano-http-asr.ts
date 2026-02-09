/**
 * VolcanoHTTPASRAdapter - 火山引擎 ASR HTTP 适配器
 *
 * ┌─────────────────────────────────────────┐
 * │  L1 Adapter                             │
 * │  ─────────────────────────────────     │
 * │  调用本地 Bun 后端服务                  │
 * │  后端服务再调用火山引擎 API              │
 * └─────────────────────────────────────────┘
 *
 * 架构：
 *   前端 (Adapter) → Bun 后端服务 → 火山引擎
 *
 * 解决浏览器无法设置 WebSocket 认证头部的问题
 */

import type { IASRPort, ASRInput, ASRResult, ASRPartialResult } from '../../environment/interfaces/asr.port';

// ========== 配置 ==========

export interface VolcanoHTTPASRConfig {
  /** 后端服务地址 */
  serverUrl: string;
  /** 超时时间 (毫秒) */
  timeout?: number;
}

const DEFAULT_CONFIG: VolcanoHTTPASRConfig = {
  serverUrl: (import.meta.env?.VITE_ASR_SERVER_URL as string) || 'http://localhost:1949',
  timeout: 30000, // 30秒超时
};

// ========== 适配器实现 ==========

export class VolcanoHTTPASRAdapter implements IASRPort {
  private config: VolcanoHTTPASRConfig;

  constructor(config?: Partial<VolcanoHTTPASRConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log('[ASR-HTTP] 适配器初始化');
    console.log('[ASR-HTTP] 后端服务:', this.config.serverUrl);
  }

  /**
   * 检查后端服务是否可用
   * 注意：IASRPort 接口要求 isAvailable() 是同步的
   */
  isAvailable(): boolean {
    // 先检查基本配置
    if (!this.config.serverUrl) {
      console.warn('[ASR-HTTP] 后端服务地址未配置');
      return false;
    }
    // 异步检查会通过配置检查先返回
    this.checkServerHealth();
    return true;
  }

  /**
   * 异步检查后端服务健康状态
   */
  private async checkServerHealth(): Promise<void> {
    try {
      const response = await fetch(`${this.config.serverUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        console.warn('[ASR-HTTP] 后端服务返回异常状态');
      }
    } catch {
      console.warn('[ASR-HTTP] 后端服务不可用');
    }
  }

  getSupportedLanguages(): string[] {
    return ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];
  }

  /**
   * 一次性语音识别
   *
   * 流程：
   * 1. 录制音频 → WAV/PCM 格式
   * 2. 发送到本地 Bun 后端
   * 3. 后端转发到火山引擎
   * 4. 返回识别结果
   */
  async transcribe(input: ASRInput): Promise<ASRResult> {
    console.log('[ASR-HTTP] 开始识别');
    const startTime = Date.now();

    if (!input.stream) {
      throw new Error('需要传入 MediaStream');
    }

    // 从 MediaStream 录制音频
    const audioData = await this.recordAudio(input.stream);

    console.log(`[ASR-HTTP] 音频录制完成: ${audioData.length} bytes`);

    // 发送到后端
    const response = await fetch(`${this.config.serverUrl}/api/asr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: audioData,
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[ASR-HTTP] 识别失败:', error);
      throw new Error(`识别失败: ${error}`);
    }

    const result = await response.json() as ASRResult;
    const duration = Date.now() - startTime;

    console.log(`[ASR-HTTP] 识别完成: "${result.text}" (${duration}ms)`);

    return result;
  }

  /**
   * 保存音频文件到本地
   */
  private async saveAudioFile(audioData: Uint8Array): Promise<string> {
    console.log(`[ASR-HTTP] 音频录制完成: ${audioData.length} bytes（由后端保存到 ~/.exomind/asr/）`);
    return '';
  }

  /**
   * 从 MediaStream 录制音频并转换为 PCM 格式
   */
  private async recordAudio(stream: MediaStream): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const mediaStreamSource = audioContext.createMediaStreamSource(stream);
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      let isStopped = false;
      const chunks: Float32Array[] = [];

      scriptProcessor.onaudioprocess = (event) => {
        if (isStopped) return;
        const inputData = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(inputData));
      };

      mediaStreamSource.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      // 停止录制函数
      const stopRecording = async () => {
        if (isStopped) return;
        isStopped = true;

        try {
          scriptProcessor.disconnect();
          mediaStreamSource.disconnect();
          await audioContext.close();
        } catch (e) {
          // 忽略关闭错误
        }

        // 合并所有音频数据
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (totalLength === 0) {
          resolve(new Uint8Array(0));
          return;
        }

        const result = new Float32Array(totalLength);
        let offset = 0;

        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }

        // 转换为 PCM 16bit
        const pcmData = new Int16Array(totalLength);
        for (let i = 0; i < totalLength; i++) {
          const s = Math.max(-1, Math.min(1, result[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const audioBytes = new Uint8Array(pcmData.buffer);

        console.log(`[ASR-HTTP] 音频转换完成: ${pcmData.length} samples`);

        // 保存音频文件
        await this.saveAudioFile(audioBytes);

        resolve(audioBytes);
      };

      // 开始录制
      console.log('[ASR-HTTP] 开始录制音频...');

      // 录制 3 秒或手动停止
      const recordingTimeout = setTimeout(() => {
        console.log('[ASR-HTTP] 录制超时，自动停止');
        stopRecording();
      }, 3000);

      // 外部停止机制
      (window as any).__asrRecordingStop = () => {
        clearTimeout(recordingTimeout);
        stopRecording();
      };

      // 监听停止信号
      const checkStop = setInterval(() => {
        if (!(window as any).__asrRecordingActive) {
          clearInterval(checkStop);
          clearTimeout(recordingTimeout);
          stopRecording();
        }
      }, 100);
    });
  }

  /**
   * 停止录制（HTTP 模式下由超时自动触发）
   * 保留接口一致性
   */
  stopRecording(): void {
    // HTTP 模式下录制由超时控制，此方法为空
    console.log('[ASR-HTTP] 停止录制信号（HTTP 模式由超时控制）');
  }

  /**
   * 流式识别（暂未实现）
   */
  async *streamTranscribe(_input: ASRInput): AsyncIterable<ASRPartialResult> {
    throw new Error('HTTP Adapter 不支持流式识别');
  }
}

// ========== 工厂函数 ==========

let adapter: VolcanoHTTPASRAdapter | null = null;

export function getVolcanoHTTPAdapter(): VolcanoHTTPASRAdapter {
  if (!adapter) {
    adapter = new VolcanoHTTPASRAdapter();
  }
  return adapter;
}
