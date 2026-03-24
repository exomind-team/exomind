import { createConfigModule } from './config-factory';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const _module = createConfigModule<boolean>({
  storageKey: 'exomind:developerMode',
  eventName: 'exomind:developer-mode-changed',
  defaultValue: false,
  normalize: normalizeBoolean,
});

export function getDeveloperModeEnabled(): boolean {
  return _module.get();
}

export function setDeveloperModeEnabled(enabled: boolean): void {
  _module.set(enabled);
}

export function subscribeDeveloperModeChanges(listener: (enabled: boolean) => void): () => void {
  return _module.subscribe(listener);
}
