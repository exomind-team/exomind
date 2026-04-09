import { normalizeVoiceRuntimePerception } from '@/lib/voice-runtime/normalize-perception';
import type {
  NormalizedVoicePerception,
  ProviderRawPerception,
} from '@/lib/voice-runtime/types';
import { publishVoiceTranscriptSignal } from '@/lib/services/voice-signal.service';

type PublishTranscriptFn = typeof publishVoiceTranscriptSignal;

export interface VoiceRuntimeAgentState {
  rawEvents: ProviderRawPerception[];
  liveTranscript: string;
  finalTranscript: string;
  lastNormalizedPerception: NormalizedVoicePerception | null;
}

export interface VoiceRuntimeAgentServiceOptions {
  publishTranscript?: PublishTranscriptFn;
}

export class VoiceRuntimeAgentService {
  private readonly publishTranscript: PublishTranscriptFn;
  private readonly state: VoiceRuntimeAgentState = {
    rawEvents: [],
    liveTranscript: '',
    finalTranscript: '',
    lastNormalizedPerception: null,
  };
  private activeTraceId: string | null = null;

  constructor(options: VoiceRuntimeAgentServiceOptions = {}) {
    this.publishTranscript = options.publishTranscript ?? publishVoiceTranscriptSignal;
  }

  getState(): VoiceRuntimeAgentState {
    return {
      rawEvents: [...this.state.rawEvents],
      liveTranscript: this.state.liveTranscript,
      finalTranscript: this.state.finalTranscript,
      lastNormalizedPerception: this.state.lastNormalizedPerception,
    };
  }

  async handleProviderRawEvent(
    rawPerception: ProviderRawPerception,
  ): Promise<NormalizedVoicePerception | null> {
    this.state.rawEvents = [...this.state.rawEvents, rawPerception].slice(-50);

    const traceId = this.resolveTraceId();
    const normalizedPerception = normalizeVoiceRuntimePerception(rawPerception, traceId);
    if (!normalizedPerception) {
      return null;
    }

    this.state.lastNormalizedPerception = normalizedPerception;

    if (normalizedPerception.isFinal) {
      this.state.liveTranscript = '';
      this.state.finalTranscript = normalizedPerception.transcript;
      try {
        await this.publishTranscript(
          {
            text: normalizedPerception.transcript,
            confidence: normalizedPerception.confidence,
            lang: 'zh-CN',
          },
          {
            source: 'tauri:voice-runtime-agent',
            captureSource: 'voice-runtime-agent',
          },
        );
      } catch {
        // Keep the local lab state available even if RT publish fails.
        // （即使 RT 发布失败，也保留本地实验页可观察状态）
      }
      this.activeTraceId = null;
      return normalizedPerception;
    }

    this.state.liveTranscript = normalizedPerception.transcript;
    this.state.finalTranscript = '';
    return normalizedPerception;
  }

  private resolveTraceId(): string {
    if (!this.activeTraceId) {
      const suffix = Math.random().toString(36).slice(2, 10);
      this.activeTraceId = `voice-runtime:${Date.now().toString(36)}:${suffix}`;
    }
    return this.activeTraceId;
  }
}
