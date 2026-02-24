import type { IClipboardPort } from '@/lib/environment/interfaces/clipboard.port';

function createNamedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

export class WebClipboardAdapter implements IClipboardPort {
  isAvailable(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }

    return window.isSecureContext && typeof navigator.clipboard?.readText === 'function';
  }

  async readText(): Promise<string> {
    if (typeof window === 'undefined' || !window.isSecureContext) {
      throw createNamedError('InsecureContextError', 'clipboard requires secure context');
    }

    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.readText !== 'function') {
      throw createNamedError('NotSupportedError', 'clipboard read not supported');
    }

    window.focus();
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
        return;
      }
      resolve();
    });

    return navigator.clipboard.readText();
  }

  async writeText(text: string): Promise<void> {
    if (typeof window === 'undefined' || !window.isSecureContext) {
      throw createNamedError('InsecureContextError', 'clipboard requires secure context');
    }

    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      throw createNamedError('NotSupportedError', 'clipboard write not supported');
    }

    await navigator.clipboard.writeText(text);
  }
}
