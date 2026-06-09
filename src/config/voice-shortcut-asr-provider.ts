import { createConfigModule } from './config-factory';

export const VOICE_SHORTCUT_ASR_PROVIDER_VALUES = ['moss', 'volcano', 'qwen-omni'] as const;
export type VoiceShortcutAsrProvider = (typeof VOICE_SHORTCUT_ASR_PROVIDER_VALUES)[number];

function normalizeProvider(rawValue: string | null | undefined): VoiceShortcutAsrProvider {
  if (rawValue === 'volcano') return 'volcano';
  if (rawValue === 'qwen-omni') return 'qwen-omni';
  return 'moss';
}

const _module = createConfigModule<VoiceShortcutAsrProvider>({
  storageKey: 'exomind:voiceShortcutAsrProvider',
  eventName: 'exomind:voice-shortcut-asr-provider-changed',
  defaultValue: 'moss',
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

export function getVoiceShortcutAsrProviderLabel(provider: VoiceShortcutAsrProvider): string {
  if (provider === 'volcano') return '火山';
  if (provider === 'qwen-omni') return 'Qwen Omni';
  return 'MOSS';
}
