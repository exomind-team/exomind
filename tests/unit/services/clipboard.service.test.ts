import { describe, expect, it, vi } from 'vitest';
import { ClipboardServiceImpl } from '@/lib/services/clipboard.service';
import type { IClipboardPort } from '@/lib/environment/interfaces/clipboard.port';

describe('clipboard service', () => {
  it('returns clipboard text when port succeeds', async () => {
    const clipboard: IClipboardPort = {
      readText: vi.fn().mockResolvedValue('from-port'),
      writeText: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    const service = new ClipboardServiceImpl({ clipboard });

    const result = await service.readText();
    expect(result).toEqual({ ok: true, text: 'from-port' });
  });

  it('maps insecure-context error to actionable message', async () => {
    const error = new Error('clipboard requires secure context');
    error.name = 'InsecureContextError';
    const clipboard: IClipboardPort = {
      readText: vi.fn().mockRejectedValue(error),
      writeText: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockReturnValue(false),
    };
    const service = new ClipboardServiceImpl({ clipboard });

    const result = await service.readText();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('insecure-context');
    expect(result.title).toBe('当前页面不支持读取剪贴板');
  });

  it('maps document-not-focused error to focus guidance', async () => {
    const error = new Error('Document is not focused');
    error.name = 'NotAllowedError';
    const clipboard: IClipboardPort = {
      readText: vi.fn().mockRejectedValue(error),
      writeText: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    const service = new ClipboardServiceImpl({ clipboard });

    const result = await service.readText();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-focused');
    expect(result.title).toBe('页面未激活，无法读取剪贴板');
  });

  it('maps unsupported error to environment guidance', async () => {
    const error = new Error('clipboard read not supported');
    error.name = 'NotSupportedError';
    const clipboard: IClipboardPort = {
      readText: vi.fn().mockRejectedValue(error),
      writeText: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockReturnValue(false),
    };
    const service = new ClipboardServiceImpl({ clipboard });

    const result = await service.readText();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-supported');
    expect(result.title).toBe('当前页面环境不支持读取剪贴板');
  });

  it('returns ok when write succeeds', async () => {
    const clipboard: IClipboardPort = {
      readText: vi.fn().mockResolvedValue('unused'),
      writeText: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    const service = new ClipboardServiceImpl({ clipboard });

    const result = await service.writeText('hello');
    expect(result).toEqual({ ok: true });
  });

  it('maps write failure to copy message', async () => {
    const error = new Error('write denied');
    error.name = 'NotAllowedError';
    const clipboard: IClipboardPort = {
      readText: vi.fn().mockResolvedValue('unused'),
      writeText: vi.fn().mockRejectedValue(error),
      isAvailable: vi.fn().mockReturnValue(true),
    };
    const service = new ClipboardServiceImpl({ clipboard });

    const result = await service.writeText('hello');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('permission-denied');
    expect(result.title).toBe('浏览器阻止写入剪贴板');
  });
});
