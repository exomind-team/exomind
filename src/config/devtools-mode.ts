import { createConfigModule } from './config-factory';

const DEVTOOLS_ENABLED_STORAGE_KEY = 'exomind:devtoolsEnabled';
const DEVTOOLS_CHANGED_EVENT = 'exomind:devtools-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const devtoolsModule = createConfigModule<boolean>({
  storageKey: DEVTOOLS_ENABLED_STORAGE_KEY,
  eventName: DEVTOOLS_CHANGED_EVENT,
  defaultValue: false,
  normalize: normalizeBoolean,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

export function getDevtoolsEnabled(): boolean {
  return devtoolsModule.get();
}

export function setDevtoolsEnabled(enabled: boolean): void {
  devtoolsModule.set(enabled);
}

export function subscribeDevtoolsChanges(listener: (enabled: boolean) => void): () => void {
  return devtoolsModule.subscribe(listener);
}
