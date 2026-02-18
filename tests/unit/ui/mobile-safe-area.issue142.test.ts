import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('issue-142 mobile safe area', () => {
  const htmlPath = path.resolve('index.html');
  const cssPath = path.resolve('src/index.css');
  const routesPath = path.resolve('src/routes.tsx');

  it('includes viewport-fit=cover in index.html', () => {
    const html = fs.readFileSync(htmlPath, 'utf-8');
    expect(html).toContain('viewport-fit=cover');
  });

  it('defines safe-area utility classes in src/index.css', () => {
    const css = fs.readFileSync(cssPath, 'utf-8');
    expect(css).toContain('.safe-area-pt');
    expect(css).toContain('.safe-area-pb');
    expect(css).toContain('env(safe-area-inset-top');
    expect(css).toContain('env(safe-area-inset-bottom');
    expect(css).toContain('constant(safe-area-inset-top)');
    expect(css).toContain('constant(safe-area-inset-bottom)');
  });

  it('applies safe-area class to mobile header and sidebar', () => {
    const routesSource = fs.readFileSync(routesPath, 'utf-8');
    expect(routesSource).toContain('safe-area-pt');
  });
});
