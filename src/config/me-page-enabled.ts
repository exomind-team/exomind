import { createConfigModule } from './config-factory';

const ME_PAGE_ENABLED_STORAGE_KEY = 'exomind:mePageEnabled';
const ME_PAGE_ENABLED_CHANGED_EVENT = 'exomind:me-page-enabled-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const mePageEnabledModule = createConfigModule<boolean>({
  storageKey: ME_PAGE_ENABLED_STORAGE_KEY,
  eventName: ME_PAGE_ENABLED_CHANGED_EVENT,
  defaultValue: false,
  normalize: normalizeBoolean,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

export function getMePageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return mePageEnabledModule.get();
}

export function setMePageEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  mePageEnabledModule.set(enabled);
}

export function subscribeMePageEnabledChanges(listener: (enabled: boolean) => void): () => void {
  return mePageEnabledModule.subscribe(listener);
}
