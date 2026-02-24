import { invoke } from '@tauri-apps/api/core';
import type { IClipboardPort } from '@/lib/environment/interfaces/clipboard.port';

export class TauriClipboardAdapter implements IClipboardPort {
  isAvailable(): boolean {
    return true;
  }

  async readText(): Promise<string> {
    const text = await invoke<string>('plugin:clipboard-manager|read_text');
    return typeof text === 'string' ? text : '';
  }

  async writeText(text: string): Promise<void> {
    await invoke('plugin:clipboard-manager|write_text', { text });
  }
}
