import { describe, expect, it } from 'vitest';
import {
  buildPagesReleaseMetadata,
  type GithubReleaseSummary,
  type ReleaseManifest,
} from '../../../scripts/dev/release-pages-metadata-lib.ts';

function makeManifest(version: string, overrides?: Partial<ReleaseManifest>): ReleaseManifest {
  return {
    version,
    tag: `v${version}`,
    commit: 'abcdef1',
    generated_at: '2026-04-08T08:00:00Z',
    assets: {
      'windows-x64-setup': {
        name: `ExoMind-${version}-windows-x64-setup.exe`,
        size: 50_000_000,
        sha256: 'a'.repeat(64),
      },
      'android-arm64': {
        name: `ExoMind-${version}-android-arm64.apk`,
        size: 30_000_000,
        sha256: 'b'.repeat(64),
      },
    },
    ...overrides,
  };
}

function makeRelease(version: string, prerelease: boolean): GithubReleaseSummary {
  const manifest = makeManifest(version);
  return {
    tagName: `v${version}`,
    prerelease,
    draft: false,
    publishedAt: `2026-04-0${prerelease ? '8' : '7'}T08:00:00Z`,
    htmlUrl: `https://github.com/exomind-team/exomind/releases/tag/v${version}`,
    assets: [
      {
        name: manifest.assets['windows-x64-setup'].name,
        size: manifest.assets['windows-x64-setup'].size,
        browserDownloadUrl: `https://github.com/exomind-team/exomind/releases/download/v${version}/${manifest.assets['windows-x64-setup'].name}`,
      },
      {
        name: manifest.assets['android-arm64'].name,
        size: manifest.assets['android-arm64'].size,
        browserDownloadUrl: `https://github.com/exomind-team/exomind/releases/download/v${version}/${manifest.assets['android-arm64'].name}`,
      },
      {
        name: 'exomind-release-manifest.json',
        size: 1024,
        browserDownloadUrl: `https://github.com/exomind-team/exomind/releases/download/v${version}/exomind-release-manifest.json`,
      },
    ],
    manifest,
  };
}

describe('release-pages-metadata-lib', () => {
  it('splits preview and release using prerelease state / 按 prerelease 状态拆分 preview 与 release', () => {
    const result = buildPagesReleaseMetadata([
      makeRelease('0.4.0', false),
      makeRelease('0.4.1', true),
    ]);

    expect(result.release.channel).toBe('release');
    expect(result.release.latest?.tag).toBe('v0.4.0');
    expect(result.preview.channel).toBe('preview');
    expect(result.preview.latest?.tag).toBe('v0.4.1');
  });

  it('sorts versions by semantic version, not published_at / 版本排序按语义化版本而不是发布时间', () => {
    const olderDateNewerVersion = makeRelease('0.4.10', true);
    olderDateNewerVersion.publishedAt = '2026-04-01T08:00:00Z';
    const newerDateOlderVersion = makeRelease('0.4.9', true);
    newerDateOlderVersion.publishedAt = '2026-04-09T08:00:00Z';

    const result = buildPagesReleaseMetadata([olderDateNewerVersion, newerDateOlderVersion]);

    expect(result.preview.latest?.tag).toBe('v0.4.10');
    expect(result.preview.versions.map((entry) => entry.tag)).toEqual(['v0.4.10', 'v0.4.9']);
  });

  it('joins manifest hashes with actual release asset URLs / 用 manifest 的哈希和 Release assets 的真实下载 URL 合并 metadata', () => {
    const result = buildPagesReleaseMetadata([makeRelease('0.4.0', false)]);
    const asset = result.release.latest?.assets['android-arm64'];

    expect(asset).toEqual({
      name: 'ExoMind-0.4.0-android-arm64.apk',
      url: 'https://github.com/exomind-team/exomind/releases/download/v0.4.0/ExoMind-0.4.0-android-arm64.apk',
      size: 30_000_000,
      sha256: 'b'.repeat(64),
    });
    expect(result.release.latest?.release_url).toBe(
      'https://github.com/exomind-team/exomind/releases/tag/v0.4.0',
    );
  });

  it('ignores drafts and malformed tags / 忽略 draft release 与非法 tag', () => {
    const draftRelease = makeRelease('0.4.2', true);
    draftRelease.draft = true;
    const malformedTagRelease = makeRelease('0.4.3', false);
    malformedTagRelease.tagName = 'release/v0.4.3';

    const result = buildPagesReleaseMetadata([
      draftRelease,
      malformedTagRelease,
      makeRelease('0.4.1', true),
    ]);

    expect(result.release.latest).toBeNull();
    expect(result.preview.versions.map((entry) => entry.tag)).toEqual(['v0.4.1']);
  });
});
