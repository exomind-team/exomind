import { invoke, isTauri } from '@tauri-apps/api/core';

/** Clipboard ownership stays at the Beta platform edge; no Alpha Runtime service is loaded. */
export async function writeBetaMessageClipboard(value: string): Promise<void> {
  if (isTauri()) {
    await invoke('plugin:clipboard-manager|write_text', { text: value });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  throw new Error('当前环境无法自动复制，请检查剪贴板权限后重试');
}
