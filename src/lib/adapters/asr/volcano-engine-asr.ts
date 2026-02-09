/**
 * VolcanoEngineASRAdapter - 火山引擎语音识别适配器
 *
 * ┌─────────────────────────────────────────┐
 * │  L1 Adapter                             │
 * │  ─────────────────────────────────     │
 * │  内部调用火山引擎云端 API               │
 * │  外部统一接口（IASRPort）              │
 * └─────────────────────────────────────────┘
 *
 * 文档：https://www.volcengine.com/docs/6561/1354869
 *
 * ⚠️ 重要说明：
 * 火山引擎 ASR WebSocket API 需要在 HTTP 头部中传递认证信息：
 * - X-Api-App-Key
 * - X-Api-Access-Key
 * - X-Api-Resource-Id
 * - X-Api-Connect-Id
 *
 * 但浏览器不允许 WebSocket 连接设置自定义头部！
 * 因此需要通过后端代理访问，或者使用 Tauri native 功能。
 */

import type { IASRPort, ASRInput, ASRResult, ASRPartialResult } from '../../environment/interfaces/asr.port';

// ========== 配置 ==========

export interface VolcanoEngineASRConfig {
  /** 应用 ID (APP Key) */
  appKey: string;
  /** 访问密钥 (Access Key) */
  accessKey: string;
  /** 资源 ID */
  resourceId: string;
}

const DEFAULT_CONFIG: VolcanoEngineASRConfig = {
  appKey: (import.meta.env?.VITE_VOLCANO_APP_KEY as string) || '',
  accessKey: (import.meta.env?.VITE_VOLCANO_ACCESS_KEY as string) || '',
  resourceId: (import.meta.env?.VITE_VOLCANO_RESOURCE_ID as string) || 'volc.bigasr.sauc.duration',
};

// ========== 请求/响应 类型 ==========

interface ASRRequest {
  user: { uid: string };
  audio: { format: string; rate: number; bits: number; channel: number; language?: string };
  request: {
    model_name: string;
    enable_itn?: boolean;
    enable_punc?: boolean;
    show_utterances?: boolean;
  };
}

interface ASRResponse {
  code?: number;
  message?: string;
  result?: {
    text: string;
    utterances?: Array<{
      definite: boolean;
      start_time: number;
      end_time: number;
      text: string;
      words?: Array<{
        text: string;
        start_time: number;
        end_time: number;
      }>;
    }>;
  };
  audio_info?: { duration: number };
}

// ========== 工具函数 ==========

/**
 * 构建请求消息
 * 格式：4字节Header + 4字节PayloadSize + JSON Payload
 */
function buildRequestMessage(data: object): Uint8Array {
  const jsonStr = JSON.stringify(data);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const payloadSize = new Uint8Array(4);
  new DataView(payloadSize.buffer).setUint32(0, jsonBytes.length, false);
  // Header: version(4) + headerSize(4) + messageType(4) + flags(4) + serialization(4) + compression(4) + reserved(8)
  // 简化版本: version=1, headerSize=1 (4 bytes), messageType=1 (full client request), flags=0
  // serialization=1 (JSON), compression=0 (no compression)
  const header = new Uint8Array([
    0x11, // version=1, headerSize=1
    0x10, // messageType=1, flags=0
    0x10, // serialization=1(JSON), compression=0
    0x00, // reserved
  ]);
  return new Uint8Array([...header, ...payloadSize, ...jsonBytes]);
}

/**
 * 构建音频消息
 * 格式：4字节Header + 4字节Size + 音频数据
 */
function buildAudioMessage(audioData: Uint8Array, isLast: boolean = false): Uint8Array {
  // Header: version=1, headerSize=1, messageType=2 (audio only), flags
  // flags: 0 = normal, 2 = last packet (end marker)
  const flags = isLast ? 0x12 : 0x20;
  const header = new Uint8Array([
    0x11, // version=1, headerSize=1
    flags, // messageType=2, flags
    0x00, // serialization=0 (raw), compression=0
    0x00, // reserved
  ]);
  const sizeBytes = new Uint8Array(4);
  new DataView(sizeBytes.buffer).setUint32(0, audioData.length, false);
  return new Uint8Array([...header, ...sizeBytes, ...audioData]);
}

/**
 * 解析响应消息
 */
function parseResponseMessage(data: Uint8Array): ASRResponse {
  // 跳过 8 字节头部（4字节Header + 4字节Size 或 4字节Header + 4字节Sequence）
  const jsonBytes = data.subarray(8);
  const jsonStr = new TextDecoder().decode(jsonBytes);
  return JSON.parse(jsonStr);
}

// ========== 适配器实现 ==========

export class VolcanoEngineASRAdapter implements IASRPort {
  private config: VolcanoEngineASRConfig;
  private ws: WebSocket | null = null;
  private connectId: string = '';

  // 实时音频处理
  private audioContext: AudioContext | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private audioChunks: Float32Array[] = [];

  // 状态
  private isRecording = false;
  private onResult: ((result: ASRResult) => void) = () => {};
  private onError: ((error: Error) => void) = () => {};

  // Promise 管理
  private resolveResult: ((result: ASRResult) => void) | null = null;
  private rejectResult: ((error: Error) => void) | null = null;

  constructor(config?: Partial<VolcanoEngineASRConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log('[ASR-Volcano] 适配器初始化');
    console.log('[ASR-Volcano] AppKey:', this.config.appKey.slice(0, 8) + '***');
    console.log('[ASR-Volcano] ResourceId:', this.config.resourceId);

    if (!this.config.appKey || !this.config.accessKey) {
      console.warn('[ASR-Volcano] ⚠️ 缺少认证信息，请检查 .env 配置');
    }
  }

  isAvailable(): boolean {
    // 即使配置正确，浏览器也无法直接连接（需要后端代理）
    return !!(this.config.appKey && this.config.accessKey);
  }

  getSupportedLanguages(): string[] {
    return ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];
  }

  /**
   * 一次性识别
   */
  async transcribe(input: ASRInput): Promise<ASRResult> {
    console.log('[ASR-Volcano] 开始识别');
    console.log('[ASR-Volcano] 提示: 浏览器可能因 CORS 限制无法直接连接火山引擎 API');

    if (!input.stream) {
      throw new Error('需要传入 MediaStream');
    }

    // 创建一个 Promise 来等待结果
    const resultPromise = new Promise<ASRResult>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });

    // 设置回调
    this.onResult = (result: ASRResult) => {
      if (this.resolveResult) {
        this.resolveResult(result);
      }
    };
    this.onError = (error: Error) => {
      if (this.rejectResult) {
        this.rejectResult(error);
      }
    };

    // 开始识别
    this.connectAndRecognize(input.stream, input.lang);

    // 返回 Promise
    return resultPromise;
  }

  /**
   * 连接并开始识别
   */
  private async connectAndRecognize(stream: MediaStream, lang?: string): Promise<void> {
    this.connectId = crypto.randomUUID();

    console.log('[ASR-Volcano] 准备连接 WebSocket...');

    // 检查是否为 Tauri 环境（可以使用原生 HTTP）
    const isTauri = !!(window as any).__TAURI__;

    if (isTauri) {
      console.log('[ASR-Volcano] 检测到 Tauri 环境，可以使用原生 HTTP');
      // 在 Tauri 中可以使用 invoke 调用后端
      await this.connectWithTauri(stream, lang);
    } else {
      console.log('[ASR-Volcano] 浏览器环境，需要后端代理');
      await this.connectWithBrowser(stream, lang);
    }
  }

  /**
   * Tauri 环境连接（使用 Rust 后端）
   */
  private async connectWithTauri(stream: MediaStream, lang?: string): Promise<void> {
    try {
      // 通过 Tauri invoke 调用 Rust 后端
      const { invoke } = await import('@tauri-apps/api/core');

      // 发送音频数据到后端处理
      const result = await invoke('volcano_asr_recognize', {
        audioStream: stream,
        config: {
          appKey: this.config.appKey,
          accessKey: this.config.accessKey,
          resourceId: this.config.resourceId,
          language: lang || 'zh-CN',
        },
      }) as ASRResult;

      console.log('[ASR-Volcano] 识别结果:', result.text);
      this.onResult(result);
    } catch (error) {
      console.error('[ASR-Volcano] Tauri 调用失败:', error);
      this.onError(new Error(`识别失败: ${error}`));
    }
  }

  /**
   * 浏览器环境连接（需要后端代理）
   */
  private async connectWithBrowser(stream: MediaStream, lang?: string): Promise<void> {
    // 注意：浏览器 WebSocket 不支持自定义头部
    // 火山引擎 API 需要: X-Api-App-Key, X-Api-Access-Key, X-Api-Resource-Id
    // 这些无法在浏览器端设置！

    const wsUrl = `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`;

    console.log('[ASR-Volcano] ⚠️ 警告：浏览器无法设置 WebSocket 认证头部');
    console.log('[ASR-Volcano] 解决方案：');
    console.log('  1. 使用 Tauri/Rust 后端代理');
    console.log('  2. 部署后端服务器转发请求');
    console.log('  3. 使用 Cloudflare Workers/Vercel Edge Functions');

    // 尝试连接（会失败，但可以确认问题）
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[ASR-Volcano] WebSocket 已连接（意外成功？）');
        this.sendInitialRequest(stream, lang);
      };

      this.ws.onmessage = (event) => {
        const data = event.data as Uint8Array;
        const response = parseResponseMessage(data);
        console.log('[ASR-Volcano] 收到响应:', JSON.stringify(response));

        if (response.code && response.code !== 20000000) {
          this.onError(new Error(`API 错误: ${response.code} ${response.message}`));
          this.cleanup();
          return;
        }

        if (response.audio_info) {
          const result: ASRResult = {
            text: response.result?.text || '',
            confidence: 1.0,
            lang: lang || 'zh-CN',
            duration: response.audio_info.duration,
          };
          console.log('[ASR-Volcano] 识别完成:', result.text);
          this.onResult(result);
          this.cleanup();
        }
      };

      this.ws.onerror = () => {
        console.error('[ASR-Volcano] WebSocket 错误');
        console.error('[ASR-Volcano] 可能原因:');
        console.error('  1. CORS 限制 - 火山引擎不允许跨域访问');
        console.error('  2. 缺少认证 - 浏览器无法设置必要的 HTTP 头部');
        console.error('');
        console.error('【解决方案】');
        console.error('请选择以下方案之一:');
        console.error('');
        console.error('方案 A: 使用 Tauri 后端（推荐）');
        console.error('  1. 在 Rust 后端实现火山引擎 API 调用');
        console.error('  2. 前端通过 tauri.invoke() 调用');
        console.error('');
        console.error('方案 B: 部署后端代理');
        console.error('  1. 部署 Node.js/Python 后端服务器');
        console.error('  2. 后端转发音频到火山引擎 API');
        console.error('  3. 前端通过 HTTP POST 发送音频');

        this.onError(new Error('浏览器无法直接连接火山引擎 API，请使用 Tauri 后端或部署代理服务器'));
        this.cleanup();
      };

      this.ws.onclose = (event) => {
        console.log('[ASR-Volcano] WebSocket 已关闭, code:', event.code);
      };
    } catch (error) {
      console.error('[ASR-Volcano] 连接异常:', error);
      this.onError(new Error(`连接失败: ${error}`));
    }
  }

  /**
   * 发送初始请求
   */
  private sendInitialRequest(stream: MediaStream, lang?: string): void {
    const request: ASRRequest = {
      user: { uid: this.connectId },
      audio: {
        format: 'pcm',
        rate: 16000,
        bits: 16,
        channel: 1,
        language: lang,
      },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        show_utterances: true,
      },
    };

    const message = buildRequestMessage(request);
    this.ws?.send(message);
    console.log('[ASR-Volcano] 初始请求已发送');

    // 开始录制音频
    this.startRecording(stream);
  }

  /**
   * 开始录制音频并实时发送
   */
  private startRecording(stream: MediaStream): void {
    console.log('[ASR-Volcano] 开始录制音频...');

    this.isRecording = true;
    this.audioChunks = [];

    // 创建 AudioContext
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    // 实时处理音频
    this.scriptProcessor.onaudioprocess = (event) => {
      if (!this.isRecording) return;

      const inputData = event.inputBuffer.getChannelData(0);
      this.audioChunks.push(new Float32Array(inputData));

      // 转换为 PCM 16kHz 并发送
      this.processAndSendAudio(inputData);
    };

    this.mediaStreamSource.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

  /**
   * 处理并发送音频数据
   */
  private async processAndSendAudio(channelData: Float32Array): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 转换为 PCM 16bit
    const pcmData = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // 发送音频消息
    const message = buildAudioMessage(new Uint8Array(pcmData.buffer), false);
    this.ws.send(message);
  }

  /**
   * 停止录制并发送结束标记
   */
  stopRecording(): void {
    console.log('[ASR-Volcano] 停止录制...');
    this.isRecording = false;

    // 清理音频处理资源
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // 发送结束标记
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const endMark = buildAudioMessage(new Uint8Array(0), true);
      this.ws.send(endMark);
      console.log('[ASR-Volcano] 发送结束标记');
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    this.stopRecording();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.audioChunks = [];
    this.onResult = () => {};
    this.onError = () => {};
    this.resolveResult = null;
    this.rejectResult = null;
  }

  /**
   * 流式识别（暂未实现）
   */
  async *streamTranscribe(_input: ASRInput): AsyncIterable<ASRPartialResult> {
    throw new Error('流式识别暂未实现');
  }
}
