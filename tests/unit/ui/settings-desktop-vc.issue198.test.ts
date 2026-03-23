import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('issue-198 settings desktop VC layout（设置页桌面VC布局）', () => {
  const routesPath = path.resolve('src/routes.tsx');
  const desktopLayoutPath = path.resolve('src/ui/app/layouts/DesktopSettingsLayout.tsx');
  const routesSource = readFileSync(routesPath, 'utf-8');
  const desktopLayoutSource = readFileSync(desktopLayoutPath, 'utf-8');

  it('desktop settings shell should not keep middle nav column（三栏中间列应移除）', () => {
    expect(routesSource).not.toContain('data-testid="desktop-settings-nav"');
    expect(routesSource).toContain('data-testid="desktop-settings-content"');
  });

  it('settings page should expose desktop VC root（设置页应暴露桌面VC根容器）', () => {
    expect(desktopLayoutSource).toContain('data-testid="new-settings-desktop-vc-root"');
    expect(desktopLayoutSource).toContain('data-testid="new-settings-desktop-vc-tabs"');
    expect(desktopLayoutSource).toContain('data-testid="new-settings-desktop-vc-scroll"');
  });

  it('settings page should provide VC section cards（设置页应提供VC分段大卡片）', () => {
    expect(desktopLayoutSource).toContain('new-settings-desktop-vc-section-theme');
    expect(desktopLayoutSource).toContain('new-settings-desktop-vc-section-focus');
    expect(desktopLayoutSource).toContain('new-settings-desktop-vc-section-data');
    expect(desktopLayoutSource).toContain('new-settings-desktop-vc-section-danger');
    expect(desktopLayoutSource).toContain('new-settings-desktop-vc-section-about');
  });
});
