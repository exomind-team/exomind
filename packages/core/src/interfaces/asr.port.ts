/**
 * ASR Port - 语音识别接口定义
 */
export interface ASRInput {
  lang?: string;
  stream?: MediaStream;
  preRecordedAudio?: Uint8Array;
}

export interface ASRResult {
  text: string;
  confidence: number;
  lang: string;
  duration?: number;
}

export interface ASRPartialResult {
  text: string;
  isFinal: boolean;
}

export interface IASRConfig {
  apiKey?: string;
  apiUrl?: string;
  timeout?: number;
}

export interface IASRPort {
  configure(config: IASRConfig): void;
  getSupportedLanguages(): string[];
  transcribe(input: ASRInput): Promise<ASRResult>;
  streamTranscribe(input: ASRInput): AsyncIterable<ASRPartialResult>;
  isAvailable(): boolean;
}
