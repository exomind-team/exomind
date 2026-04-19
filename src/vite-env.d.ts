/// <reference types="vite/client" />

// 缺少类型的模块声明
declare module 'remark-obsidian';
declare module 'rehype-katex';

interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string; // App Version（应用版本）
  readonly VITE_BUILD_HASH?: string; // Build Hash（构建哈希）
  readonly VITE_UPDATE_BASE_URL?: string; // Update base URL（更新元数据基准地址）
  readonly TAURI_ENV_DEBUG?: string; // Tauri debug/release build flag（Tauri 调试/发布构建标记）
}

interface Window {
  __TAURI__: {
    [key: string]: unknown;
  };
  __TAURI_INTERNALS__: {
    [key: string]: unknown;
  };
  SpeechRecognition: typeof SpeechRecognition;
  webkitSpeechRecognition: typeof SpeechRecognition;
}

// Web Speech API 类型声明
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  result: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

declare var SpeechRecognition: {
  new (): SpeechRecognition;
  prototype: SpeechRecognition;
};

declare var webkitSpeechRecognition: {
  new (): SpeechRecognition;
  prototype: SpeechRecognition;
};
