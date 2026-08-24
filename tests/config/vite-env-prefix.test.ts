import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';

describe('vite env prefix config', () => {
  async function resolveConfig(mode = 'test') {
    return typeof viteConfig === 'function'
      ? viteConfig({ command: 'serve', mode, isSsrBuild: false, isPreview: false })
      : viteConfig;
  }

  it('should expose EXOMIND_ and TAURI_ENV_ vars to import.meta.env', async () => {
    const resolved = await resolveConfig();

    const envPrefix = Array.isArray(resolved.envPrefix)
      ? resolved.envPrefix
      : [resolved.envPrefix];

    expect(envPrefix).toContain('VITE_');
    expect(envPrefix).toContain('EXOMIND_');
    expect(envPrefix).toContain('TAURI_ENV_');
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

  it('should ignore unrelated workspace trees during dev watch（开发监听应忽略无关 worktree 与旁路子项目）', async () => {
    const resolved = await resolveConfig();
    const watch = typeof resolved.server === 'object' ? resolved.server?.watch : undefined;
    const ignored = typeof watch === 'object' && watch && Array.isArray(watch.ignored)
      ? watch.ignored
      : [];

    expect(ignored).toEqual(expect.arrayContaining([
      '**/.worktrees/**',
      '**/website/**',
    ]));
  });

  it('should not inject dev instance metadata outside development mode（非 development 模式不应注入实例诊断元数据）', async () => {
    const resolved = await resolveConfig('production');
    const define = typeof resolved.define === 'object' && resolved.define ? resolved.define : {};

    expect(Object.prototype.hasOwnProperty.call(define, 'globalThis.__EXOMIND_DEV_INSTANCE_META__')).toBe(false);
  });
});
