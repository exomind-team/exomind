import type { ProviderRawPerception } from '../types';

export type VoiceRuntimeProviderId = 'doubao-o2-realtime';

export interface VoiceRuntimeProviderConfig {
  provider: VoiceRuntimeProviderId;
  modelVersion: string;
  sampleRate: number;
  language?: string;
  appId?: string;
  accessToken?: string;
  secretKey?: string;
  websocketUrl?: string;
  connectId?: string;
  speaker?: string;
  inputMode?: 'keep_alive' | 'push_to_talk' | 'text' | 'audio_file';
  ttsAudioFormat?: 'pcm' | 'pcm_s16le';
  ttsSampleRate?: number;
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

export interface DoubaoRealtimeEventPayload {
  sessionId: string;
  eventType: string;
  model?: string;
  payload?: Record<string, unknown>;
  audioData?: number[];
  audioFormat?: 'pcm' | 'pcm_s16le';
  sampleRate?: number;
  capturedAt?: string;
}
