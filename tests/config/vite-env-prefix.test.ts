import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';

describe('vite env prefix config', () => {
  async function resolveConfig() {
    return typeof viteConfig === 'function'
      ? viteConfig({ command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false })
      : viteConfig;
  }

  it('should expose EXOMIND_ env vars to import.meta.env', async () => {
    const resolved = await resolveConfig();

    const envPrefix = Array.isArray(resolved.envPrefix)
      ? resolved.envPrefix
      : [resolved.envPrefix];

    expect(envPrefix).toContain('VITE_');
    expect(envPrefix).toContain('EXOMIND_');
  });

  it('should not advertise 0.0.0.0 as the HMR client host（HMR 客户端不应连接到 0.0.0.0）', async () => {
    const resolved = await resolveConfig();
    const hmr = typeof resolved.server === 'object' ? resolved.server?.hmr : undefined;
    const host = typeof hmr === 'object' && hmr ? hmr.host : undefined;

    expect(host).not.toBe('0.0.0.0');
  });

  it('should honor TAURI_DEV_HOST for HMR on mobile dev（移动端开发态应复用 TAURI_DEV_HOST）', async () => {
    const originalHost = process.env.TAURI_DEV_HOST;
    process.env.TAURI_DEV_HOST = '192.168.1.88';

    try {
      const resolved = await resolveConfig();
      const hmr = typeof resolved.server === 'object' ? resolved.server?.hmr : undefined;
      const host = typeof hmr === 'object' && hmr ? hmr.host : undefined;

      expect(host).toBe('192.168.1.88');
    } finally {
      if (originalHost === undefined) {
        delete process.env.TAURI_DEV_HOST;
      } else {
        process.env.TAURI_DEV_HOST = originalHost;
      }
    }
  });
});

