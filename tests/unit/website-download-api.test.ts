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

  it('serves windows msi installer when latest metadata exposes windows-x64-installer / latest 元数据包含 windows-x64-installer 时可下载 MSI', async () => {
    const { GET } = await loadDownloadRoute();
    const objects = new Map<string, ReturnType<typeof createJsonObject> | ReturnType<typeof createBinaryObject>>([
      [
        'preview/latest.json',
        createJsonObject({
          version: 'v0.3.5',
          tag: 'dev',
          published_at: '2026-03-06T12:00:00Z',
          assets: {
            'windows-x64-installer': {
              url: 'preview/v0.3.5-manual.123.abc1234/ExoMind-v0.3.5-windows-x64-installer.msi',
              size: 42,
              sha256: 'msi-sha256',
            },
          },
        }),
      ],
      [
        'preview/v0.3.5-manual.123.abc1234/ExoMind-v0.3.5-windows-x64-installer.msi',
        createBinaryObject('windows-msi-binary'),
      ],
    ]);

    const response = await GET({
      params: {
        channel: 'preview',
        version: 'v0.3.5',
        platform: 'windows-x64-installer',
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
      request: new Request('https://exo-mind.ai/api/download/preview/v0.3.5/windows-x64-installer'),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Disposition')).toContain('ExoMind-v0.3.5-windows-x64-installer.msi');
  });
});
