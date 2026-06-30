/**
 * Adapters - 统一导出
 */

// Web Speech ASR
export { WebSpeechASRAdapter } from './web-speech-asr';

// VolcanoEngine ASR (云端 API)
export { VolcanoEngineASRAdapter } from './asr/volcano-engine-asr';
export { VolcanoHTTPASRAdapter } from './asr/volcano-http-asr';
export { VolcanoRecognizeASRAdapter } from './asr/volcano-recognize-asr';

// DashScope LLM (待实现)
// export { DashScopeLLMAdapter } from './dashscope-llm';
