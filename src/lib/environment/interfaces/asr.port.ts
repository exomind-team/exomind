/**
 * IASRPort - 语音识别接口
 *
 * 职责：将音频流转识别为文字
 *
 * ┌─────────────────────────────────────────┐
 * │  L2 Environment                         │
 * │  ─────────────────────────────────     │
 * │  持有 IASRPort 实例                   │
 * │  提供给 Service 使用                   │
 * └─────────────────────────────────────────┘
 */

export interface ASRInput {
  /** 语言，默认 zh-CN */
  lang?: string;
  /** 音频流（可选，由 Adapter 内部处理） */
  stream?: MediaStream;
}

export interface ASRResult {
  /** 识别出的文字 */
  text: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 识别语言 */
  lang: string;
  /** 音频时长(ms)，部分实现可能不提供 */
  duration?: number;
}

export interface ASRPartialResult {
  /** 中间/最终文本 */
  text: string;
  /** 是否为最终结果 */
  isFinal: boolean;
}

/**
 * 语音识别 Port
 *
 * 特点：
 * - 输入：音频流或录音数据
 * - 输出：识别文字
 * - 模式：同步（一次性）/ 流式（边说边识别）
 */
export interface IASRPort {
  /**
   * 一次性识别
   * - 适合：短句子、固定时长录音
   * - 返回：完整识别结果
   */
  transcribe(input: ASRInput): Promise<ASRResult>;

  /**
   * 流式识别（可选）
   * - 适合：实时显示字幕、实时反馈
   * - 返回：AsyncIterable，逐步产出中间结果
   */
  streamTranscribe?(input: ASRInput): AsyncIterable<ASRPartialResult>;

  /**
   * 检查能力是否可用
   */
  isAvailable(): boolean;

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages?(): string[];
}
