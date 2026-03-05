import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

const canResolveAstroTsconfig = (() => {
  try {
    require.resolve('astro/tsconfigs/strict/tsconfig.json', {
      paths: [process.cwd(), `${process.cwd()}/website`],
    });
    return true;
  } catch {
    return false;
  }
})();

const describeWebsiteUtils = canResolveAstroTsconfig ? describe : describe.skip;

async function loadUpdateApiUtils() {
  return import('../../website/src/lib/update-api-utils');
}

describeWebsiteUtils('isValidVersionParam', () => {
  it('accepts release and preview version tags', async () => {
    const { isValidVersionParam } = await loadUpdateApiUtils();
    expect(isValidVersionParam('v0.3.3')).toBe(true);
    expect(isValidVersionParam('v0.3.4-build.20260227T1430')).toBe(true);
  });

  it('rejects malformed or unsafe version tags', async () => {
    const { isValidVersionParam } = await loadUpdateApiUtils();
    expect(isValidVersionParam('')).toBe(false);
    expect(isValidVersionParam('../v0.3.3')).toBe(false);
    expect(isValidVersionParam('v0.3')).toBe(false);
    expect(isValidVersionParam('v0.3.3/windows-x64')).toBe(false);
  });
});

describeWebsiteUtils('normalizePreviewVersionsPayload', () => {
  it('supports legacy array payload with default retention', async () => {
    const { normalizePreviewVersionsPayload } = await loadUpdateApiUtils();
    const legacy = [
      {
        version: '0.3.4-build.20260227T1430',
        tag: 'build/v0.3.4-build.20260227T1430',
        published_at: '2026-02-27T14:30:00Z',
      },
    ];
    const result = normalizePreviewVersionsPayload(legacy);

    expect(result.versions).toEqual(legacy);
    expect(result.retention).toBe(15);
  });

  it('prefers object payload retention and filters invalid entries', async () => {
    const { normalizePreviewVersionsPayload } = await loadUpdateApiUtils();
    const payload = {
      versions: [
        {
          version: '0.3.4-build.20260227T1430',
          tag: 'build/v0.3.4-build.20260227T1430',
          published_at: '2026-02-27T14:30:00Z',
        },
        { foo: 'bar' },
      ],
      retention: 20,
    };
    const result = normalizePreviewVersionsPayload(payload);

    expect(result.retention).toBe(20);
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].version).toBe('0.3.4-build.20260227T1430');
  });

  it('keeps entries even when legacy payload omits tag', async () => {
    const { normalizePreviewVersionsPayload } = await loadUpdateApiUtils();
    const payload = {
      versions: [
        {
          version: '0.3.4-build.20260227T1430',
          published_at: '2026-02-27T14:30:00Z',
        },
      ],
    };
    const result = normalizePreviewVersionsPayload(payload);

    expect(result.versions).toHaveLength(1);
    expect(result.versions[0].tag).toBe('');
  });
});

describeWebsiteUtils('resolveLatestAssetForPlatform', () => {
  it('maps windows-x64 to windows-x64-setup when setup key exists', async () => {
    const { resolveLatestAssetForPlatform } = await loadUpdateApiUtils();
    const assets = {
      'windows-x64-setup': {
        url: 'preview/v0.3.3-build.43/windows-setup.exe',
        size: 123,
        sha256: 'abc',
      },
    };

    const resolved = resolveLatestAssetForPlatform(assets, 'windows-x64');

    expect(resolved).not.toBeNull();
    expect(resolved?.assetKey).toBe('windows-x64-setup');
    expect(resolved?.asset.url).toContain('windows-setup.exe');
  });

  it('returns direct match for android-arm64', async () => {
    const { resolveLatestAssetForPlatform } = await loadUpdateApiUtils();
    const assets = {
      'android-arm64': {
        url: 'preview/v0.3.3-build.43/android-arm64.apk',
        size: 456,
        sha256: 'def',
      },
    };

    const resolved = resolveLatestAssetForPlatform(assets, 'android-arm64');

    expect(resolved?.assetKey).toBe('android-arm64');
    expect(resolved?.asset.size).toBe(456);
  });
});
