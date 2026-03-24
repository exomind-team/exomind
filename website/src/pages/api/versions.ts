import type { APIRoute } from 'astro';
import { normalizePreviewVersionsPayload } from '../../lib/update-api-utils';

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

interface LatestJson {
  version: string;
  tag: string;
  published_at: string;
  assets: Record<string, { url: string; size: number; sha256: string }>;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const channel = url.searchParams.get('channel');

  if (!channel) {
    return errorResponse('Missing required query parameter: channel', 400);
  }

  if (channel !== 'release' && channel !== 'preview') {
    return errorResponse('Invalid channel. Must be "release" or "preview"', 400);
  }

  try {
    const r2 = locals.runtime.env.RELEASES;

    if (channel === 'release') {
      const object = await r2.get('release/latest.json');
      if (!object) {
        return errorResponse('No release versions found', 404);
      }

      const latest: LatestJson = await object.json();
      return jsonResponse({
        channel: 'release',
        latest: {
          version: latest.version,
          tag: latest.tag,
          published_at: latest.published_at,
          assets: latest.assets,
        },
      });
    }

    // preview channel
    const [versionsObj, latestObj] = await Promise.all([
      r2.get('preview/versions.json'),
      r2.get('preview/latest.json'),
    ]);

    if (!versionsObj && !latestObj) {
      return errorResponse('No preview versions found', 404);
    }

    const data = versionsObj
      ? normalizePreviewVersionsPayload(await versionsObj.json())
      : { versions: [], retention: 15 };

    const latest: LatestJson | null = latestObj ? await latestObj.json() : null;

    return jsonResponse({
      channel: 'preview',
      latest: latest
        ? {
            version: latest.version,
            tag: latest.tag,
            published_at: latest.published_at,
            assets: latest.assets,
          }
        : null,
      versions: data.versions,
      retention: data.retention,
    });
  } catch (err) {
    console.error('Versions query failed:', err);
    return errorResponse('Internal server error', 500);
  }
};
