/**
 * Web Speech ASR Adapter
 * 浏览器原生语音识别 API 实现
 */

import type { IASRPort, IASRConfig, ASRInput, ASRResult, ASRPartialResult } from '../ports/asr-port';
import { log } from '@/lib/logger';

/**
 * Web Speech API 适配器
 *
 * 内部使用浏览器原生 API：
 * - SpeechRecognition (标准)
 * - webkitSpeechRecognition (Safari/Chrome 兼容)
 *
 * 适配器模式：外部统一接口，内部处理浏览器差异
 */
export class WebSpeechASRAdapter implements IASRPort {
  private recognitionClass: typeof SpeechRecognition | null = null;

  constructor() {
    this.initRecognition();
  }

  /**
   * 初始化Recognition对象
   */
  private initRecognition(): void {
    if (typeof window === 'undefined') {
      log.info('[ASR] 运行环境无 window，跳过初始化');
      return;
    }

    // 尝试获取 SpeechRecognition 构造函数
    const SpeechRecognition = (window as any).SpeechRecognition ||
                             (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      log.info('[ASR] 浏览器不支持 SpeechRecognition API');
      return;
    }

    this.recognitionClass = SpeechRecognition;

    // 创建实例（实际使用时才创建，避免立即报错）
    log.info('[ASR] SpeechRecognition 初始化完成');
  }

  /**
   * 检查 API 是否可用
   */
  isAvailable(): boolean {
    return this.recognitionClass !== null;
  }

  /**
   * 配置适配器（Web Speech API 不需要配置）
   */
  configure(_config: IASRConfig): void {
    // Web Speech API 不需要额外配置
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages(): string[] {
    // Web Speech API 支持的语言取决于浏览器
    return [
      'zh-CN', 'zh-TW', 'zh-HK',
      'en-US', 'en-GB', 'en-AU',
      'ja-JP', 'ko-KR',
    ];
  }

  /**
   * 创建 recognition 实例
   */
  private createRecognition(lang: string): SpeechRecognition {
    if (!this.recognitionClass) {
      throw new Error('SpeechRecognition API 不可用');
    }

    const recognitionInstance = new this.recognitionClass();
    recognitionInstance.lang = lang;
    recognitionInstance.continuous = false;        // 单次识别
    recognitionInstance.interimResults = false;     // 只返回最终结果
    // maxAlternatives 是 webkitSpeechRecognition 的扩展属性
    (recognitionInstance as any).maxAlternatives = 1;

    return recognitionInstance;
  }

  /**
   * 一次性语音识别
   *
   * @param input - 输入配置（语言、流）
   * @returns 识别结果
   */
  async transcribe(input: ASRInput): Promise<ASRResult> {
    const lang = input.lang || 'zh-CN';
    log.info(`[ASR] 开始识别，语言: ${lang}`);

    // 验证输入
    if (input.stream) {
      log.info('[ASR] 使用传入的 MediaStream');
      // TODO: 使用传入的流进行识别
      // Web Speech API 不直接支持传入流，需要先用 MediaRecorder 录制
    }

    // 创建 recognition 实例
    const recognition = this.createRecognition(lang);

    // 返回 Promise，包装事件回调
    return new Promise((resolve, reject) => {
      // === 识别成功 ===
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const result = event.results[0];
        const text = result[0].transcript;
        const confidence = result[0].confidence;

        log.info(`[ASR] 识别成功: ${text}`);
        log.info(`[ASR] 置信度: ${confidence.toFixed(2)}`);

        resolve({
          text,
          confidence,
          lang,
        });
      };

      // === 识别错误 ===
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        log.error(`[ASR] 识别错误: ${event.error} ${event.message}`);
        reject(new Error(`语音识别失败: ${event.error}`));
      };

      // === 识别结束 ===
      recognition.onend = () => {
        log.info('[ASR] 识别结束');
      };

      // 启动识别
      recognition.start();
    });
  }

  /**
   * 流式语音识别
   *
   * 实时返回识别结果，适合字幕显示场景
   * 本适配器暂不支持流式，返回错误提示
   */
  async *streamTranscribe(input: ASRInput): AsyncIterable<ASRPartialResult> {
    log.info('[ASR] 流式识别暂未实现，使用一次性识别');

    // 暂时用一次性识别模拟
    const result = await this.transcribe(input);

    yield {
      text: result.text,
      isFinal: true,
    };
  }
}

/**
 * 类型声明补充
 * 避免 TypeScript 报错
 */
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}
