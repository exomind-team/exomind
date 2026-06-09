import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMarkdownLinkTarget } from '@/lib/utils/open-external';

describe('resolveMarkdownLinkTarget', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats absolute eventlog permalinks from another local origin as internal app routes', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'http://localhost:1420',
      },
    });

    const result = resolveMarkdownLinkTarget('http://localhost:1620/eventlog/record?event=evt-1&locate=1');

    expect(result.kind).toBe('internal');
    expect(result.url?.pathname).toBe('/eventlog/record');
    expect(result.url?.search).toBe('?event=evt-1&locate=1');
    expect(result.url?.origin).toBe('http://localhost:1420');
  });

  it('treats app.local eventlog permalinks as internal app routes when current app is local', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'https://tauri.localhost',
      },
    });

    const result = resolveMarkdownLinkTarget('http://app.local/eventlog/record?event=evt-2&locate=1');

    expect(result.kind).toBe('internal');
    expect(result.url?.pathname).toBe('/eventlog/record');
    expect(result.url?.search).toBe('?event=evt-2&locate=1');
    expect(result.url?.origin).toBe('https://tauri.localhost');
  });

  it('keeps unrelated absolute urls external', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'http://localhost:1420',
      },
    });

    const result = resolveMarkdownLinkTarget('https://example.com/docs');

    expect(result.kind).toBe('external');
    expect(result.url?.toString()).toBe('https://example.com/docs');
  });

  it('keeps same-path eventlog urls on non-local origins external', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'http://localhost:1420',
      },
    });

    const result = resolveMarkdownLinkTarget('https://example.com/eventlog/record?event=evt-9&locate=1');

    expect(result.kind).toBe('external');
    expect(result.url?.toString()).toBe('https://example.com/eventlog/record?event=evt-9&locate=1');
  });
});
