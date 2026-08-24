import { useEffect } from 'react';
import {
  getWindowsAppBarEnabled,
  getWindowsAppBarWidthDip,
} from '@/config/windows-appbar-preferences';
import { applyWindowsAppBarPreference } from '@/services/windows-appbar-runtime';

export function WindowsAppBarController() {
  useEffect(() => {
    void applyWindowsAppBarPreference({
      enabled: getWindowsAppBarEnabled(),
      widthDip: getWindowsAppBarWidthDip(),
    }).catch((error) => {
      console.warn('[WindowsAppBar] startup sync failed（启动同步失败）', error);
    });
  }, []);

  return null;
}
