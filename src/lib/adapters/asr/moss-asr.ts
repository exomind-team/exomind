/**
 * MOSS ASR Adapter - MOSS Transcribe-Diarize 语音识别适配器
 *
 * ┌─────────────────────────────────────────┐
 * │  L1 Adapter                             │
 * │  ─────────────────────────────────     │
 * │  直接调用 MOSS HTTP API                 │
 * │  无需后端服务                           │
 * └─────────────────────────────────────────┘
 *
 * 特点：
 * - 纯前端调用，无需后端
 * - HTTP RESTful 接口
 * - 支持 Base64 编码音频
 * - 返回带时间戳和说话人标识
 */

import type { IASRPort, IASRConfig, ASRInput, ASRResult, ASRPartialResult } from '../../ports/asr-port';
import { log } from '@/lib/logger';

// ========== 配置 ==========

export interface MOSSASRConfig {
  /** API Key */
  apiKey: string;
  /** API 端点 */
  apiUrl?: string;
  /** 超时时间 (毫秒) */
  timeout?: number;
}

/**
 * MOSS ASR 识别结果（包含音频数据）
 */
export interface MOSSASRResult extends ASRResult {
  /** 录制的音频数据 (WAV格式) */
  audioData?: Uint8Array;
}

/**
 * MOSS ASR 输入（支持预录制音频）
 */
export interface MOSSASRInput extends ASRInput {
  /** 预录制的音频数据（WAV格式），如果提供则跳过录制 */
  preRecordedAudio?: Uint8Array;
}

const DEFAULT_CONFIG: Partial<MOSSASRConfig> = {
  apiUrl: 'https://studio.mosi.cn/v1/audio/transcriptions',
  timeout: 60000, // 60秒超时（音频处理可能较慢）
};

const MOSS_API_KEY_STORAGE_KEY = 'moss_api_key';

function normalizeApiKey(value?: string): string {
  if (!value) return '';

  let normalized = value.trim();
  normalized = normalized.replace(/^['"]|['"]$/g, '');
  normalized = normalized.replace(/^Bearer\s+/i, '');
  return normalized.trim();
}

function readStoredApiKey(): string {
  const storage = (() => {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      return window.localStorage;
    }

    const globalStorage = (globalThis as { localStorage?: Storage }).localStorage;
    if (typeof globalStorage !== 'undefined') {
      return globalStorage;
    }

    return null;
  })();

  if (!storage) {
    return '';
  }

  try {
    return normalizeApiKey(storage.getItem(MOSS_API_KEY_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

// ========== 适配器实现 ==========

export class MOSSASRAdapter implements IASRPort {
  private config: MOSSASRConfig;

  constructor(config?: Partial<MOSSASRConfig>) {
    const envApiKey = normalizeApiKey(import.meta.env?.VITE_MOSS_API_KEY || '');
    const localApiKey = readStoredApiKey();
    const incomingApiKey = normalizeApiKey(config?.apiKey);

    this.config = {
      ...DEFAULT_CONFIG,
      apiKey: incomingApiKey || localApiKey || envApiKey,
      ...config,
    };
    this.config.apiKey = normalizeApiKey(this.config.apiKey);
    log.info('[ASR-MOSS] 适配器初始化');
    log.info(`[ASR-MOSS] API Key: ${this.config.apiKey ? `${this.config.apiKey.slice(0, 8)}***` : '未配置'}`);
  }

  /**
   * 配置适配器
   */
  configure(config: IASRConfig): void {
    if (config.apiKey) this.config.apiKey = normalizeApiKey(config.apiKey);
    if (config.apiUrl) this.config.apiUrl = config.apiUrl;
    if (config.timeout) this.config.timeout = config.timeout;
  }

  private resolveApiKey(): string {
    const explicit = normalizeApiKey(this.config.apiKey);
    if (explicit) {
      return explicit;
    }

    const local = readStoredApiKey();
    if (local) {
      this.config.apiKey = local;
      return local;
    }

    const fromEnv = normalizeApiKey(import.meta.env?.VITE_MOSS_API_KEY || '');
    if (fromEnv) {
      this.config.apiKey = fromEnv;
      return fromEnv;
    }

    return '';
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages(): string[] {
    return ['zh-CN', 'en-US', 'yue-HK'];
  }

  /**
   * WebM 转 WAV（公共静态方法）
   * 不做重采样，不做增益
   */
  static async webmToWav(webmBlob: Blob): Promise<Uint8Array> {
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const rawData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;

    // PCM 16bit（只裁剪，不放大）
    const pcmData = new Int16Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      const s = Math.max(-1, Math.min(1, rawData[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const wavData = MOSSASRAdapter.encodeWAV(new Uint8Array(pcmData.buffer), sampleRate);
    await audioContext.close();
    return wavData;
  }

  /**
   * 编码为 WAV 格式（公共静态方法）
   * @param samples PCM 16bit 音频数据
   * @param sampleRate 采样率
   */
  static encodeWAV(samples: Uint8Array, sampleRate: number): Uint8Array {
    const numChannels = 1;
    const bytesPerSample = 2;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + dataSize, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    // fmt chunk
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    // data chunk
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, dataSize, true);

    new Uint8Array(buffer).set(samples, 44);
    return new Uint8Array(buffer);
  }

  isAvailable(): boolean {
    return !!this.resolveApiKey();
  }

  /**
   * 一次性语音识别
   *
   * 流程：
   * 1. 录制音频 → WAV 格式（如果提供了 preRecordedAudio 则跳过）
   * 2. 转换为 Base64
   * 3. 发送到 MOSS API (JSON)
   * 4. 返回带时间戳和说话人标识的结果（包含音频数据）
   */
  async transcribe(input: MOSSASRInput): Promise<MOSSASRResult> {
    log.info('[ASR-MOSS] 开始识别');
    const startTime = Date.now();
    const apiKey = this.resolveApiKey();

    if (!apiKey) {
      throw new Error('MOSS API Key 未配置，请先在设置页输入分组保存 Token');
    }

    let audioData: Uint8Array;

    if (input.preRecordedAudio) {
      // 使用预录制的音频
      audioData = input.preRecordedAudio;
      log.info(`[ASR-MOSS] 使用预录制音频: ${audioData.length} bytes`);
    } else if (input.stream) {
      // 录制音频
      audioData = await this.recordAudio(input.stream);
      log.info(`[ASR-MOSS] 音频录制完成: ${audioData.length} bytes`);
    } else {
      throw new Error('需要传入 MediaStream 或 preRecordedAudio');
    }

    if (audioData.length === 0) {
      throw new Error('音频录制失败：没有录制到音频数据');
    }

    // 转换为 Base64 (和 Python 示例一致)
    const base64Audio = this.arrayBufferToBase64(audioData);
    const audioPayload = `data:audio/wav;base64,${base64Audio}`;
    log.info(`[ASR-MOSS] Base64 长度: ${base64Audio.length} chars`);

    // 构建请求 (和 Python 示例一致)
    const payload = {
      model: 'moss-transcribe-diarize',
      audio_data: audioPayload,
      sampling_params: {
        max_new_tokens: 1024,
        temperature: 0.0,
      },
    };

    log.info('[ASR-MOSS] 发送请求到 MOSS API...');
    log.info(`[ASR-MOSS] 请求详情: ${JSON.stringify({ url: this.config.apiUrl, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey.slice(0, 8)}***` }, bodySize: JSON.stringify(payload).length })}`);

    let response: Response;
    try {
      // 调用 MOSS API
      response = await fetch(this.config.apiUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeout || 60000),
      });

      log.info(`[ASR-MOSS] 响应状态: ${response.status} ${response.statusText}`);
    } catch (networkError) {
      // 网络错误处理（Failed to fetch, CORS, 网络断开等）
      const errorMessage = networkError instanceof Error ? networkError.message : String(networkError);
      log.error(`[ASR-MOSS] 网络错误: ${JSON.stringify({ error: errorMessage, type: networkError instanceof TypeError ? 'TypeError (可能是 CORS 或网络问题)' : 'UnknownError', url: this.config.apiUrl, isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : 'N/A', userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A' })}`);

      // 提供更友好的错误提示
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('fetch')) {
        throw new Error(`网络请求失败，请检查网络连接或 CORS 设置。\n可能原因：\n1. 网络连接不稳定\n2. API 服务器 (${this.config.apiUrl}) 无法访问\n3. 浏览器跨域 (CORS) 限制\n4. 代理服务器拦截了请求\n\n建议：\n- 确保网络连接正常\n- 确认 API 服务器地址正确\n- 检查浏览器控制台是否有 CORS 错误`);
      }

      throw new Error(`网络请求失败: ${errorMessage}`);
    }

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        // 克隆响应以支持多次读取
        const clonedResponse = response.clone();
        try {
          const error = await clonedResponse.json();
          log.error(`[ASR-MOSS] 错误响应: ${JSON.stringify(error)}`);
          errorMsg = error.message || errorMsg;
        } catch {
          // JSON 解析失败，尝试获取文本
          const text = await clonedResponse.text();
          log.error(`[ASR-MOSS] 错误响应文本: ${text}`);
          errorMsg = text || errorMsg;
        }
      } catch (e) {
        log.error(`[ASR-MOSS] 读取错误响应失败: ${e}`);
      }
      throw new Error(`识别失败: ${errorMsg}`);
    }

    const mossResponse = await response.json();
    log.info(`[ASR-MOSS] 原始响应: ${JSON.stringify(mossResponse)}`);

    const duration = Date.now() - startTime;

    // 解析 MOSS 返回结果
    const result = this.parseMOSSResult(mossResponse);
    log.info(`[ASR-MOSS] 识别完成: "${result.text}" (${duration}ms)`);

    // 返回结果和音频数据
    return {
      ...result,
      audioData,
    };
  }

  /**
   * 解析 MOSS API 返回结果
   */
  private parseMOSSResult(mossResponse: any): ASRResult {
    const transcription = mossResponse.asr_transcription_result;
    if (!transcription) {
      return {
        text: '',
        confidence: 0,
        lang: 'zh-CN',
      };
    }

    // 优先使用 full_text，否则从 segments 拼接
    let fullText = transcription.full_text || '';
    const segments = transcription.segments || [];

    // 如果 full_text 为空，从 segments 拼接
    if (!fullText && segments.length > 0) {
      fullText = segments.map((s: any) => s.text || '').join(' ');
    }

    // 计算置信度（基于分段数量和文本质量）
    const confidence = segments.length > 0 && fullText.length > 0 ? 0.9 : 0.5;

    // 解析语言（根据文本内容判断）
    const lang = this.detectLanguage(fullText);

    // 计算音频时长
    let duration = 0;
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      duration = (parseFloat(lastSegment.end_s) || 0) * 1000;
    }

    log.info(`[ASR-MOSS] 解析结果: ${JSON.stringify({ text: fullText, segmentsCount: segments.length, confidence, duration })}`);

    return {
      text: fullText,
      confidence,
      lang,
      duration,
    };
  }

  /**
   * 检测语言
   */
  private detectLanguage(text: string): string {
    if (!text) return 'zh-CN';
    // 简单的中英文检测
    const chinesePattern = /[\u4e00-\u9fa5]/;
    const englishPattern = /[a-zA-Z]/;
    const chineseCount = (text.match(chinesePattern) || []).length;
    const englishCount = (text.match(englishPattern) || []).length;
    return chineseCount > englishCount ? 'zh-CN' : 'en-US';
  }

  /**
   * ArrayBuffer 转 Base64
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < buffer.length; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }

  /**
   * 从 MediaStream 录制音频并转换为 WAV 格式
   */
  private async recordAudio(stream: MediaStream, _stopRecording?: () => void): Promise<Uint8Array> {
    return new Promise((resolve) => {
      log.info('[ASR-MOSS] 创建 AudioContext...');
      // 使用浏览器默认采样率（通常是 44100 或 48000）
      const audioContext = new AudioContext();
      const sourceSampleRate = audioContext.sampleRate;
      log.info(`[ASR-MOSS] AudioContext 采样率: ${sourceSampleRate}Hz`);

      // 确保 AudioContext 处于 running 状态
      if (audioContext.state === 'suspended') {
        log.info('[ASR-MOSS] AudioContext 被挂起，尝试 resume...');
        audioContext.resume().then(() => {
          log.info('[ASR-MOSS] AudioContext 已 resume');
        }).catch(e => {
          log.info(`[ASR-MOSS] resume 失败: ${e}`);
        });
      }

      const mediaStreamSource = audioContext.createMediaStreamSource(stream);
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      let isStopped = false;
      let chunkCount = 0;
      const chunks: Float32Array[] = [];

      scriptProcessor.onaudioprocess = (event) => {
        if (isStopped) return;
        const inputData = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(inputData));
        chunkCount++;
        if (chunkCount % 10 === 0) {
          log.info(`[ASR-MOSS] 已录制 ${chunkCount} 个音频块`);
        }
      };

      // ScriptProcessor 必须有输出连接才能工作
      // 连接到一个静音的 gain 节点（不产生回声，但保持处理器活跃）
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;  // 静音输出（避免回声）
      silentGain.connect(audioContext.destination);
      mediaStreamSource.connect(scriptProcessor);
      scriptProcessor.connect(silentGain);

      const stopRecording = async () => {
        if (isStopped) return;
        isStopped = true;

        log.info(`[ASR-MOSS] 停止录制，共录制 ${chunkCount} 个块，${chunks.length} 个 chunk`);

        try {
          scriptProcessor.disconnect();
          mediaStreamSource.disconnect();
          await audioContext.close();
        } catch (e) {
          log.info(`[ASR-MOSS] 关闭 AudioContext 时出错: ${e}`);
        }

        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        log.info(`[ASR-MOSS] 总采样数: ${totalLength} (${sourceSampleRate}Hz)`);

        if (totalLength === 0) {
          log.warn('[ASR-MOSS] 警告：没有录制到音频数据！');
          resolve(new Uint8Array(0));
          return;
        }

        const result = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }

        // 重采样：从 sourceSampleRate 降到 16000Hz（ASR 标准）
        const targetSampleRate = 16000;
        let resampled: Float32Array;

        if (sourceSampleRate === targetSampleRate) {
          // 已经是目标采样率
          resampled = result;
        } else {
          const ratio = sourceSampleRate / targetSampleRate;  // 如 48000/16000 = 3
          const targetLength = Math.floor(totalLength / ratio);
          resampled = new Float32Array(targetLength);
          for (let i = 0; i < targetLength; i++) {
            resampled[i] = result[Math.floor(i * ratio)];
          }
          log.info(`[ASR-MOSS] 重采样完成: ${totalLength} → ${targetLength} 采样`);
        }

        // 转换为 PCM 16bit
        const pcmData = new Int16Array(resampled.length);
        for (let i = 0; i < resampled.length; i++) {
          // 音量增强：放大 4 倍（解决声音偏小问题）
          let s = resampled[i] * 4;
          // 裁剪到 [-1, 1]
          s = Math.max(-1, Math.min(1, s));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // 编码为 WAV（使用 16000Hz 采样率）
        const wavData = MOSSASRAdapter.encodeWAV(new Uint8Array(pcmData.buffer), targetSampleRate);
        log.info(`[ASR-MOSS] WAV 编码完成: ${wavData.length} bytes (${targetSampleRate}Hz, ${(wavData.length / 1024).toFixed(2)}KB)`);
        resolve(wavData);
      };

      // 等待 AudioContext resume 后再开始检测停止信号
      const startListening = () => {
        log.info('[ASR-MOSS] 开始录制音频...');

        // 等待停止信号（无限时间）
        const checkStop = setInterval(() => {
          if (!(window as any).__asrRecordingActive) {
            clearInterval(checkStop);
            // 调用外部传入的停止回调
            if (typeof stopRecording === 'function') {
              stopRecording();
            }
          }
        }, 100);
      };

      // 如果 AudioContext 已经 running，立即开始
      if (audioContext.state === 'running') {
        startListening();
      } else if (audioContext.state === 'suspended') {
        // 等待 resume 完成
        audioContext.resume().then(startListening);
      } else {
        startListening();
      }
    });
  }

  async *streamTranscribe(_input: ASRInput): AsyncIterable<ASRPartialResult> {
    throw new Error('MOSS Adapter 不支持流式识别');
  }
}

// ========== 工厂函数 ==========

let adapter: MOSSASRAdapter | null = null;

export function getMOSSAdapter(): MOSSASRAdapter {
  if (!adapter) {
    adapter = new MOSSASRAdapter();
  }
  return adapter;
}
