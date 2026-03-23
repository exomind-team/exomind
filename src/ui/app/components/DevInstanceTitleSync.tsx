import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  formatDevInstanceWindowTitle,
  isDevInstanceDiagnosticsEnabled,
} from '@/config/dev-instance-diagnostics';

export function DevInstanceTitleSync(): null {
  useEffect(() => {
    if (!isDevInstanceDiagnosticsEnabled()) {
      return;
    }

    const title = formatDevInstanceWindowTitle();
    document.title = title;

    void (async () => {
      if (!await isTauri()) {
        return;
      }

      try {
        await getCurrentWindow().setTitle(title);
      } catch {
        // Ignore dev-only title sync failures（忽略开发态标题同步失败）
      }
    })();
  }, []);

  return null;
}
