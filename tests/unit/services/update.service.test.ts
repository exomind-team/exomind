import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  getCurrentVersion,
  checkForUpdate,
  getVersions,
  downloadUpdate,
  getPlatform,
  createAutoCheckController,
  compareVersions,
  type UpdateInfo,
  type VersionsApiResponse,
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

function makeVersionsResponse(overrides?: Partial<VersionsApiResponse>): VersionsApiResponse {
  return {
    channel: 'preview',
    latest: {
      version: '0.3.4-build.20260227T1430',
      tag: 'build/v0.3.4-build.20260227T1430',
      published_at: '2026-02-27T14:30:00Z',
      assets: {
        'windows-x64-setup': {
          url: 'preview/v0.3.4-build.20260227T1430/ExoMind-0.3.4-windows-x64-setup.exe',
          size: 50000000,
          sha256: 'abc123',
        },
        'android-arm64': {
          url: 'preview/v0.3.4-build.20260227T1430/ExoMind-0.3.4-android-arm64.apk',
          size: 30000000,
          sha256: 'def456',
        },
      },
    },
    versions: [
      {
        version: '0.3.4-build.20260227T1430',
        tag: 'build/v0.3.4-build.20260227T1430',
        published_at: '2026-02-27T14:30:00Z',
        version_dir: 'preview/v0.3.4-build.20260227T1430',
      },
    ],
    retention: 15,
    ...overrides,
  };
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
// compareVersions()
// ---------------------------------------------------------------------------

describe('compareVersions', () => {
  it('compares major versions', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });

  it('compares minor versions', () => {
    expect(compareVersions('0.4.0', '0.3.0')).toBe(1);
    expect(compareVersions('0.3.0', '0.4.0')).toBe(-1);
  });

  it('compares patch versions', () => {
    expect(compareVersions('0.3.5', '0.3.4')).toBe(1);
    expect(compareVersions('0.3.4', '0.3.5')).toBe(-1);
  });

  it('equal versions return 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('strips v prefix', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });

  it('release > prerelease for same version', () => {
    expect(compareVersions('0.3.4', '0.3.4-build.20260227T1430')).toBe(1);
    expect(compareVersions('0.3.4-build.20260227T1430', '0.3.4')).toBe(-1);
  });

  it('compares prerelease strings by segments', () => {
    expect(compareVersions('0.3.4-build.20260227T1430', '0.3.4-build.20260226T1000')).toBe(1);
    expect(compareVersions('0.3.4-build.20260226T1000', '0.3.4-build.20260227T1430')).toBe(-1);
  });

  it('compares new format with sequential build numbers numerically', () => {
    expect(compareVersions('0.3.3-build.26.20260227T1415Z', '0.3.3-build.9.20260227T1000Z')).toBe(1);
    expect(compareVersions('0.3.3-build.9.20260227T1000Z', '0.3.3-build.26.20260227T1415Z')).toBe(-1);
  });

  it('compares new format build numbers correctly at boundary', () => {
    expect(compareVersions('0.3.3-build.10.20260227T1000Z', '0.3.3-build.9.20260227T0900Z')).toBe(1);
  });

  it('new format is considered newer than old format for same version', () => {
    // Segment comparison: "build" == "build", then "26" vs "20260227T1247"
    // String compare: '6' > '0' at index 1, so new format > old format ✓
    expect(compareVersions('0.3.3-build.26.20260227T1415Z', '0.3.3-build.20260227T1247')).toBe(1);
  });

  it('equal prerelease returns 0', () => {
    expect(compareVersions('0.3.4-build.20260227T1430', '0.3.4-build.20260227T1430')).toBe(0);
  });

  it('higher patch beats lower patch with prerelease', () => {
    expect(compareVersions('0.3.5', '0.3.4-build.20260227T1430')).toBe(1);
  });

  it('compares beta prereleases', () => {
    expect(compareVersions('0.3.4-beta.2', '0.3.4-beta.1')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate()
// ---------------------------------------------------------------------------

describe('checkForUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns update info when newer version available', async () => {
    const apiResponse = makeVersionsResponse();
    const spy = mockFetchJson(apiResponse);

    const result = await checkForUpdate({
      channel: 'preview',
      platform: 'windows-x64',
      currentVersion: '0.3.3',
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe('0.3.4-build.20260227T1430');
    expect(result.downloadUrl).toBe(
      'preview/v0.3.4-build.20260227T1430/ExoMind-0.3.4-windows-x64-setup.exe',
    );
    expect(result.size).toBe(50000000);
    expect(result.sha256).toBe('abc123');
    expect(spy).toHaveBeenCalledTimes(1);

    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('/api/versions');
    expect(url).toContain('channel=preview');
  });

  it('maps windows-x64 platform to windows-x64-setup asset key', async () => {
    const apiResponse = makeVersionsResponse();
    mockFetchJson(apiResponse);

    const result = await checkForUpdate({
      channel: 'preview',
      platform: 'windows-x64',
      currentVersion: '0.3.3',
    });

    expect(result.downloadUrl).toContain('windows-x64-setup');
  });

  it('maps android-arm64 platform directly', async () => {
    const apiResponse = makeVersionsResponse();
    mockFetchJson(apiResponse);

    const result = await checkForUpdate({
      channel: 'preview',
      platform: 'android-arm64',
      currentVersion: '0.3.3',
    });

    expect(result.downloadUrl).toContain('android-arm64');
    expect(result.size).toBe(30000000);
  });

  it('returns no update when versions match', async () => {
    const apiResponse = makeVersionsResponse({
      latest: {
        version: '0.3.3',
        tag: 'release/v0.3.3',
        published_at: '2026-02-27T14:30:00Z',
        assets: {},
      },
    });
    mockFetchJson(apiResponse);

    const result = await checkForUpdate({
      channel: 'release',
      platform: 'windows-x64',
      currentVersion: '0.3.3',
    });

    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe('0.3.3');
    expect(result.downloadUrl).toBeUndefined();
  });

  it('returns no update when current is newer', async () => {
    const apiResponse = makeVersionsResponse({
      latest: {
        version: '0.3.2',
        tag: 'release/v0.3.2',
        published_at: '2026-02-20T10:00:00Z',
        assets: {},
      },
    });
    mockFetchJson(apiResponse);

    const result = await checkForUpdate({
      channel: 'release',
      platform: 'windows-x64',
      currentVersion: '0.3.3',
    });

    expect(result.hasUpdate).toBe(false);
  });

  it('handles null latest gracefully', async () => {
    const apiResponse = makeVersionsResponse({ latest: null });
    mockFetchJson(apiResponse);

    const result = await checkForUpdate({
      channel: 'release',
      platform: 'windows-x64',
      currentVersion: '0.3.3',
    });

    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe('0.3.3');
  });

  it('handles missing asset for platform', async () => {
    const apiResponse = makeVersionsResponse({
      latest: {
        version: '0.4.0',
        tag: 'release/v0.4.0',
        published_at: '2026-03-01T10:00:00Z',
        assets: {}, // no assets
      },
    });
    mockFetchJson(apiResponse);

    const result = await checkForUpdate({
      channel: 'release',
      platform: 'windows-x64',
      currentVersion: '0.3.3',
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.downloadUrl).toBeUndefined();
    expect(result.size).toBeUndefined();
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

  it('uses release channel correctly', async () => {
    const apiResponse = makeVersionsResponse({ channel: 'release' });
    const spy = mockFetchJson(apiResponse);

    await checkForUpdate({
      channel: 'release',
      platform: 'windows-x64',
      currentVersion: '0.3.3',
    });

    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('channel=release');
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
    const apiResponse = makeVersionsResponse({
      channel: 'release',
      latest: {
        version: '0.3.3',
        tag: 'release/v0.3.3',
        published_at: '2026-02-27T14:30:00Z',
        assets: {
          'windows-x64-setup': { url: 'release/v0.3.3/ExoMind-0.3.3-windows-x64-setup.exe', size: 50000000, sha256: 'abc' },
        },
      },
      versions: [
        { version: '0.3.3', tag: 'release/v0.3.3', published_at: '2026-02-27T14:30:00Z', version_dir: 'release/v0.3.3' },
      ],
    });
    const spy = mockFetchJson(apiResponse);

    const result = await getVersions('release');

    expect(Array.isArray(result)).toBe(true);
    expect(result[0].version).toBe('0.3.3');
    expect(result[0].publishedAt).toBe('2026-02-27T14:30:00Z');
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('channel=release');
  });

  it('fetches preview versions with version list', async () => {
    const apiResponse = makeVersionsResponse({
      versions: [
        { version: '0.3.4-build.20260227T1430', tag: 'build/v0.3.4-build.20260227T1430', published_at: '2026-02-27T14:30:00Z', version_dir: '' },
        { version: '0.3.4-build.20260226T1000', tag: 'build/v0.3.4-build.20260226T1000', published_at: '2026-02-26T10:00:00Z', version_dir: '' },
      ],
    });
    mockFetchJson(apiResponse);

    const result = await getVersions('preview');

    expect(result).toHaveLength(2);
    expect(result[0].version).toBe('0.3.4-build.20260227T1430');
    expect(result[1].publishedAt).toBe('2026-02-26T10:00:00Z');
  });

  it('falls back to latest when versions array is empty', async () => {
    const apiResponse = makeVersionsResponse({
      versions: [],
      latest: {
        version: '0.3.3',
        tag: 'release/v0.3.3',
        published_at: '2026-02-27T14:30:00Z',
        assets: {},
      },
    });
    mockFetchJson(apiResponse);

    const result = await getVersions('release');

    expect(result).toHaveLength(1);
    expect(result[0].version).toBe('0.3.3');
  });

  it('returns empty array when no latest and no versions', async () => {
    const apiResponse = makeVersionsResponse({ versions: [], latest: null });
    mockFetchJson(apiResponse);

    const result = await getVersions('release');

    expect(result).toHaveLength(0);
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
      downloadUpdate('/api/download/release/v2.0.0/windows-x64', 'wrong-hash'),
    ).rejects.toThrow(/SHA-256/);

    expect(openUrl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getPlatform()
// ---------------------------------------------------------------------------

describe('getPlatform', () => {
  const originalUA = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
  });

  it('detects Windows', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      configurable: true,
    });
    expect(getPlatform()).toBe('windows-x64');
  });

  it('detects Android', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14)',
      configurable: true,
    });
    expect(getPlatform()).toBe('android-arm64');
  });
});

// ---------------------------------------------------------------------------
// createAutoCheckController()
// ---------------------------------------------------------------------------

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
