import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
describe('New home entry', () => {
  const newFocusPagePath = path.resolve('src/ui/new/pages/NewFocusPage.tsx');
  const newRoutesPath = path.resolve('src/routes-new.tsx');

  it('should have NewFocusPage component file', () => {
    expect(fs.existsSync(newFocusPagePath)).toBe(true);
  });

  it('should have NewFocusPage export', async () => {
    const { NewFocusPage } = await import('@/ui/new/pages/NewFocusPage');
    expect(NewFocusPage).toBeDefined();
    expect(typeof NewFocusPage).toBe('function');
  });

  it('should register / and /eventlog to NewFocusPage in new router', () => {
    const content = fs.readFileSync(newRoutesPath, 'utf-8');
    expect(content).toContain("path: '/'");
    expect(content).toContain("path: '/eventlog'");
    expect(content).toContain('<NewFocusPage />');
  });
});

describe('User guide markdown', () => {
  const guidePath = path.resolve('src/docs/user-guide.md');

  it('should have user guide markdown file', () => {
    expect(fs.existsSync(guidePath)).toBe(true);
  });

  it('should contain basic sections', async () => {
    const content = await fs.promises.readFile(guidePath, 'utf-8');
    expect(content).toContain('# 📖 ExoMind 使用指南');
    expect(content).toContain('快速开始');
    expect(content).toContain('功能介绍');
    expect(content).toContain('常见问题');
  });
});
