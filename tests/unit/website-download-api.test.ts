import { describe, expect, it } from 'vitest';
import { resolvePlatformDownload, type StaticReleaseMetadata } from '../../website/src/lib/downloads-data';

function makeLatest(overrides?: Partial<StaticReleaseMetadata>): StaticReleaseMetadata {
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
      'android-x86': {
        name: 'ExoMind-0.4.0-android-x86.apk',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-android-x86.apk',
        size: 28_000_000,
        sha256: 'd'.repeat(64),
      },
    },
    ...overrides,
  };
}

describe('website download data / 官网下载静态数据解析', () => {
  it('resolves direct GitHub Release asset URL and extra links / 主下载与附加下载都直接指向 GitHub Release assets', () => {
    const resolved = resolvePlatformDownload(makeLatest(), 'windows-x64-setup');

    expect(resolved).not.toBeNull();
    expect(resolved?.primary.url).toBe(
      'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-setup.exe',
    );
    expect(resolved?.extras).toEqual([
      {
        key: 'windows-x64-installer',
        label: 'MSI 安装包',
        url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-windows-x64-installer.msi',
        size: 52_000_000,
      },
    ]);
  });

  it('returns null when the selected platform asset is absent / 当前平台产物缺失时返回 null', () => {
    const resolved = resolvePlatformDownload(makeLatest({ assets: {} }), 'linux-x64-appimage');
    expect(resolved).toBeNull();
  });
});
