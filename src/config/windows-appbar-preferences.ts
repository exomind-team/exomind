import { createConfigModule } from './config-factory';

export const WINDOWS_APPBAR_ENABLED_STORAGE_KEY = 'exomind:windowsAppBarEnabled';
export const WINDOWS_APPBAR_ENABLED_CHANGED_EVENT = 'exomind:windows-appbar-enabled-changed';
export const WINDOWS_APPBAR_WIDTH_STORAGE_KEY = 'exomind:windowsAppBarWidthDip';
export const WINDOWS_APPBAR_WIDTH_CHANGED_EVENT = 'exomind:windows-appbar-width-changed';

export const DEFAULT_WINDOWS_APPBAR_WIDTH_DIP = 360;
export const MIN_WINDOWS_APPBAR_WIDTH_DIP = 220;
export const MAX_WINDOWS_APPBAR_WIDTH_DIP = 720;

function normalizeEnabled(rawValue: string | null | undefined): boolean {
  return rawValue === 'true';
}

export function normalizeWindowsAppBarWidthDip(rawValue: string | number | null | undefined): number {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WINDOWS_APPBAR_WIDTH_DIP;
  }
  return Math.min(MAX_WINDOWS_APPBAR_WIDTH_DIP, Math.max(MIN_WINDOWS_APPBAR_WIDTH_DIP, Math.round(parsed)));
}

const enabledModule = createConfigModule<boolean>({
  storageKey: WINDOWS_APPBAR_ENABLED_STORAGE_KEY,
  eventName: WINDOWS_APPBAR_ENABLED_CHANGED_EVENT,
  defaultValue: false,
  normalize: normalizeEnabled,
});

const widthModule = createConfigModule<number>({
  storageKey: WINDOWS_APPBAR_WIDTH_STORAGE_KEY,
  eventName: WINDOWS_APPBAR_WIDTH_CHANGED_EVENT,
  defaultValue: DEFAULT_WINDOWS_APPBAR_WIDTH_DIP,
  normalize: normalizeWindowsAppBarWidthDip,
  serialize: (value) => String(normalizeWindowsAppBarWidthDip(value)),
});

export const getWindowsAppBarEnabled = enabledModule.get;
export const setWindowsAppBarEnabled = enabledModule.set;
export const subscribeWindowsAppBarEnabledChanges = enabledModule.subscribe;
export const getWindowsAppBarWidthDip = widthModule.get;
export const setWindowsAppBarWidthDip = widthModule.set;
export const subscribeWindowsAppBarWidthChanges = widthModule.subscribe;
