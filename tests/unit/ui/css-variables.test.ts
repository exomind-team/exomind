import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('CSS variables', () => {
  const cssPath = path.resolve('src/index.css');

  it('should exist at src/index.css', () => {
    expect(fs.existsSync(cssPath)).toBe(true);
  });

  it('should contain @tailwind directives', () => {
    const content = fs.readFileSync(cssPath, 'utf-8');
    expect(content).toContain('@tailwind base');
    expect(content).toContain('@tailwind components');
    expect(content).toContain('@tailwind utilities');
  });

  it('should define :root CSS variables', () => {
    const content = fs.readFileSync(cssPath, 'utf-8');
    expect(content).toContain(':root');
    expect(content).toContain('--background');
    expect(content).toContain('--foreground');
    expect(content).toContain('--primary');
    expect(content).toContain('--brand');
    expect(content).toContain('--success');
    expect(content).toContain('--warning');
    expect(content).toContain('--radius');
  });

  it('should define page-level UI tokens for shared surfaces（定义共享页面表面的页面级 token）', () => {
    const content = fs.readFileSync(cssPath, 'utf-8');
    expect(content).toContain('--page-bg');
    expect(content).toContain('--page-bg-dark');
    expect(content).toContain('--active-bg');
    expect(content).toContain('--inactive-bg');
    expect(content).toContain('--border-page');
  });

  it('should define .dark mode variables', () => {
    const content = fs.readFileSync(cssPath, 'utf-8');
    expect(content).toContain('.dark');
    expect(content).toContain('--background:');
    expect(content).toContain('--foreground:');
    expect(content).toContain('--brand:');
    expect(content).toContain('--success:');
    expect(content).toContain('--warning:');
  });

  it('should apply border-base and body styles', () => {
    const content = fs.readFileSync(cssPath, 'utf-8');
    expect(content).toContain('border-border');
    expect(content).toContain('bg-background');
    expect(content).toContain('text-foreground');
  });
});
