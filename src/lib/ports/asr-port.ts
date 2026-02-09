/**
 * ASR Port - 语音识别接口定义
 */

// 语音识别输入
export interface ASRInput {
  lang?: string;        // 语言，默认 'zh-CN'
  stream?: MediaStream; // 麦克风流
}

// 语音识别结果
export interface ASRResult {
  text: string;         // 识别出的文字
  confidence: number;    // 置信度 0-1
  lang: string;         // 识别语言
}

// 部分结果（流式识别时使用）
export interface ASRPartialResult {
  text: string;
  isFinal: boolean;     // true=最终结果，false=中间结果
}

/**
 * 语音识别 Port
 * 统一接口，适配器实现可替换
 */
export interface IASRPort {
  /**
   * 一次性识别（适合：按住说话松手出结果）
   */
  transcribe(input: ASRInput): Promise<ASRResult>;

  /**
   * 流式识别（适合：实时显示字幕）
   */
  streamTranscribe(input: ASRInput): AsyncIterable<ASRPartialResult>;

  /**
   * 检查是否可用
   */
  isAvailable(): boolean;
}
