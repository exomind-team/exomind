import type { APIRoute } from 'astro';
import {
  isValidVersionParam,
  resolveLatestAssetForPlatform,
  type LatestAssetEntry,
} from '../../../../../lib/update-api-utils';

export const prerender = false;

// Restricted CORS: official site + trusted app origins.
// binary endpoint should not be open to arbitrary origins.
// Rate limiting is handled at the Cloudflare layer.
const DEFAULT_ORIGIN = 'https://exo-mind.ai';
const TRUSTED_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  'tauri://localhost',
  'https://tauri.localhost',
  'http://localhost',
]);

function resolveCorsOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return DEFAULT_ORIGIN;
  return TRUSTED_ORIGINS.has(requestOrigin) ? requestOrigin : DEFAULT_ORIGIN;
}

function errorResponse(message: string, status: number, corsOrigin: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Content-Type': 'application/json',
    },
  });
}

/** Map platform slug to filename pattern */
function getFilename(version: string, platform: string): string | null {
  const map: Record<string, string> = {
    'windows-x64-setup': `ExoMind-${version}-windows-x64-setup.exe`,
    'windows-x64': `ExoMind-${version}-windows-x64-setup.exe`,
    'windows-x64-installer': `ExoMind-${version}-windows-x64-installer.msi`,
    'android-arm64': `ExoMind-${version}-android-arm64.apk`,
    'android-x86': `ExoMind-${version}-android-x86.apk`,
    'macos-aarch64': `ExoMind-${version}-macos-aarch64.dmg`,
    'macos-x64': `ExoMind-${version}-macos-x64.dmg`,
    'linux-x64-appimage': `ExoMind-${version}-linux-x64.AppImage`,
    'linux-x64-deb': `ExoMind-${version}-linux-x64.deb`,
  };

  return map[platform] ?? null;
}

/** Map platform to Content-Type */
function getContentType(platform: string): string {
  const map: Record<string, string> = {
    'windows-x64': 'application/vnd.microsoft.portable-executable',
    'windows-x64-setup': 'application/vnd.microsoft.portable-executable',
    'windows-x64-installer': 'application/octet-stream',
    'android-arm64': 'application/vnd.android.package-archive',
    'android-x86': 'application/vnd.android.package-archive',
    'macos-aarch64': 'application/x-apple-diskimage',
    'macos-x64': 'application/x-apple-diskimage',
    'linux-x64-appimage': 'application/octet-stream',
    'linux-x64-deb': 'application/vnd.debian.binary-package',
  };
  return map[platform] ?? 'application/octet-stream';
}

interface LatestJson {
  version: string;
  tag: string;
  published_at: string;
  assets: Record<string, LatestAssetEntry>;
}

interface DownloadR2Object {
  body?: unknown;
  size?: number;
  json?: () => Promise<unknown>;
}

function getContentTypeFromFilename(filename: string, fallbackPlatform: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.apk')) return 'application/vnd.android.package-archive';
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (lower.endsWith('.appimage')) return 'application/octet-stream';
  if (lower.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (lower.endsWith('.tar.gz')) return 'application/gzip';
  if (lower.endsWith('.exe') || lower.endsWith('.msi')) return 'application/octet-stream';
  return getContentType(fallbackPlatform);
}

function getBasename(key: string): string {
  const segments = key.split('/');
  return segments[segments.length - 1] || key;
}

function matchesVersion(requestedVersion: string, latestVersion: string): boolean {
  if (requestedVersion === latestVersion) return true;
  const normalizedRequested = requestedVersion.startsWith('v') ? requestedVersion.slice(1) : requestedVersion;
  const normalizedLatest = latestVersion.startsWith('v') ? latestVersion.slice(1) : latestVersion;
  return normalizedRequested === normalizedLatest;
}

async function resolveLatestAssetDownload(
  r2: { get: (key: string) => Promise<DownloadR2Object | null> },
  channel: string,
  version: string,
  platform: string,
): Promise<{
  filename: string;
  object: DownloadR2Object;
  contentType: string;
} | null> {
  const latestObject = await r2.get(`${channel}/latest.json`);
  if (!latestObject || typeof latestObject.json !== 'function') {
    return null;
  }

  const latest = await latestObject.json() as LatestJson;
  if (!matchesVersion(version, latest.version)) {
    return null;
  }

  const resolvedAsset = resolveLatestAssetForPlatform(latest.assets, platform);
  if (!resolvedAsset) {
    return null;
  }

  const assetKey = resolvedAsset.asset.url.replace(/^\/+/, '');
  const object = await r2.get(assetKey);
  if (!object) {
    return null;
  }

  const filename = getBasename(assetKey);
  return {
    filename,
    object,
    contentType: getContentTypeFromFilename(filename, platform),
  };
}

export const GET: APIRoute = async ({ params, locals, request }) => {
  const { channel, version, platform } = params;
  const corsOrigin = resolveCorsOrigin(request.headers.get('origin'));

  if (!channel || !version || !platform) {
    return errorResponse('Missing route parameters', 400, corsOrigin);
  }

  if (channel !== 'release' && channel !== 'preview') {
    return errorResponse('Invalid channel. Must be "release" or "preview"', 400, corsOrigin);
  }

  if (!isValidVersionParam(version)) {
    return errorResponse('Invalid version format', 400, corsOrigin);
  }

  const validPlatforms = [
    'windows-x64', 'windows-x64-setup', 'windows-x64-installer',
    'android-arm64', 'android-x86',
    'macos-aarch64', 'macos-x64',
    'linux-x64-appimage', 'linux-x64-deb',
  ];
  if (!validPlatforms.includes(platform)) {
    return errorResponse(
      `Invalid platform. Must be one of: ${validPlatforms.join(', ')}`,
      400,
      corsOrigin,
    );
  }

  const filename = getFilename(version, platform);
  if (!filename) {
    return errorResponse(`Unsupported platform: ${platform}`, 400, corsOrigin);
  }

  try {
    const r2 = locals.runtime.env.RELEASES;
    const key = `${channel}/${version}/${filename}`;
    let resolvedFilename = filename;
    let resolvedContentType = getContentTypeFromFilename(filename, platform);
    let object = await r2.get(key);

    if (!object) {
      const latestAssetDownload = await resolveLatestAssetDownload(r2, channel, version, platform);
      if (latestAssetDownload) {
        object = latestAssetDownload.object;
        resolvedFilename = latestAssetDownload.filename;
        resolvedContentType = latestAssetDownload.contentType;
      }
    }

    if (!object) {
      return errorResponse(
        `File not found: ${channel}/${version} for ${platform}`,
        404,
        corsOrigin,
      );
    }

    const headers = new Headers({
      'Access-Control-Allow-Origin': corsOrigin,
    });
    headers.set('Content-Type', resolvedContentType);
    headers.set('Content-Disposition', `attachment; filename="${resolvedFilename}"`);

    if (object.size) {
      headers.set('Content-Length', String(object.size));
    }

    if (!object.body) {
      return errorResponse('File body is empty', 404, corsOrigin);
    }

    // Cloudflare 的 ReadableStream 类型与 DOM BodyInit 在 TS 上有差异，显式转换避免类型冲突
    return new Response(object.body as unknown as BodyInit, { status: 200, headers });
  } catch (err) {
    console.error('Download failed:', err);
    return errorResponse('Internal server error', 500, corsOrigin);
  }
};
