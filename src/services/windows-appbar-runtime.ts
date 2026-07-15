import { invoke, isTauri } from '@tauri-apps/api/core';

export interface WindowsAppBarPreference {
  enabled: boolean;
  widthDip: number;
}

function isWindowsPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent ?? '');
}

export async function applyWindowsAppBarPreference(
  preference: WindowsAppBarPreference,
): Promise<void> {
  if (!(await isTauri()) || !isWindowsPlatform()) {
    return;
  }

  if (!preference.enabled) {
    await invoke('windows_appbar_detach');
    return;
  }

  await invoke('windows_appbar_attach_right', { widthDip: preference.widthDip });
}
