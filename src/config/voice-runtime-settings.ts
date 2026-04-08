import { createConfigModule } from './config-factory';

export const VOICE_RUNTIME_PROVIDER_VALUES = ['doubao-o2-realtime'] as const;
export const VOICE_RUNTIME_CLOUD_SESSION_POLICY_VALUES = [
  'on-demand',
  'foreground-persistent',
] as const;

export type VoiceRuntimeProvider = (typeof VOICE_RUNTIME_PROVIDER_VALUES)[number];
export type VoiceRuntimeCloudSessionPolicy =
  (typeof VOICE_RUNTIME_CLOUD_SESSION_POLICY_VALUES)[number];

const VOICE_RUNTIME_ENABLED_KEY = 'exomind:voiceRuntimeEnabled';
const VOICE_RUNTIME_PROVIDER_KEY = 'exomind:voiceRuntimeProvider';
const VOICE_RUNTIME_CLOUD_SESSION_POLICY_KEY = 'exomind:voiceRuntimeCloudSessionPolicy';
const VOICE_RUNTIME_AUTO_SPEAK_ENABLED_KEY = 'exomind:voiceRuntimeAutoSpeakEnabled';
const VOICE_RUNTIME_LAB_NAV_ENABLED_KEY = 'exomind:voiceRuntimeLabNavEnabled';

function normalizeBoolean(value: string | null | undefined): boolean {
  return value === '1' || value === 'true';
}

function normalizeVoiceRuntimeProvider(
  value: string | null | undefined,
): VoiceRuntimeProvider {
  return VOICE_RUNTIME_PROVIDER_VALUES.includes(value as VoiceRuntimeProvider)
    ? (value as VoiceRuntimeProvider)
    : 'doubao-o2-realtime';
}

function normalizeVoiceRuntimeCloudSessionPolicy(
  value: string | null | undefined,
): VoiceRuntimeCloudSessionPolicy {
  return VOICE_RUNTIME_CLOUD_SESSION_POLICY_VALUES.includes(
    value as VoiceRuntimeCloudSessionPolicy,
  )
    ? (value as VoiceRuntimeCloudSessionPolicy)
    : 'on-demand';
}

const voiceRuntimeEnabledModule = createConfigModule<boolean>({
  storageKey: VOICE_RUNTIME_ENABLED_KEY,
  eventName: 'exomind:voice-runtime-enabled-changed',
  defaultValue: false,
  normalize: normalizeBoolean,
  serialize: (value) => (value ? '1' : '0'),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeProviderModule = createConfigModule<VoiceRuntimeProvider>({
  storageKey: VOICE_RUNTIME_PROVIDER_KEY,
  eventName: 'exomind:voice-runtime-provider-changed',
  defaultValue: 'doubao-o2-realtime',
  normalize: normalizeVoiceRuntimeProvider,
  persistMode: 'runtime-preferred',
});

const voiceRuntimeCloudSessionPolicyModule =
  createConfigModule<VoiceRuntimeCloudSessionPolicy>({
    storageKey: VOICE_RUNTIME_CLOUD_SESSION_POLICY_KEY,
    eventName: 'exomind:voice-runtime-cloud-session-policy-changed',
    defaultValue: 'on-demand',
    normalize: normalizeVoiceRuntimeCloudSessionPolicy,
    persistMode: 'runtime-preferred',
  });

const voiceRuntimeAutoSpeakEnabledModule = createConfigModule<boolean>({
  storageKey: VOICE_RUNTIME_AUTO_SPEAK_ENABLED_KEY,
  eventName: 'exomind:voice-runtime-auto-speak-enabled-changed',
  defaultValue: true,
  normalize: (value) => value == null ? true : normalizeBoolean(value),
  serialize: (value) => (value ? '1' : '0'),
  persistMode: 'runtime-preferred',
});

const voiceRuntimeLabNavEnabledModule = createConfigModule<boolean>({
  storageKey: VOICE_RUNTIME_LAB_NAV_ENABLED_KEY,
  eventName: 'exomind:voice-runtime-lab-nav-enabled-changed',
  defaultValue: false,
  normalize: (value) => value == null ? false : normalizeBoolean(value),
  serialize: (value) => (value ? '1' : '0'),
  persistMode: 'runtime-preferred',
});

export function getVoiceRuntimeEnabled(): boolean {
  return voiceRuntimeEnabledModule.get();
}

export function setVoiceRuntimeEnabled(value: boolean): boolean {
  return voiceRuntimeEnabledModule.set(value);
}

export function subscribeVoiceRuntimeEnabledChanges(
  listener: (value: boolean) => void,
): () => void {
  return voiceRuntimeEnabledModule.subscribe(listener);
}

export function getVoiceRuntimeProvider(): VoiceRuntimeProvider {
  return voiceRuntimeProviderModule.get();
}

export function setVoiceRuntimeProvider(
  value: VoiceRuntimeProvider,
): VoiceRuntimeProvider {
  return voiceRuntimeProviderModule.set(value);
}

export function subscribeVoiceRuntimeProviderChanges(
  listener: (value: VoiceRuntimeProvider) => void,
): () => void {
  return voiceRuntimeProviderModule.subscribe(listener);
}

export function getVoiceRuntimeCloudSessionPolicy(): VoiceRuntimeCloudSessionPolicy {
  return voiceRuntimeCloudSessionPolicyModule.get();
}

export function setVoiceRuntimeCloudSessionPolicy(
  value: VoiceRuntimeCloudSessionPolicy,
): VoiceRuntimeCloudSessionPolicy {
  return voiceRuntimeCloudSessionPolicyModule.set(value);
}

export function subscribeVoiceRuntimeCloudSessionPolicyChanges(
  listener: (value: VoiceRuntimeCloudSessionPolicy) => void,
): () => void {
  return voiceRuntimeCloudSessionPolicyModule.subscribe(listener);
}

export function getVoiceRuntimeAutoSpeakEnabled(): boolean {
  return voiceRuntimeAutoSpeakEnabledModule.get();
}

export function setVoiceRuntimeAutoSpeakEnabled(value: boolean): boolean {
  return voiceRuntimeAutoSpeakEnabledModule.set(value);
}

export function subscribeVoiceRuntimeAutoSpeakEnabledChanges(
  listener: (value: boolean) => void,
): () => void {
  return voiceRuntimeAutoSpeakEnabledModule.subscribe(listener);
}

export function getVoiceRuntimeLabNavEnabled(): boolean {
  return voiceRuntimeLabNavEnabledModule.get();
}

export function setVoiceRuntimeLabNavEnabled(value: boolean): boolean {
  return voiceRuntimeLabNavEnabledModule.set(value);
}

export function subscribeVoiceRuntimeLabNavEnabledChanges(
  listener: (value: boolean) => void,
): () => void {
  return voiceRuntimeLabNavEnabledModule.subscribe(listener);
}
