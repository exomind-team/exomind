/**
 * VoiceChatService - 语音聊天服务
 *
 * ┌─────────────────────────────────────────┐
 * │  L3 Service                              │
 * │  ─────────────────────────────────     │
 * │  业务逻辑层                             │
 * │  - 封装完整的语音识别流程                │
 * │  - 调用 Port 执行底层能力                │
 * │  - 管理 UI 状态                          │
 * └─────────────────────────────────────────┘
 *
 * 支持两种 Adapter：
 * - HTTP Adapter: 通过 Bun 后端服务调用火山引擎
 * - WebSocket Adapter: 直接连接火山引擎（浏览器受限）
 */

import type { ASRResult } from '../environment/interfaces/asr.port';
import { VolcanoHTTPASRAdapter } from '../adapters/asr/volcano-http-asr';
import { VolcanoEngineASRAdapter } from '../adapters/asr/volcano-engine-asr';
import { MOSSASRAdapter } from '../adapters/asr/moss-asr';

// Adapter 类型
export type ASRAdapterType = 'http' | 'websocket' | 'moss';

/**
 * VoiceChatService 接口
 * 向 L4 UI 暴露的能力
 */
export interface IVoiceChatService {
  /** 当前录音状态 */
  isRecording: boolean;
  /** 当前录音时长(秒) */
  duration: number;
  /** 最后识别结果 */
  lastResult: ASRResult | null;
  /** ASR 适配器是否可用 */
  isAvailable: boolean;
  /** 当前使用的 Adapter 类型 */
  adapterType: ASRAdapterType;
  /** 开始录音 */
  startRecording(): Promise<void>;
  /** 停止录音并识别 */
  stopRecording(): Promise<ASRResult | null>;
  /** 重置状态 */
  reset(): void;
}

/**
 * VoiceChatService 实现
 */
export class VoiceChatService implements IVoiceChatService {
  isRecording = false;
  duration = 0;
  lastResult: ASRResult | null = null;
  isAvailable = false;
  adapterType: ASRAdapterType = 'moss';

  private httpAdapter: VolcanoHTTPASRAdapter;
  private wsAdapter: VolcanoEngineASRAdapter;
  private mossAdapter: MOSSASRAdapter;
  private durationInterval: NodeJS.Timeout | null = null;
  private startTime = 0;
  private stream: MediaStream | null = null;
  private recordingStartTime = 0;

  constructor() {
    // 初始化三种 Adapter
    this.httpAdapter = new VolcanoHTTPASRAdapter();
    this.wsAdapter = new VolcanoEngineASRAdapter();
    this.mossAdapter = new MOSSASRAdapter();

    // 检查可用性
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    // 优先使用 MOSS 适配器（最简单，无需后端）
    const mossAvailable = this.mossAdapter.isAvailable();

    if (mossAvailable) {
      this.isAvailable = true;
      this.adapterType = 'moss';
      console.log('[VoiceChatService] 使用 MOSS Adapter (推荐，最简单)');
      return;
    }

    // MOSS 不可用时，尝试 HTTP Adapter（通过 Bun 后端）
    const httpAvailable = await this.httpAdapter.isAvailable();

    if (httpAvailable) {
      this.isAvailable = true;
      this.adapterType = 'http';
      console.log('[VoiceChatService] 使用 HTTP Adapter (通过 Bun 后端)');
    } else if (this.wsAdapter.isAvailable()) {
      this.isAvailable = true;
      this.adapterType = 'websocket';
      console.log('[VoiceChatService] ⚠️ 使用 WebSocket Adapter (浏览器受限，可能失败)');
      console.log('[VoiceChatService] 建议：配置 MOSS API Key 以获得最佳体验');
    } else {
      this.isAvailable = false;
      console.warn('[VoiceChatService] 所有 ASR 适配器都不可用');
      console.warn('[VoiceChatService] 请配置 MOSS API Key:');
      console.warn('  1. 在 .env 文件中添加: VITE_MOSS_API_KEY=your_api_key');
      console.warn('  2. 申请地址: https://studio.mosi.cn/');
    }
  }

  /**
   * 获取当前使用的适配器
   */
  private getCurrentAdapter() {
    if (this.adapterType === 'moss') {
      return this.mossAdapter;
    }
    return this.adapterType === 'http' ? this.httpAdapter : this.wsAdapter;
  }

  /**
   * 开始录音
   */
  async startRecording(): Promise<void> {
    console.log('[VoiceChatService] 开始录音...');

    if (!this.isAvailable) {
      throw new Error('语音识别不可用，请启动 Bun 后端服务');
    }

    // 获取麦克风权限
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 启动计时器
    this.recordingStartTime = Date.now();
    this.startTime = Date.now();
    this.durationInterval = setInterval(() => {
      this.duration = Math.floor((Date.now() - this.startTime) / 1000);
    }, 100);

    const adapter = this.getCurrentAdapter();

    if (this.adapterType === 'http') {
      // HTTP 模式：启动录制，3秒后自动停止并识别
      console.log('[VoiceChatService] HTTP 模式：3秒后自动识别');

      // 标记录制状态
      (window as any).__asrRecordingActive = true;

      adapter.transcribe({
        lang: 'zh-CN',
        stream: this.stream,
      }).then((result) => {
        console.log('[VoiceChatService] 识别结果:', result.text);
        this.lastResult = result;
      }).catch((error) => {
        console.error('[VoiceChatService] 识别失败:', error);
        this.lastResult = null;
      });

      // 3秒后自动停止
      setTimeout(() => {
        this.stopRecording();
      }, 3000);
    } else {
      // WebSocket 模式：手动控制
      adapter.transcribe({
        lang: 'zh-CN',
        stream: this.stream,
      }).then((result) => {
        console.log('[VoiceChatService] 识别结果:', result.text);
        this.lastResult = result;
      }).catch((error) => {
        console.error('[VoiceChatService] 识别失败:', error);
        this.lastResult = null;
      });
    }

    this.isRecording = true;
    console.log('[VoiceChatService] 录音已开始');
  }

  /**
   * 停止录音并识别
   */
  async stopRecording(): Promise<ASRResult | null> {
    console.log('[VoiceChatService] 停止录音...');

    // 停止计时器
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }

    // 停止录制状态
    (window as any).__asrRecordingActive = false;

    // 停止 ASR 适配器
    const adapter = this.getCurrentAdapter() as { stopRecording?: () => void };
    adapter.stopRecording?.();

    // 关闭麦克风流
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.isRecording = false;

    // 计算实际录音时长
    const recordingDuration = Math.floor((Date.now() - this.recordingStartTime) / 1000);
    console.log(`[VoiceChatService] 录音时长: ${recordingDuration}秒`);

    console.log('[VoiceChatService] 录音已停止');
    return this.lastResult;
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.lastResult = null;
    this.duration = 0;
    this.isRecording = false;
  }
}

// ========== Singleton ==========

let voiceChatService: VoiceChatService | null = null;

export function getVoiceChatService(): VoiceChatService {
  if (!voiceChatService) {
    voiceChatService = new VoiceChatService();
  }
  return voiceChatService;
}

/**
 * 切换 ASR 适配器类型
 */
export function setASRAdapterType(type: ASRAdapterType): void {
  const service = getVoiceChatService();
  service.adapterType = type;

  if (type === 'http') {
    console.log('[VoiceChatService] Switched to HTTP Adapter');
  } else if (type === 'moss') {
    console.log('[VoiceChatService] Switched to MOSS Adapter');
  } else {
    console.log('[VoiceChatService] Switched to WebSocket Adapter');
  }
}