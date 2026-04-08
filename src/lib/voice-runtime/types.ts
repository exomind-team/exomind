export interface ProviderRawPerception {
  provider: string;
  model: string;
  eventType: string;
  payload: Record<string, unknown>;
  capturedAt: string;
}

export interface NormalizedVoicePerception {
  traceId: string;
  provider: 'doubao-o2-realtime';
  transcript: string;
  isFinal: boolean;
  emotion?: string;
  arousal?: number;
  speakingStyle?: string;
  confidence?: number;
  providerMeta?: Record<string, unknown>;
}
