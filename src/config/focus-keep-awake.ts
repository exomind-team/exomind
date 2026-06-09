import { createConfigModule } from './config-factory';

export const FOCUS_KEEP_AWAKE_STORAGE_KEY = 'exomind:focusKeepAwakeEnabled';
export const FOCUS_KEEP_AWAKE_CHANGED_EVENT = 'exomind:focus-keep-awake-changed';

function normalizeFocusKeepAwakeEnabled(rawValue: string | null | undefined): boolean {
  return rawValue !== 'false';
}

const focusKeepAwakeModule = createConfigModule<boolean>({
  storageKey: FOCUS_KEEP_AWAKE_STORAGE_KEY,
  eventName: FOCUS_KEEP_AWAKE_CHANGED_EVENT,
  defaultValue: true,
  normalize: normalizeFocusKeepAwakeEnabled,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'localStorage',
});

export function getFocusKeepAwakeEnabled(): boolean {
  return focusKeepAwakeModule.get();
}

export function setFocusKeepAwakeEnabled(enabled: boolean): boolean {
  return focusKeepAwakeModule.set(enabled);
}

export function toggleFocusKeepAwakeEnabled(): boolean {
  return focusKeepAwakeModule.set(!focusKeepAwakeModule.get());
}

export function subscribeFocusKeepAwakeChanges(
  listener: (enabled: boolean) => void,
): () => void {
  return focusKeepAwakeModule.subscribe(listener);
}
