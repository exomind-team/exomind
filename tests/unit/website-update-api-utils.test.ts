import { describe, expect, it } from 'vitest';
import {
  buildHistoryEntries,
  fallbackReleaseUrl,
  type StaticReleaseMetadata,
  type StaticVersionsIndex,
} from '../../website/src/lib/downloads-data';

function makeVersion(version: string, releaseUrl?: string): StaticReleaseMetadata {
  return {
    version,
    tag: `v${version}`,
    published_at: '2026-04-08T08:00:00Z',
    release_url: releaseUrl ?? '',
    assets: {},
  };
}

describe('website history entries / 官网历史版本列表', () => {
  it('prefers release_url from static metadata / 优先使用 metadata 中的 release_url', () => {
    const index: StaticVersionsIndex = {
      channel: 'preview',
      generated_at: '2026-04-08T09:00:00Z',
      latest: makeVersion('0.4.1', 'https://github.com/exomind-team/exomind/releases/tag/v0.4.1'),
      versions: [
        makeVersion('0.4.1', 'https://github.com/exomind-team/exomind/releases/tag/v0.4.1'),
        makeVersion('0.4.0', 'https://github.com/exomind-team/exomind/releases/tag/v0.4.0'),
      ],
    };

    expect(buildHistoryEntries(index)).toEqual([
      {
        version: '0.4.1',
        publishedAt: '2026-04-08T08:00:00Z',
        releaseUrl: 'https://github.com/exomind-team/exomind/releases/tag/v0.4.1',
      },
      {
        version: '0.4.0',
        publishedAt: '2026-04-08T08:00:00Z',
        releaseUrl: 'https://github.com/exomind-team/exomind/releases/tag/v0.4.0',
      },
    ]);
  });

  it('falls back to tag-based GitHub URL / 缺少 release_url 时回退到 tag URL', () => {
    const index: StaticVersionsIndex = {
      channel: 'release',
      generated_at: '2026-04-08T09:00:00Z',
      latest: makeVersion('0.4.0'),
      versions: [makeVersion('0.4.0')],
    };

    expect(buildHistoryEntries(index)[0]?.releaseUrl).toBe(
      'https://github.com/exomind-team/exomind/releases/tag/v0.4.0',
    );
    expect(fallbackReleaseUrl('v0.4.0')).toBe(
      'https://github.com/exomind-team/exomind/releases/tag/v0.4.0',
    );
  });
});
