import type { ProviderRawPerception } from '../types';
import {
  VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER,
  VOICE_RUNTIME_OMNI_PROVIDER,
} from '@/config/voice-runtime-settings';

export type VoiceRuntimeProviderId =
  'doubao-o2-realtime'
  | typeof VOICE_RUNTIME_OMNI_PROVIDER
  | typeof VOICE_RUNTIME_OMNI_COMPATIBLE_PROVIDER;

export interface VoiceRuntimeProviderConfig {
  provider: VoiceRuntimeProviderId;
  modelVersion: string;
  sampleRate: number;
  language?: string;
  appId?: string;
  accessToken?: string;
  secretKey?: string;
  websocketUrl?: string;
  baseUrl?: string;
  connectId?: string;
  speaker?: string;
  apiKey?: string;
  instructions?: string;
  inputMode?: 'keep_alive' | 'push_to_talk' | 'text' | 'audio_file';
  ttsAudioFormat?: 'pcm' | 'pcm_s16le';
  ttsSampleRate?: number;
  audioOutputFormat?: 'wav' | 'pcm16';
  // Omni Realtime WebSearch toggle（实时联网搜索开关）
  enableSearch?: boolean;
  // Omni Realtime search options（搜索配置）
  searchOptions?: {
    // Whether to include source links in answers（是否返回来源）
    enableSource?: boolean;
  };
  // Omni Realtime function-calling tools schema（函数调用工具声明）
  tools?: Array<Record<string, unknown>>;
  // Tool routing mode or explicit tool selector（工具选择策略）
  toolChoice?: string | Record<string, unknown>;
}

export interface VoiceRuntimeAudioChunkMeta {
  provider: VoiceRuntimeProviderId;
  sessionId: string;
  eventType: string;
  capturedAt: string;
  sampleRate: number;
  audioFormat: 'pcm' | 'pcm_s16le';
}

export interface VoiceRuntimeProviderCallbacks {
  onRawEvent?: (event: ProviderRawPerception) => void | Promise<void>;
  onAudioChunk?: (chunk: Uint8Array, meta: VoiceRuntimeAudioChunkMeta) => void | Promise<void>;
}

export interface VoiceRuntimeProvider {
  start(): Promise<string>;
  pushAudio(chunk: Uint8Array): Promise<void>;
  finish(chunk?: Uint8Array): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
  getSessionId(): string | null;
}

export interface VoiceRuntimeProviderEventPayload {
  sessionId: string;
  eventType: string;
  model?: string;
  payload?: Record<string, unknown>;
  audioData?: number[];
  audioFormat?: 'pcm' | 'pcm_s16le';
  sampleRate?: number;
  capturedAt?: string;
}

export type DoubaoRealtimeEventPayload = VoiceRuntimeProviderEventPayload;
export type QwenOmniRealtimeEventPayload = VoiceRuntimeProviderEventPayload;
