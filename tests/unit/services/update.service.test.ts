import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import {
  checkForUpdate,
  compareVersions,
  createAutoCheckController,
  downloadUpdate,
  getCurrentVersion,
  getPlatform,
  getVersions,
  type ReleaseMetadata,
  type ReleaseVersionsIndex,
} from '@/lib/services/update.service';

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.2.3'),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

function mockFetchJson(data: unknown, ok = true, status = 200) {
  const response = {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  } as unknown as Response;

  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

function mockFetchBinary(data: Uint8Array, ok = true, status = 200) {
  const response = {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    arrayBuffer: () => Promise.resolve(data.buffer.slice(0)),
  } as unknown as Response;

  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

function makeLatestMetadata(overrides?: Partial<ReleaseMetadata>): ReleaseMetadata {
  return {
    version: '0.4.0',
    tag: 'v0.4.0',
    published_at: '2026-04-08T08:00:00Z',
    release_url: 'https://github.com/exomind-team/exomind/releases/tag/v0.4.0',
    assets: {
      'windows-x64-setup': {
        name: 'ExoMind-0.4.0-windows-x64-setup.exe',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
        size: 50_000_000,
        sha256: 'a'.repeat(64),
      },
      'windows-x64-installer': {
        name: 'ExoMind-0.4.0-windows-x64-installer.msi',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-installer.msi',
        size: 52_000_000,
        sha256: 'b'.repeat(64),
      },
      'android-arm64': {
        name: 'ExoMind-0.4.0-android-arm64.apk',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-android-arm64.apk',
        size: 30_000_000,
        sha256: 'c'.repeat(64),
      },
    },
    ...overrides,
  };
}

function makeVersionsIndex(overrides?: Partial<ReleaseVersionsIndex>): ReleaseVersionsIndex {
  const latest = makeLatestMetadata();
  return {
    channel: 'preview',
    generated_at: '2026-04-08T09:00:00Z',
    latest,
    versions: [
      latest,
      makeLatestMetadata({
        version: '0.3.9',
        tag: 'v0.3.9',
        published_at: '2026-04-05T08:00:00Z',
        release_url: 'https://github.com/exomind-team/exomind/releases/tag/v0.3.9',
      }),
    ],
    ...overrides,
  };
}

describe('getCurrentVersion', () => {
  it('returns version from Tauri API / 通过 Tauri API 返回版本号', async () => {
    const version = await getCurrentVersion();
    expect(version).toBe('1.2.3');
  });
});

describe('compareVersions', () => {
  it('compares semantic versions numerically / 以语义化版本数值比较', () => {
    expect(compareVersions('0.4.1', '0.4.0')).toBe(1);
    expect(compareVersions('0.4.0', '0.4.1')).toBe(-1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  });

  it('strips v prefix / 支持去掉 v 前缀再比较', () => {
    expect(compareVersions('v0.4.0', '0.4.0')).toBe(0);
  });

  it('returns 0 for equal versions / 相同版本返回 0', () => {
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0);
  });
});

describe('checkForUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches latest metadata from GitHub Pages and returns direct release asset URL / 从 GitHub Pages latest.json 取更新并直接返回 Release asset URL', async () => {
    const latest = makeLatestMetadata();
    const spy = mockFetchJson(latest);

    const result = await checkForUpdate({
      channel: 'preview',
      platform: 'windows-x64',
      currentVersion: '0.3.9',
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe('0.4.0');
    expect(result.downloadUrl).toBe(
      'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
    );
    expect(result.size).toBe(50_000_000);
    expect(result.sha256).toBe('a'.repeat(64));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toBe('https://exomind-team.github.io/exomind/releases/preview/latest.json');
  });

  it('returns no update when latest metadata is null / latest.json 为 null 时返回无更新', async () => {
    mockFetchJson(null);

    const result = await checkForUpdate({
      channel: 'release',
      platform: 'windows-x64',
      currentVersion: '0.4.0',
    });

    expect(result.hasUpdate).toBe(false);
    expect(result.latestVersion).toBe('0.4.0');
    expect(result.downloadUrl).toBeUndefined();
  });

  it('returns update even when platform asset is missing / 即使缺少当前平台产物也应先返回版本有更新', async () => {
    mockFetchJson(makeLatestMetadata({ assets: {} }));

    const result = await checkForUpdate({
      channel: 'release',
      platform: 'windows-x64',
      currentVersion: '0.3.9',
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.downloadUrl).toBeUndefined();
    expect(result.size).toBeUndefined();
  });

  it('throws on metadata fetch failure / metadata 拉取失败时抛错', async () => {
    mockFetchJson({ error: 'nope' }, false, 404);

    await expect(
      checkForUpdate({
        channel: 'release',
        platform: 'windows-x64',
        currentVersion: '0.4.0',
      }),
    ).rejects.toThrow(/Update check failed/i);
  });
});

describe('getVersions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches static versions index from GitHub Pages / 从 GitHub Pages 获取静态 versions.json', async () => {
    const index = makeVersionsIndex();
    const spy = mockFetchJson(index);

    const versions = await getVersions('release');

    expect(versions).toEqual([
      { version: '0.4.0', publishedAt: '2026-04-08T08:00:00Z' },
      { version: '0.3.9', publishedAt: '2026-04-05T08:00:00Z' },
    ]);
    expect(String(spy.mock.calls[0][0])).toBe('https://exomind-team.github.io/exomind/releases/release/versions.json');
  });

  it('returns empty array for empty versions index / 空版本索引返回空数组', async () => {
    mockFetchJson(
      makeVersionsIndex({
        latest: null,
        versions: [],
      }),
    );

    const versions = await getVersions('preview');
    expect(versions).toEqual([]);
  });
});

describe('downloadUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens absolute GitHub release asset URL / 直接打开 GitHub Release asset 绝对链接', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');

    await downloadUpdate(
      'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
    );

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect((openUrl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
    );
  });

  it('resolves relative fallback URL against website origin / 相对链接回退到官网基准地址', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');

    await downloadUpdate('/downloads/ExoMind-0.4.0-windows-x64-setup.exe');

    expect((openUrl as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'https://exomind-team.github.io/exomind/downloads/ExoMind-0.4.0-windows-x64-setup.exe',
    );
  });

  it('verifies SHA-256 before opening URL / 打开前先校验 SHA-256', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const payload = new TextEncoder().encode('exo-update-binary');
    const sha256 = bytesToHex(nobleSha256(payload));
    const fetchSpy = mockFetchBinary(payload);

    await downloadUpdate(
      'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
      sha256,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it('throws when SHA-256 mismatches / SHA-256 不匹配时拒绝打开', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    const payload = new TextEncoder().encode('tampered-binary');
    mockFetchBinary(payload);

    await expect(
      downloadUpdate(
        'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
        'd'.repeat(64),
      ),
    ).rejects.toThrow(/SHA-256 mismatch/i);

    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe('getPlatform', () => {
  const originalUA = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
  });

  it('detects Windows / 识别 Windows', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      configurable: true,
    });

    expect(getPlatform()).toBe('windows-x64');
  });

  it('detects Android / 识别 Android', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14)',
      configurable: true,
    });

    expect(getPlatform()).toBe('android-arm64');
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

  it('isolates timers across controllers / 不同 controller 的定时器互不干扰', () => {
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

  it('does not start timer for manual interval / manual 模式不启动定时器', () => {
    const controller = createAutoCheckController();
    const callback = vi.fn();

    controller.start('manual', callback);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(callback).not.toHaveBeenCalled();
  });
});
