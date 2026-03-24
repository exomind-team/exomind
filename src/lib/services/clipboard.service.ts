import { ExoMindEnvironment } from '@/lib/environment/environment';
import type { IClipboardPort } from '@/lib/environment/interfaces/clipboard.port';

export type ClipboardFailureReason =
  | 'insecure-context'
  | 'not-supported'
  | 'not-focused'
  | 'permission-denied'
  | 'unknown';

export type ClipboardReadResult =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: ClipboardFailureReason;
      title: string;
      description: string;
      error: unknown;
    };

export type ClipboardWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: ClipboardFailureReason;
      title: string;
      description: string;
      error: unknown;
    };

type ClipboardEnvironmentLike = {
  clipboard: IClipboardPort;
};

function inferClipboardFailureReason(err: unknown): ClipboardFailureReason {
  const name = typeof err === 'object' && err && 'name' in err
    ? String((err as { name?: unknown }).name ?? '')
    : '';
  const message = typeof err === 'object' && err && 'message' in err
    ? String((err as { message?: unknown }).message ?? '').toLowerCase()
    : '';

  if (message.includes('secure context') || name === 'InsecureContextError') {
    return 'insecure-context';
  }
  if (name === 'NotSupportedError') {
    return 'not-supported';
  }
  if (message.includes('document is not focused')) {
    return 'not-focused';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'permission-denied';
  }
  return 'unknown';
}

function getClipboardFailureMessage(reason: ClipboardFailureReason): { title: string; description: string } {
  if (reason === 'insecure-context') {
    return {
      title: '当前页面不支持读取剪贴板',
      description: '请改用 localhost 或 https 访问；http://局域网IP 通常会被浏览器限制读取剪贴板。',
    };
  }

  if (reason === 'permission-denied') {
    return {
      title: '浏览器阻止读取剪贴板',
      description: '请在站点权限中允许剪贴板读取后重试，或直接在输入框内手动粘贴。',
    };
  }

  if (reason === 'not-focused') {
    return {
      title: '页面未激活，无法读取剪贴板',
      description: '请先点击页面任意位置再重试，或直接在输入框内手动粘贴。',
    };
  }

  if (reason === 'not-supported') {
    return {
      title: '当前页面环境不支持读取剪贴板',
      description: '请确认不是受限 WebView/内嵌页，并优先使用 localhost 或 https 访问；也可直接在输入框内手动粘贴。',
    };
  }

  return {
    title: '读取剪贴板失败，请重试',
    description: '你可以先点击输入框，再使用 Ctrl/Cmd+V（移动端长按）手动粘贴。',
  };
}

function getClipboardWriteFailureMessage(reason: ClipboardFailureReason): { title: string; description: string } {
  if (reason === 'insecure-context') {
    return {
      title: '当前页面不支持复制到剪贴板',
      description: '请改用 localhost 或 https 访问；http://局域网IP 通常会被浏览器限制剪贴板能力。',
    };
  }

  if (reason === 'permission-denied') {
    return {
      title: '浏览器阻止写入剪贴板',
      description: '请在站点权限中允许剪贴板写入后重试。',
    };
  }

  if (reason === 'not-supported') {
    return {
      title: '当前页面环境不支持复制',
      description: '请确认不是受限 WebView/内嵌页，或使用手动复制。',
    };
  }

  return {
    title: '复制失败，请重试',
    description: '你可以手动选中文本后复制。',
  };
}

export interface ClipboardService {
  readText(): Promise<ClipboardReadResult>;
  writeText(text: string): Promise<ClipboardWriteResult>;
  isAvailable(): boolean;
}

export class ClipboardServiceImpl implements ClipboardService {
  private readonly env: ClipboardEnvironmentLike;

  constructor(env?: ClipboardEnvironmentLike) {
    this.env = env ?? ExoMindEnvironment.getInstance();
  }

  isAvailable(): boolean {
    return this.env.clipboard.isAvailable();
  }

  async readText(): Promise<ClipboardReadResult> {
    try {
      const text = await this.env.clipboard.readText();
      return { ok: true, text };
    } catch (error) {
      const reason = inferClipboardFailureReason(error);
      const message = getClipboardFailureMessage(reason);
      return {
        ok: false,
        reason,
        title: message.title,
        description: message.description,
        error,
      };
    }
  }

  async writeText(text: string): Promise<ClipboardWriteResult> {
    try {
      await this.env.clipboard.writeText(text);
      return { ok: true };
    } catch (error) {
      const reason = inferClipboardFailureReason(error);
      const message = getClipboardWriteFailureMessage(reason);
      return {
        ok: false,
        reason,
        title: message.title,
        description: message.description,
        error,
      };
    }
  }
}

let clipboardServiceInstance: ClipboardService | null = null;

export function getClipboardService(): ClipboardService {
  if (!clipboardServiceInstance) {
    clipboardServiceInstance = new ClipboardServiceImpl();
  }
  return clipboardServiceInstance;
}
