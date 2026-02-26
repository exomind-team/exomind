import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('issue-198 desktop settings shell（桌面设置壳层）', () => {
  const sourcePath = path.resolve('src/routes-new.tsx');
  const source = readFileSync(sourcePath, 'utf-8');

  it('adds desktop shell components（新增桌面壳层组件）', () => {
    expect(source).toContain('function DesktopSidebar');
    expect(source).toContain('function DesktopLayout');
  });

  it('switches desktop layout only for settings route（仅设置页切桌面布局）', () => {
    expect(source).toContain('const isDesktopSettingsRoute');
    expect(source).toContain("location.pathname === '/settings'");
  });
});
