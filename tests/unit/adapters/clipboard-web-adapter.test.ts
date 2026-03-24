import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebClipboardAdapter } from '@/lib/adapters/clipboard-web-adapter';

describe('WebClipboardAdapter', () => {
  const originalSecureContext = window.isSecureContext;
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'isSecureContext', { value: originalSecureContext, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: originalExecCommand, configurable: true });
    vi.restoreAllMocks();
  });

  it('uses native clipboard write in secure context when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const adapter = new WebClipboardAdapter();
    await adapter.writeText('native-copy');

    expect(writeText).toHaveBeenCalledWith('native-copy');
  });

  it('falls back to execCommand copy when insecure context', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    const adapter = new WebClipboardAdapter();
    await adapter.writeText('fallback-copy');

    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand copy when native clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('native denied'));
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    const adapter = new WebClipboardAdapter();
    await adapter.writeText('fallback-after-native-error');

    expect(writeText).toHaveBeenCalledWith('fallback-after-native-error');
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('throws insecure-context error when both native and fallback are unavailable', async () => {
    const adapter = new WebClipboardAdapter();

    await expect(adapter.writeText('copy')).rejects.toMatchObject({
      name: 'InsecureContextError',
      message: 'clipboard requires secure context',
    });
  });
});
