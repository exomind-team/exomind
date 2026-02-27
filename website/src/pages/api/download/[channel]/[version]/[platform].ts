import type { APIRoute } from 'astro';
import { isValidVersionParam } from '../../../../../lib/update-api-utils';

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
  // Strip leading "v" from version for filename (v0.3.3 -> 0.3.3)
  const ver = version.startsWith('v') ? version.slice(1) : version;

  // TODO: Consider reading filename from latest.json instead of reconstructing here,
  // to avoid coupling with CI build artifact naming convention.
  const map: Record<string, string> = {
    'windows-x64': `ExoMind-${ver}-windows-x64-setup.exe`,
    'android-arm64': `ExoMind-${ver}-android-arm64.apk`,
  };

  return map[platform] ?? null;
}

/** Map platform to Content-Type */
function getContentType(platform: string): string {
  const map: Record<string, string> = {
    'windows-x64': 'application/vnd.microsoft.portable-executable',
    'android-arm64': 'application/vnd.android.package-archive',
  };
  return map[platform] ?? 'application/octet-stream';
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

  const validPlatforms = ['windows-x64', 'android-arm64'];
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
    const object = await r2.get(key);

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
    headers.set('Content-Type', getContentType(platform));
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);

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
