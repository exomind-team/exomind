import type { APIRoute } from 'astro';

export const prerender = false;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
};

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Map platform slug to filename pattern */
function getFilename(version: string, platform: string): string | null {
  // Strip leading "v" from version for filename (v0.3.3 -> 0.3.3)
  const ver = version.startsWith('v') ? version.slice(1) : version;

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

export const GET: APIRoute = async ({ params, locals }) => {
  const { channel, version, platform } = params;

  if (!channel || !version || !platform) {
    return errorResponse('Missing route parameters', 400);
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

  const filename = getFilename(version, platform);
  if (!filename) {
    return errorResponse(`Unsupported platform: ${platform}`, 400);
  }

  try {
    const r2 = locals.runtime.env.R2;
    const key = `${channel}/${version}/${filename}`;
    const object = await r2.get(key);

    if (!object) {
      return errorResponse(
        `File not found: ${channel}/${version} for ${platform}`,
        404,
      );
    }

    const headers = new Headers(CORS_HEADERS);
    headers.set('Content-Type', getContentType(platform));
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);

    if (object.size) {
      headers.set('Content-Length', String(object.size));
    }

    // object.body is a ReadableStream — stream directly to the client
    return new Response(object.body, { status: 200, headers });
  } catch (err) {
    console.error('Download failed:', err);
    return errorResponse('Internal server error', 500);
  }
};
