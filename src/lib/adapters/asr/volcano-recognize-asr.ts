/**
 * Volcano Recognize ASR Adapter - 火山引擎一次性语音识别适配器
 *
 * ┌─────────────────────────────────────────┐
 * │  L1 Adapter                             │
 * │  ─────────────────────────────────     │
 * │  通过 Tauri 命令 volcano_asr_recognize  │
 * │  做一次性（按住说话松手出结果）转写      │
 * └─────────────────────────────────────────┘
 *
 * 设计说明：
 * - 复用 voice-shortcut.service 已验证的火山一次性转写路径：
 *   WAV(Uint8Array) → slice(44) 去掉 WAV 头得 PCM → invoke('volcano_asr_recognize')
 * - 配置统一从 runtime config 构建（getStoredVolcanoRuntimeConfig），
 *   与火山 ASR 测试页 / 全局语音快捷键共用同一份 AppKey/AccessKey/Resource ID。
 * - 带额度回退（resolveVolcanoQuotaFallback），与全局语音快捷键路径行为保持一致。
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  IASRPort,
  IASRConfig,
  ASRInput,
  ASRResult,
  ASRPartialResult,
} from '../../ports/asr-port';
import {
  getStoredVolcanoRuntimeConfig,
  setVolcanoResourceId,
  VOLCANO_RESOURCE_PRESETS,
  type VolcanoRuntimeConfig,
} from '@/lib/asr/volcano-config';
import { log } from '@/lib/logger';

// 资源 ID 常量（与 voice-shortcut.service 保持一致）
const VOLCANO_SEED_DURATION_RESOURCE_ID = 'volc.seedasr.sauc.duration';
const VOLCANO_SEED_CONCURRENT_RESOURCE_ID = 'volc.seedasr.sauc.concurrent';
const VOLCANO_BIG_DURATION_RESOURCE_ID = 'volc.bigasr.sauc.duration';
const VOLCANO_BIG_CONCURRENT_RESOURCE_ID = 'volc.bigasr.sauc.concurrent';

const LOG_TAG = '[ASR-Volcano]';

function getVolcanoRuntimeConfigOrThrow(): VolcanoRuntimeConfig {
  const config = getStoredVolcanoRuntimeConfig(import.meta.env as Record<string, string | undefined>);
  if (!config.appKey || !config.accessKey || !config.resourceId) {
    throw new Error('火山配置不完整，请先到火山 ASR 测试页保存 AppKey / AccessKey / Resource ID');
  }
  return config;
}

function stringifyVolcanoError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? '');
}

function getVolcanoResourceLabel(resourceId: string): string {
  const label = VOLCANO_RESOURCE_PRESETS.find((item) => item.value === resourceId)?.label ?? resourceId;
  return label.replace('模型 ', '');
}

/**
 * 火山额度回退：与 voice-shortcut.service.resolveVolcanoQuotaFallback 等价。
 * 检测到额度耗尽错误（45000292 / 450000292）时，尝试切换到回退资源并持久化。
 */
function resolveVolcanoQuotaFallback(
  error: unknown,
  config: VolcanoRuntimeConfig,
): { config?: VolcanoRuntimeConfig; message: string; switched: boolean } | null {
  const normalizedError = stringifyVolcanoError(error).toLowerCase();
  const isQuotaExceeded = normalizedError.includes('45000292') || normalizedError.includes('450000292');
  if (!isQuotaExceeded) {
    return null;
  }

  let fallbackResourceId: string | null = null;
  if (normalizedError.includes('audio_duration_lifetime')) {
    fallbackResourceId = config.resourceId === VOLCANO_BIG_DURATION_RESOURCE_ID
      ? VOLCANO_SEED_DURATION_RESOURCE_ID
      : null;
  } else if (normalizedError.includes('audio_concurrent_lifetime')) {
    fallbackResourceId = config.resourceId === VOLCANO_BIG_CONCURRENT_RESOURCE_ID
      ? VOLCANO_SEED_CONCURRENT_RESOURCE_ID
      : null;
  } else if (config.resourceId === VOLCANO_BIG_DURATION_RESOURCE_ID) {
    fallbackResourceId = VOLCANO_SEED_DURATION_RESOURCE_ID;
  } else if (config.resourceId === VOLCANO_BIG_CONCURRENT_RESOURCE_ID) {
    fallbackResourceId = VOLCANO_SEED_CONCURRENT_RESOURCE_ID;
  }

  if (!fallbackResourceId || fallbackResourceId === config.resourceId) {
    const currentLabel = getVolcanoResourceLabel(config.resourceId);
    return {
      switched: false,
      message: `火山 ${currentLabel} 额度报错，当前保持 ${currentLabel}，不会再自动回退到 1.0，请检查控制台配额或资源绑定后重试。`,
    };
  }

  const persistedResourceId = setVolcanoResourceId(fallbackResourceId);
  const fallbackConfig: VolcanoRuntimeConfig = {
    ...config,
    resourceId: persistedResourceId,
  };

  const fromLabel = getVolcanoResourceLabel(config.resourceId);
  const toLabel = getVolcanoResourceLabel(persistedResourceId);
  log.warn(`${LOG_TAG} volcano quota exceeded, fallback resource: ${config.resourceId} -> ${persistedResourceId}`);

  return {
    switched: true,
    config: fallbackConfig,
    message: `火山 ${fromLabel} 额度已用尽，已自动切换到 ${toLabel}，请再试一次。`,
  };
}

/**
 * 火山一次性识别适配器
 */
export class VolcanoRecognizeASRAdapter implements IASRPort {
  /**
   * 配置适配器。
   * 火山凭据统一从 runtime config（火山 ASR 设置）读取，这里无需额外配置。
   */
  configure(_config: IASRConfig): void {
    // no-op：火山配置从 runtime config 读取
  }

  getSupportedLanguages(): string[] {
    return ['zh-CN', 'en-US'];
  }

  isAvailable(): boolean {
    return true;
  }

  /**
   * 一次性语音识别。
   * 取 input.preRecordedAudio（WAV Uint8Array）→ slice(44) 去 WAV 头得 PCM
   * → invoke('volcano_asr_recognize')。带一次额度回退重试。
   */
  async transcribe(input: ASRInput): Promise<ASRResult> {
    const wavData = input.preRecordedAudio;
    if (!wavData || wavData.length === 0) {
      throw new Error('火山识别需要预录制的 WAV 音频（preRecordedAudio）');
    }

    const config = getVolcanoRuntimeConfigOrThrow();
    const pcmAudio = wavData.slice(44);
    log.info(`${LOG_TAG} 开始识别, PCM ${pcmAudio.length} bytes`);

    try {
      const result = await invoke<ASRResult>('volcano_asr_recognize', {
        audioData: Array.from(pcmAudio),
        config,
      });
      log.info(`${LOG_TAG} 识别完成: "${result.text}"`);
      return result;
    } catch (error) {
      const fallback = resolveVolcanoQuotaFallback(error, config);
      if (!fallback) {
        throw error;
      }
      if (!fallback.switched || !fallback.config) {
        throw new Error(fallback.message);
      }
      const result = await invoke<ASRResult>('volcano_asr_recognize', {
        audioData: Array.from(pcmAudio),
        config: fallback.config,
      });
      log.info(`${LOG_TAG} 识别完成(回退资源): "${result.text}"`);
      return result;
    }
  }

  async *streamTranscribe(_input: ASRInput): AsyncIterable<ASRPartialResult> {
    throw new Error('火山一次性识别适配器不支持流式识别');
  }
}
