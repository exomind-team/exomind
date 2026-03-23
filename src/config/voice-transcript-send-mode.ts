import { createConfigModule } from './config-factory';

export const VOICE_TRANSCRIPT_SEND_MODE_VALUES = ['insert', 'direct-send'] as const;
export type VoiceTranscriptSendMode = (typeof VOICE_TRANSCRIPT_SEND_MODE_VALUES)[number];

function normalizeMode(rawValue: string | null | undefined): VoiceTranscriptSendMode {
  if (rawValue === 'direct-send') return 'direct-send';
  return 'insert';
}

const _module = createConfigModule<VoiceTranscriptSendMode>({
  storageKey: 'exomind:voiceTranscriptSendMode',
  eventName: 'exomind:voice-transcript-send-mode-changed',
  defaultValue: 'insert',
  normalize: normalizeMode,
});

export function getVoiceTranscriptSendMode(): VoiceTranscriptSendMode {
  return _module.get();
}

export function setVoiceTranscriptSendMode(mode: VoiceTranscriptSendMode): void {
  _module.set(mode);
}

export function subscribeVoiceTranscriptSendModeChanges(
  listener: (mode: VoiceTranscriptSendMode) => void,
): () => void {
  return _module.subscribe(listener);
}
