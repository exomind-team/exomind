const WORKBENCH_LEGACY_SHIM_ENABLED_STORAGE_KEY = 'exomind:workbenchLegacyShimEnabled';

export function getWorkbenchLegacyShimEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(WORKBENCH_LEGACY_SHIM_ENABLED_STORAGE_KEY) === 'true';
}

export function setWorkbenchLegacyShimEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(WORKBENCH_LEGACY_SHIM_ENABLED_STORAGE_KEY, String(enabled));
}
