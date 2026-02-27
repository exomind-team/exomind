import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  getCurrentVersion,
  checkForUpdate,
  getVersions,
  downloadUpdate,
  getPlatform,
  createAutoCheckController,
  type UpdateInfo,
} from '@/lib/services/update.service';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.2.3'),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchJson(data: unknown, ok = true, status = 200) {
  const res = {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  } as unknown as Response;
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
}

function mockFetchBinary(data: Uint8Array, ok = true, status = 200) {
  const res = {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    arrayBuffer: () => Promise.resolve(data.buffer.slice(0)),
  } as unknown as Response;
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(res);
}

// ---------------------------------------------------------------------------
// getCurrentVersion()
// ---------------------------------------------------------------------------

describe('getCurrentVersion', () => {
  it('returns version from Tauri API', async () => {
    const version = await getCurrentVersion();
    expect(version).toBe('1.2.3');
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate()
// ---------------------------------------------------------------------------

describe('checkForUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns update info when update is available', async () => {
    const apiResponse = {
      has_update: true,
      current_version: '1.0.0',
      latest_version: '2.0.0',
      download_url: '/api/download/release/v2.0.0/windows-x64',
      size: 50000000,
      sha256: 'abc123',
      published_at: '2026-02-27T14:30:00Z',
    };
    const spy = mockFetchJson(apiResponse);

    const result = await checkForUpdate({
      channel: 'release',
      platform: 'windows-x64',
      currentVersion: '1.0.0',
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe('2.0.0');
    expect(result.downloadUrl).toBe('/api/download/release/v2.0.0/windows-x64');
    expect(result.size).toBe(50000000);
    expect(spy).toHaveBeenCalledTimes(1);

    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('/api/update/check');
    expect(url).toContain('channel=release');
    expect(url).toContain('platform=windows-x64');
    expect(url).toContain('current_version=1.0.0');
  });

  it('returns no update when versions match', async () => {
    const apiResponse = {
      has_update: false,
      current_version: '1.0.0',
      latest_version: '1.0.0',
    };
    mockFetchJson(apiResponse);

    const result = await checkForUpdate({
      channel: 'release',
      platform: 'windows-x64',
      currentVersion: '1.0.0',
    });

    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe('1.0.0');
    expect(result.downloadUrl).toBeUndefined();
  });

  it('throws on fetch error', async () => {
    mockFetchJson({ error: 'Not found' }, false, 404);

    await expect(
      checkForUpdate({
        channel: 'release',
        platform: 'windows-x64',
        currentVersion: '1.0.0',
      }),
    ).rejects.toThrow();
  });

  it('throws on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    await expect(
      checkForUpdate({
        channel: 'release',
        platform: 'windows-x64',
        currentVersion: '1.0.0',
      }),
    ).rejects.toThrow('Network error');
  });

  it('uses preview channel correctly', async () => {
    const apiResponse = {
      has_update: true,
      current_version: '1.0.0',
      latest_version: '1.1.0-build.20260227',
      download_url: '/api/download/preview/v1.1.0-build.20260227/windows-x64',
      size: 50000000,
      sha256: 'def456',
      published_at: '2026-02-27T14:30:00Z',
    };
    const spy = mockFetchJson(apiResponse);

    await checkForUpdate({
      channel: 'preview',
      platform: 'windows-x64',
      currentVersion: '1.0.0',
    });

    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('channel=preview');
  });
});

// ---------------------------------------------------------------------------
// getVersions()
// ---------------------------------------------------------------------------

describe('getVersions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches release versions', async () => {
    const apiResponse = {
      channel: 'release',
      latest: {
        version: '0.3.3',
        published_at: '2026-02-27T14:30:00Z',
        assets: {
          'windows-x64': { url: 'release/v0.3.3/ExoMind-0.3.3-windows-x64-setup.exe', size: 50000000 },
        },
      },
    };
    const spy = mockFetchJson(apiResponse);

    const result = await getVersions('release');

    expect(Array.isArray(result)).toBe(true);
    expect(result[0].version).toBe('0.3.3');
    expect(result[0].publishedAt).toBe('2026-02-27T14:30:00Z');
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('channel=release');
  });

  it('fetches preview versions with version list', async () => {
    const apiResponse = {
      channel: 'preview',
      latest: {
        version: '0.3.4-build.20260227T1430',
        published_at: '2026-02-27T14:30:00Z',
        assets: {},
      },
      versions: [
        { version: '0.3.4-build.20260227T1430', published_at: '2026-02-27T14:30:00Z' },
        { version: '0.3.4-build.20260226T1000', published_at: '2026-02-26T10:00:00Z' },
      ],
    };
    mockFetchJson(apiResponse);

    const result = await getVersions('preview');

    expect(result).toHaveLength(2);
    expect(result[0].version).toBe('0.3.4-build.20260227T1430');
    expect(result[1].publishedAt).toBe('2026-02-26T10:00:00Z');
  });

  it('throws on fetch error', async () => {
    mockFetchJson({ error: 'Server error' }, false, 500);

    await expect(getVersions('release')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// downloadUpdate()
// ---------------------------------------------------------------------------

describe('downloadUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens download URL via Tauri opener', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');

    await downloadUpdate('/api/download/release/v2.0.0/windows-x64');

    expect(openUrl).toHaveBeenCalledTimes(1);
    const calledUrl = (openUrl as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://exo-mind.ai/api/download/release/v2.0.0/windows-x64');
  });

  it('verifies SHA-256 before opening URL', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const payload = new TextEncoder().encode('exo-update-binary');
    const sha256 = bytesToHex(nobleSha256(payload));
    const fetchSpy = mockFetchBinary(payload);

    await downloadUpdate('/api/download/release/v2.0.0/windows-x64', sha256);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('https://exo-mind.ai/api/download/release/v2.0.0/windows-x64');
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it('throws when SHA-256 mismatches and should not open URL', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const payload = new TextEncoder().encode('tampered-binary');
    mockFetchBinary(payload);

    await expect(
      downloadUpdate(
        '/api/download/release/v2.0.0/windows-x64',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).rejects.toThrow('SHA-256 mismatch');

    expect(openUrl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Network error scenarios
// ---------------------------------------------------------------------------

describe('checkForUpdate - network error scenarios', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle network timeout (fetch rejects)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      checkForUpdate({
        channel: 'release',
        platform: 'windows-x64',
        currentVersion: '0.3.0',
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('should handle AbortError', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    await expect(
      checkForUpdate({
        channel: 'release',
        platform: 'windows-x64',
        currentVersion: '0.3.0',
      }),
    ).rejects.toThrow('The operation was aborted.');
  });
});

describe('getVersions - network error scenarios', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getVersions('release')).rejects.toThrow('Failed to fetch');
  });
});

// ---------------------------------------------------------------------------
// getPlatform()
// ---------------------------------------------------------------------------

describe('getPlatform', () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it('returns unknown for unrecognized platform', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (PlayStation 5)',
      configurable: true,
    });

    expect(getPlatform()).toBe('unknown');
  });
});

describe('createAutoCheckController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('isolates timers across multiple controllers', () => {
    const c1 = createAutoCheckController();
    const c2 = createAutoCheckController();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    c1.start('hourly', cb1);
    c2.start('hourly', cb2);
    c1.stop();
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('does not start timer for manual interval', () => {
    const c = createAutoCheckController();
    const cb = vi.fn();

    c.start('manual', cb);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(cb).not.toHaveBeenCalled();
  });
});
