import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('icon svg vectorize issue 795（图标 SVG 矢量化 issue 795）', () => {
  const repoRoot = process.cwd();
  const packageJsonPath = join(repoRoot, 'package.json');
  const svgIconPath = join(repoRoot, 'src-tauri', 'icons', 'icon.svg');

  it('icon scripts should use svg source for tauri and web generation（图标脚本应以 SVG 作为 Tauri 与 Web 生成源）', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['icon:tauri']).toContain('src-tauri/icons/icon.svg');
    expect(packageJson.scripts?.['icon:web']).toContain('src-tauri/icons/icon.svg');
    expect(packageJson.scripts?.['icon:all']).toContain('icon:tauri');
    expect(packageJson.scripts?.['icon:all']).toContain('icon:web');
  });

  it('icon svg source should exist with transparent vector structure（SVG 源文件应存在且为透明矢量结构）', () => {
    expect(existsSync(svgIconPath)).toBe(true);

    const svg = readFileSync(svgIconPath, 'utf8');
    const size = statSync(svgIconPath).size;

    expect(size).toBeLessThan(50 * 1024);
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('#F472B6');
    expect(svg).toContain('#FB923C');
    expect(svg.match(/<path\b/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).not.toMatch(/<rect\b[^>]*fill=/i);
    expect(svg).not.toContain('<image');
  });
});
