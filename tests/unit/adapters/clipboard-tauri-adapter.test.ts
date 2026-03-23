import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { TauriClipboardAdapter } from '@/lib/adapters/clipboard-tauri-adapter';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('TauriClipboardAdapter', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    vi.restoreAllMocks();
  });

  it('uses tauri invoke for write by default', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const adapter = new TauriClipboardAdapter();

    await adapter.writeText('copy-from-tauri');

    expect(invoke).toHaveBeenCalledWith('plugin:clipboard-manager|write_text', { text: 'copy-from-tauri' });
  });

  it('falls back to navigator clipboard write when tauri invoke fails', async () => {
    const tauriError = new Error('clipboard command denied');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockRejectedValue(tauriError);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const adapter = new TauriClipboardAdapter();
    await adapter.writeText('copy-from-web');

    expect(invoke).toHaveBeenCalledWith('plugin:clipboard-manager|write_text', { text: 'copy-from-web' });
    expect(writeText).toHaveBeenCalledWith('copy-from-web');
  });

  it('falls back to navigator clipboard read when tauri invoke fails', async () => {
    const tauriError = new Error('clipboard command denied');
    const readText = vi.fn().mockResolvedValue('from-navigator');
    vi.mocked(invoke).mockRejectedValue(tauriError);
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText },
      configurable: true,
    });

    const adapter = new TauriClipboardAdapter();
    await expect(adapter.readText()).resolves.toBe('from-navigator');

    expect(invoke).toHaveBeenCalledWith('plugin:clipboard-manager|read_text');
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it('rethrows tauri error when both tauri and navigator clipboard are unavailable', async () => {
    const tauriError = new Error('clipboard command denied');
    vi.mocked(invoke).mockRejectedValue(tauriError);
    const adapter = new TauriClipboardAdapter();

    await expect(adapter.writeText('copy')).rejects.toBe(tauriError);
    await expect(adapter.readText()).rejects.toBe(tauriError);
  });
});
