import { createConfigModule } from './config-factory';

export const TIMEBLOCK_END_AUTO_OPEN_FOCUS_STORAGE_KEY = 'exomind:timeblockEndAutoOpenFocusEnabled';
export const TIMEBLOCK_END_AUTO_OPEN_FOCUS_CHANGED_EVENT = 'exomind:timeblock-end-auto-open-focus-changed';

function normalizeTimeblockEndAutoOpenFocusEnabled(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

const timeblockEndAutoOpenFocusModule = createConfigModule<boolean>({
  storageKey: TIMEBLOCK_END_AUTO_OPEN_FOCUS_STORAGE_KEY,
  eventName: TIMEBLOCK_END_AUTO_OPEN_FOCUS_CHANGED_EVENT,
  defaultValue: false,
  normalize: normalizeTimeblockEndAutoOpenFocusEnabled,
  serialize: (value) => String(Boolean(value)),
  persistMode: 'localStorage',
});

export function getTimeblockEndAutoOpenFocusEnabled(): boolean {
  return timeblockEndAutoOpenFocusModule.get();
}

export function setTimeblockEndAutoOpenFocusEnabled(enabled: boolean): boolean {
  return timeblockEndAutoOpenFocusModule.set(enabled);
}

export function subscribeTimeblockEndAutoOpenFocusChanges(
  listener: (enabled: boolean) => void,
): () => void {
  return timeblockEndAutoOpenFocusModule.subscribe(listener);
}
