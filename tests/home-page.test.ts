import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
describe('New home entry', () => {
  const newFocusPagePath = path.resolve('src/ui/app/pages/FocusPage.tsx');
  const ritualHomePagePath = path.resolve('src/ui/app/pages/RitualHomePage.tsx');
  const newRoutesPath = path.resolve('src/routes.tsx');

  it('should have FocusPage component file', () => {
    expect(fs.existsSync(newFocusPagePath)).toBe(true);
  });

  it('should have RitualHomePage component file', () => {
    expect(fs.existsSync(ritualHomePagePath)).toBe(true);
  });

  it('should have FocusPage export', () => {
    const source = fs.readFileSync(newFocusPagePath, 'utf-8');
    expect(source).toContain('export function FocusPage');
  });

  it('should register / to RitualHomePage and keep /eventlog on FocusPage in new router', () => {
    const content = fs.readFileSync(newRoutesPath, 'utf-8');
    expect(content).toContain("path: '/'");
    expect(content).toContain('<RitualHomePage />');
    expect(content).toContain("path: '/eventlog'");
    expect(content).toContain('<FocusPage />');
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
