import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';

describe('vite env prefix config', () => {
  it('should expose EXOMIND_ env vars to import.meta.env', async () => {
    const resolved =
      typeof viteConfig === 'function'
        ? await viteConfig({ command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false })
        : viteConfig;

    const envPrefix = Array.isArray(resolved.envPrefix)
      ? resolved.envPrefix
      : [resolved.envPrefix];

    expect(envPrefix).toContain('VITE_');
    expect(envPrefix).toContain('EXOMIND_');
  });
});

