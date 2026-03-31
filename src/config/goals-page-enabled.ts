import { createConfigModule } from './config-factory';

const GOALS_PAGE_ENABLED_STORAGE_KEY = 'exomind:goalsPageEnabled';
const GOALS_PAGE_ENABLED_CHANGED_EVENT = 'exomind:goals-page-enabled-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const goalsPageEnabledModule = createConfigModule<boolean>({
  storageKey: GOALS_PAGE_ENABLED_STORAGE_KEY,
  eventName: GOALS_PAGE_ENABLED_CHANGED_EVENT,
  defaultValue: false,
  normalize: normalizeBoolean,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

export function getGoalsPageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return goalsPageEnabledModule.get();
}

export function setGoalsPageEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  goalsPageEnabledModule.set(enabled);
}

export function subscribeGoalsPageEnabledChanges(listener: (enabled: boolean) => void): () => void {
  return goalsPageEnabledModule.subscribe(listener);
}
