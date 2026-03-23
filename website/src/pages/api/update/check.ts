import type { APIRoute } from 'astro';
import { resolveLatestAssetForPlatform } from '../../../lib/update-api-utils';

export const prerender = false;

// Intentionally public read-only API — wildcard CORS is acceptable here.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function errorResponse(message: string, status: number) {
  return jsonResponse({ error: message }, status);
}

/**
 * Simple semver comparison: returns 1 if a > b, -1 if a < b, 0 if equal.
 * Handles versions like "0.3.3", "0.3.4-build.20260227T1430".
 */
function compareVersions(a: string, b: string): number {
  // Split off pre-release suffix
  const [coreA, preA] = a.split('-', 2);
  const [coreB, preB] = b.split('-', 2);

  const partsA = coreA.split('.').map(Number);
  const partsB = coreB.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const na = partsA[i] ?? 0;
    const nb = partsB[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }

  // Equal core: no pre-release > pre-release (e.g. 0.3.4 > 0.3.4-build.xxx)
  if (!preA && preB) return 1;
  if (preA && !preB) return -1;
  // Pre-release format is fixed as `build.YYYYMMDDTHHMMSS` (timestamp),
  // so lexicographic string comparison produces correct ordering.
  // If format changes, switch to SemVer segment-by-segment comparison.
  if (preA && preB) return preA < preB ? -1 : preA > preB ? 1 : 0;

  return 0;
}

interface LatestAsset {
  url: string;
  size: number;
  sha256: string;
}

interface LatestJson {
  version: string;
  tag: string;
  published_at: string;
  assets: Record<string, LatestAsset>;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const channel = url.searchParams.get('channel');
  const platform = url.searchParams.get('platform');
  const currentVersion = url.searchParams.get('current_version');

  if (!channel || !platform || !currentVersion) {
    return errorResponse(
      'Missing required query parameters: channel, platform, current_version',
      400,
    );
  }

  if (channel !== 'release' && channel !== 'preview') {
    return errorResponse('Invalid channel. Must be "release" or "preview"', 400);
  }

  const validPlatforms = ['windows-x64', 'android-arm64'];
  if (!validPlatforms.includes(platform)) {
    return errorResponse(
      `Invalid platform. Must be one of: ${validPlatforms.join(', ')}`,
      400,
    );
  }

  try {
    const r2 = locals.runtime.env.RELEASES;
    const key = `${channel}/latest.json`;
    const object = await r2.get(key);

    if (!object) {
      return errorResponse(`Channel "${channel}" has no published versions`, 404);
    }

    const latest: LatestJson = await object.json();
    const latestVersion = latest.version;

    if (compareVersions(latestVersion, currentVersion) <= 0) {
      return jsonResponse({
        has_update: false,
        current_version: currentVersion,
        latest_version: latestVersion,
      });
    }

    const resolvedAsset = resolveLatestAssetForPlatform(latest.assets, platform);
    if (!resolvedAsset) {
      return errorResponse(
        `No asset available for platform "${platform}" in version ${latestVersion}`,
        404,
      );
    }
    const { asset } = resolvedAsset;

    // Extract version tag segment for download URL (e.g. "v0.3.3")
    const versionTag = latest.tag.split('/').pop() ?? `v${latestVersion}`;

    return jsonResponse({
      has_update: true,
      current_version: currentVersion,
      latest_version: latestVersion,
      download_url: `/api/download/${channel}/${versionTag}/${platform}`,
      size: asset.size,
      sha256: asset.sha256,
      published_at: latest.published_at,
    });
  } catch (err) {
    console.error('Update check failed:', err);
    return errorResponse('Internal server error', 500);
  }
};
