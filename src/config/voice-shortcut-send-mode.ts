import { createConfigModule } from './config-factory';

export const VOICE_SHORTCUT_SEND_MODE_VALUES = ['insert-only', 'auto-enter-send'] as const;
export type VoiceShortcutSendMode = (typeof VOICE_SHORTCUT_SEND_MODE_VALUES)[number];

function normalizeMode(rawValue: string | null | undefined): VoiceShortcutSendMode {
  if (rawValue === 'auto-enter-send') return 'auto-enter-send';
  return 'insert-only';
}

const _module = createConfigModule<VoiceShortcutSendMode>({
  storageKey: 'exomind:voiceShortcutSendMode',
  eventName: 'exomind:voice-shortcut-send-mode-changed',
  defaultValue: 'insert-only',
  normalize: normalizeMode,
});

export function getVoiceShortcutSendMode(): VoiceShortcutSendMode {
  return _module.get();
}

export function setVoiceShortcutSendMode(mode: VoiceShortcutSendMode): VoiceShortcutSendMode {
  return _module.set(mode);
}

export function subscribeVoiceShortcutSendModeChanges(
  listener: (mode: VoiceShortcutSendMode) => void,
): () => void {
  return _module.subscribe(listener);
}
