import { describe, expect, it } from 'vitest';

async function loadDownloadRoute() {
  return import('../../website/src/pages/api/download/[channel]/[version]/[platform].ts');
}

function createJsonObject(payload: unknown) {
  const text = JSON.stringify(payload);
  return {
    size: Buffer.byteLength(text),
    body: text,
    json: async () => payload,
  };
}

function createBinaryObject(content: string) {
  return {
    size: Buffer.byteLength(content),
    body: content,
  };
}

describe('website download api / 官网下载 API', () => {
  it('serves runtime tarball when latest metadata maps Linux desktop to runtime asset / latest 元数据指向 runtime 时仍可下载 Linux 桌面包', async () => {
    const { GET } = await loadDownloadRoute();
    const objects = new Map<string, ReturnType<typeof createJsonObject> | ReturnType<typeof createBinaryObject>>([
      [
        'release/latest.json',
        createJsonObject({
          version: 'v0.3.5',
          tag: 'release/v0.3.5',
          published_at: '2026-03-06T01:00:00Z',
          assets: {
            'runtime-linux-x64': {
              url: 'release/v0.3.5/ExoMind-RT-v0.3.5-linux-x64.tar.gz',
              size: 613568,
              sha256: '511692bb1b803535ce0290c892629a801c84109655efafa95de37cdd28d2dbbc',
            },
          },
        }),
      ],
      [
        'release/v0.3.5/ExoMind-RT-v0.3.5-linux-x64.tar.gz',
        createBinaryObject('runtime-linux-binary'),
      ],
    ]);

    const response = await GET({
      params: {
        channel: 'release',
        version: 'v0.3.5',
        platform: 'linux-x64-appimage',
      },
      locals: {
        runtime: {
          env: {
            RELEASES: {
              get: async (key: string) => objects.get(key) ?? null,
            },
          },
        },
      },
      request: new Request('https://exo-mind.ai/api/download/release/v0.3.5/linux-x64-appimage'),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/gzip');
    expect(response.headers.get('Content-Disposition')).toContain('ExoMind-RT-v0.3.5-linux-x64.tar.gz');
  });
});
