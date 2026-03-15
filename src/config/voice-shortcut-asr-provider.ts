import { createConfigModule } from './config-factory';

export const VOICE_SHORTCUT_ASR_PROVIDER_VALUES = ['moss', 'volcano'] as const;
export type VoiceShortcutAsrProvider = (typeof VOICE_SHORTCUT_ASR_PROVIDER_VALUES)[number];

function normalizeProvider(rawValue: string | null | undefined): VoiceShortcutAsrProvider {
  return rawValue === 'volcano' ? 'volcano' : 'moss';
}

const _module = createConfigModule<VoiceShortcutAsrProvider>({
  storageKey: 'exomind:voiceShortcutAsrProvider',
  eventName: 'exomind:voice-shortcut-asr-provider-changed',
  defaultValue: 'moss',
  normalize: normalizeProvider,
});

export function getVoiceShortcutAsrProvider(): VoiceShortcutAsrProvider {
  return _module.get();
}

export function setVoiceShortcutAsrProvider(provider: VoiceShortcutAsrProvider): VoiceShortcutAsrProvider {
  return _module.set(provider);
}

export function subscribeVoiceShortcutAsrProviderChanges(
  listener: (provider: VoiceShortcutAsrProvider) => void,
): () => void {
  return _module.subscribe(listener);
}

export function getVoiceShortcutAsrProviderLabel(provider: VoiceShortcutAsrProvider): string {
  return provider === 'volcano' ? '火山' : 'MOSS';
}
