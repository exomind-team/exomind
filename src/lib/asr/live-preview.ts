export interface VoiceLivePreviewUpdate {
  text: string;
  isFinal: boolean;
}

export interface VoiceLivePreviewSession {
  start(): void;
  stop(): void;
  abort(): void;
}

export interface VoiceLivePreviewSource {
  isAvailable(): boolean;
  createSession(options: {
    lang?: string;
    onUpdate: (payload: VoiceLivePreviewUpdate) => void;
    onError?: (error: Error) => void;
  }): VoiceLivePreviewSession;
}

function resolveRecognitionClass(): typeof SpeechRecognition | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

class SpeechRecognitionLivePreviewSource implements VoiceLivePreviewSource {
  isAvailable(): boolean {
    return resolveRecognitionClass() !== null;
  }

  createSession(options: {
    lang?: string;
    onUpdate: (payload: VoiceLivePreviewUpdate) => void;
    onError?: (error: Error) => void;
  }): VoiceLivePreviewSession {
    const RecognitionClass = resolveRecognitionClass();
    if (!RecognitionClass) {
      throw new Error('SpeechRecognition API 不可用，无法启动实时预览');
    }

    const recognition = new RecognitionClass();
    recognition.lang = options.lang || 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    (recognition as SpeechRecognition & { maxAlternatives?: number }).maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => {
        const result = event.results[index];
        return result?.[0]?.transcript || '';
      }).join('').trim();

      if (!transcript) {
        return;
      }

      const lastResult = event.results[event.results.length - 1];
      options.onUpdate({
        text: transcript,
        isFinal: Boolean(lastResult?.isFinal),
      });
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      options.onError?.(new Error(event.message || event.error || '实时预览失败'));
    };

    return {
      start() {
        recognition.start();
      },
      stop() {
        recognition.stop();
      },
      abort() {
        recognition.abort();
      },
    };
  }
}

export function createDefaultVoiceLivePreviewSource(): VoiceLivePreviewSource {
  return new SpeechRecognitionLivePreviewSource();
}
