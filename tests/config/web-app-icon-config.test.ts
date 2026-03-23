import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('web app icon config（Web 应用图标配置）', () => {
  const repoRoot = process.cwd();
  const indexHtmlPath = join(repoRoot, 'index.html');
  const manifestPath = join(repoRoot, 'public', 'site.webmanifest');

  it('index.html should point favicon to generated PNG instead of vite.svg（index.html 应使用 PNG 图标而非 vite.svg）', () => {
    const html = readFileSync(indexHtmlPath, 'utf8');

    expect(html).not.toContain('/vite.svg');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('/icons/32x32.png');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('/icons/180x180.png');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('/site.webmanifest');
  });

  it('site.webmanifest should exist and define 192/512 icons（站点清单应存在并声明 192/512 图标）', () => {
    expect(existsSync(manifestPath)).toBe(true);

    const manifestRaw = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw) as {
      name?: string;
      short_name?: string;
      icons?: Array<{ src?: string; sizes?: string; type?: string }>;
    };

    expect(manifest.name).toBe('ExoMind');
    expect(manifest.short_name).toBe('ExoMind');
    expect(manifest.icons?.some((icon) => icon.src === '/icons/192x192.png' && icon.sizes === '192x192')).toBe(
      true,
    );
    expect(manifest.icons?.some((icon) => icon.src === '/icons/512x512.png' && icon.sizes === '512x512')).toBe(
      true,
    );
  });

  it('generated web icon files should exist（生成后的 Web 图标文件应存在）', () => {
    const required = [
      join(repoRoot, 'public', 'icons', '16x16.png'),
      join(repoRoot, 'public', 'icons', '32x32.png'),
      join(repoRoot, 'public', 'icons', '180x180.png'),
      join(repoRoot, 'public', 'icons', '192x192.png'),
      join(repoRoot, 'public', 'icons', '512x512.png'),
    ];

    for (const iconFile of required) {
      expect(existsSync(iconFile)).toBe(true);
    }
  });
});
