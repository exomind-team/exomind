import { createConfigModule } from './config-factory';

export const VOICE_AUTO_RECORD_KEY = 'exomind:voice-auto-record';

const voiceAutoRecordModule = createConfigModule<boolean>({
  storageKey: VOICE_AUTO_RECORD_KEY,
  eventName: 'exomind:voice-auto-record-changed',
  defaultValue: true,
  normalize: (rawValue) => rawValue !== '0' && rawValue !== 'false',
  serialize: (value) => (value ? '1' : '0'),
});

export function getVoiceAutoRecordEnabled(): boolean {
  return voiceAutoRecordModule.get();
}

export function setVoiceAutoRecordEnabled(enabled: boolean): boolean {
  return voiceAutoRecordModule.set(enabled);
}

export function subscribeVoiceAutoRecordChanges(listener: (enabled: boolean) => void): () => void {
  return voiceAutoRecordModule.subscribe(listener);
}
