import { createConfigModule } from './config-factory';

export const SYNC_AUTOMATION_ENABLED_STORAGE_KEY =
  'exomind:syncAutomationEnabled';
export const SYNC_AUTOMATION_ENABLED_CHANGED_EVENT =
  'exomind:sync-automation-enabled-changed';

function normalizeBoolean(rawValue: string | null | undefined): boolean {
  return rawValue !== 'false';
}

const _module = createConfigModule<boolean>({
  storageKey: SYNC_AUTOMATION_ENABLED_STORAGE_KEY,
  eventName: SYNC_AUTOMATION_ENABLED_CHANGED_EVENT,
  defaultValue: true,
  normalize: normalizeBoolean,
  persistMode: 'runtime-preferred',
});

export function getSyncAutomationEnabled(): boolean {
  return _module.get();
}

export function setSyncAutomationEnabled(enabled: boolean): void {
  _module.set(enabled);
}

export function subscribeSyncAutomationEnabledChanges(
  listener: (enabled: boolean) => void,
): () => void {
  return _module.subscribe(listener);
}
