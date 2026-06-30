import { createConfigModule } from './config-factory';

export const VOICE_SHORTCUT_ASR_PROVIDER_VALUES = ['volcano'] as const;
export type VoiceShortcutAsrProvider = (typeof VOICE_SHORTCUT_ASR_PROVIDER_VALUES)[number];

function normalizeProvider(_rawValue: string | null | undefined): VoiceShortcutAsrProvider {
  return 'volcano';
}

const _module = createConfigModule<VoiceShortcutAsrProvider>({
  storageKey: 'exomind:voiceShortcutAsrProvider',
  eventName: 'exomind:voice-shortcut-asr-provider-changed',
  defaultValue: 'volcano',
  normalize: normalizeProvider,
  persistMode: 'runtime-preferred',
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

export function getVoiceShortcutAsrProviderLabel(_provider: VoiceShortcutAsrProvider): string {
  return '火山';
}
