/**
 * ASR Adapters - 导出
 *
 * 语音识别适配器集合
 */

export {
  MossASRAdapter,
  getMOSSAdapter,
  type MOSSASRConfig,
  type MOSSASRResult,
  type MOSSASRInput,
} from './moss-asr';

// ========== 火山引擎适配器 Stub（待完整迁移）==========

import type { IASRPort, IASRConfig, ASRInput, ASRResult, ASRPartialResult } from '../../interfaces/asr.port';

/**
 * 火山引擎 HTTP ASR 适配器 Stub
 */
export class VolcanoHTTPASRAdapter implements IASRPort {
  configure(_config: IASRConfig): void {
    console.warn('[VolcanoHTTPASRAdapter] Stub - 等待完整迁移');
  }

  getSupportedLanguages(): string[] {
    return ['zh-CN', 'en-US'];
  }

  async transcribe(_input: ASRInput): Promise<ASRResult> {
    return { text: '', confidence: 0, lang: 'zh-CN' };
  }

  async *streamTranscribe(_input: ASRInput): AsyncIterable<ASRPartialResult> {
    throw new Error('Not implemented');
  }

  isAvailable(): boolean {
    return false;
  }
}

/**
 * 火山引擎 WebSocket ASR 适配器 Stub
 */
export class VolcanoEngineASRAdapter implements IASRPort {
  configure(_config: IASRConfig): void {
    console.warn('[VolcanoEngineASRAdapter] Stub - 等待完整迁移');
  }

  getSupportedLanguages(): string[] {
    return ['zh-CN', 'en-US'];
  }

  async transcribe(_input: ASRInput): Promise<ASRResult> {
    return { text: '', confidence: 0, lang: 'zh-CN' };
  }

  async *streamTranscribe(_input: ASRInput): AsyncIterable<ASRPartialResult> {
    throw new Error('Not implemented');
  }

  isAvailable(): boolean {
    return false;
  }
}
