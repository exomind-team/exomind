import { createConfigModule } from './config-factory';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const _module = createConfigModule<boolean>({
  storageKey: 'builtin.timeblock_summary.enabled',
  eventName: 'exomind:builtin-timeblock-summary-enabled-changed',
  defaultValue: false,
  normalize: normalizeBoolean,
  persistMode: 'runtime-preferred',
});

export function getBuiltinTimeblockSummaryEnabled(): boolean {
  return _module.get();
}

export function setBuiltinTimeblockSummaryEnabled(enabled: boolean): void {
  _module.set(enabled);
}

export function subscribeBuiltinTimeblockSummaryEnabledChanges(
  listener: (enabled: boolean) => void,
): () => void {
  return _module.subscribe(listener);
}
