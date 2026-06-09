import { createConfigModule } from './config-factory';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue !== 'false';
}

const _module = createConfigModule<boolean>({
  storageKey: 'exomind:taskPageFuzzySearchEnabled',
  eventName: 'exomind:task-page-fuzzy-search-changed',
  defaultValue: true,
  normalize: normalizeBoolean,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'runtime-preferred',
});

export function getTaskPageFuzzySearchEnabled(): boolean {
  return _module.get();
}

export function setTaskPageFuzzySearchEnabled(enabled: boolean): boolean {
  return _module.set(enabled);
}

export function subscribeTaskPageFuzzySearchChanges(listener: (enabled: boolean) => void): () => void {
  return _module.subscribe(listener);
}
