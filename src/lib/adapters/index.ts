/**
 * Adapters - 统一导出
 */

// Web Speech ASR
export { WebSpeechASRAdapter } from './web-speech-asr';

// MOSS ASR
export { MOSSASRAdapter } from './asr/moss-asr';

// VolcanoEngine ASR (云端 API)
export { VolcanoEngineASRAdapter } from './asr/volcano-engine-asr';
export { VolcanoHTTPASRAdapter } from './asr/volcano-http-asr';

// DashScope LLM (待实现)
// export { DashScopeLLMAdapter } from './dashscope-llm';
