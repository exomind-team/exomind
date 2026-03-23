import type { IClipboardPort } from '@/lib/environment/interfaces/clipboard.port';

function createNamedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function copyTextByExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed; left:-9999px; top:-9999px; opacity:0;';
  document.body.appendChild(textarea);

  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
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
    const secure = typeof window !== 'undefined' && window.isSecureContext;
    const hasNativeWrite = typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
    const insecureContextError = createNamedError('InsecureContextError', 'clipboard requires secure context');
    let fallbackError: Error | null = null;

    if (secure && hasNativeWrite) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        fallbackError = error instanceof Error ? error : new Error('clipboard write failed');
      }
    } else if (!secure) {
      fallbackError = insecureContextError;
    } else {
      fallbackError = createNamedError('NotSupportedError', 'clipboard write not supported');
    }

    if (copyTextByExecCommand(text)) {
      return;
    }

    throw fallbackError ?? createNamedError('NotSupportedError', 'clipboard write not supported');
  }
}
