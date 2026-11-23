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

/** Reads plain text only; callers must first make the clipboard read explicit. */
export async function readBetaMessageClipboard(): Promise<string> {
  try {
    if (isTauri()) return await invoke<string>('plugin:clipboard-manager|read_text');
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch {
    throw new Error('无法读取剪贴板文字；请检查系统权限，或直接在邀请框中粘贴');
  }
  throw new Error('当前环境不支持读取剪贴板文字；请直接在邀请框中使用系统粘贴');
}
