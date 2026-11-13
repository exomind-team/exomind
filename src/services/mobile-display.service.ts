import { invoke } from '@tauri-apps/api/core';
import { isTauriWindow } from '@/config/runtime-target';
import { getMobileFullscreenEnabled, setMobileFullscreenEnabled } from '@/config/mobile-fullscreen-preference';

export function isAndroidTauriDisplay(): boolean {
  return isTauriWindow() && typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
}

let displayUpdates: Promise<void> = Promise.resolve();

export async function applyMobileFullscreenPreference(enabled = getMobileFullscreenEnabled()): Promise<void> {
  if (!isAndroidTauriDisplay()) return;
  // Startup and later settings updates share one Activity. Preserve their order
  // so an older native result cannot restore the previous display mode.
  const update = displayUpdates.catch(() => {}).then(async () => {
    await invoke('mobile_fullscreen_set', { enabled });
  });
  displayUpdates = update;
  await update;
}

export async function changeMobileFullscreenPreference(enabled: boolean): Promise<boolean> {
  await applyMobileFullscreenPreference(enabled);
  return setMobileFullscreenEnabled(enabled);
}
