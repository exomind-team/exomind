import { invoke } from '@tauri-apps/api/core';
import type { IClipboardPort } from '@/lib/environment/interfaces/clipboard.port';

export class TauriClipboardAdapter implements IClipboardPort {
  isAvailable(): boolean {
    return true;
  }

  async readText(): Promise<string> {
    try {
      const text = await invoke<string>('plugin:clipboard-manager|read_text');
      return typeof text === 'string' ? text : '';
    } catch (tauriError) {
      if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function') {
        return navigator.clipboard.readText();
      }
      throw tauriError;
    }
  }

  async writeText(text: string): Promise<void> {
    try {
      await invoke('plugin:clipboard-manager|write_text', { text });
      return;
    } catch (tauriError) {
      if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return;
      }
      throw tauriError;
    }
  }
}
