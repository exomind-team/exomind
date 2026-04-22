import { createConfigModule } from './config-factory';

export const PERF_LOGGING_ENABLED_STORAGE_KEY = 'exomind:perfLoggingEnabled';
export const PERF_LOGGING_ENABLED_CHANGED_EVENT =
  'exomind:perf-logging-enabled-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const _module = createConfigModule<boolean>({
  storageKey: PERF_LOGGING_ENABLED_STORAGE_KEY,
  eventName: PERF_LOGGING_ENABLED_CHANGED_EVENT,
  defaultValue: false,
  normalize: normalizeBoolean,
  persistMode: 'runtime-preferred',
});

export function getPerfLoggingEnabled(): boolean {
  return _module.get();
}

export function setPerfLoggingEnabled(enabled: boolean): void {
  _module.set(enabled);
}

export function subscribePerfLoggingEnabledChanges(
  listener: (enabled: boolean) => void,
): () => void {
  return _module.subscribe(listener);
}
