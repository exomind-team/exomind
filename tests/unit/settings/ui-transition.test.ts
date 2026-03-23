import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import fs from 'node:fs';

describe('UI transition retired（旧 UI 切换已下线）', () => {
  const appSource = readFileSync(path.resolve('src/App.tsx'), 'utf-8');
  const newSettingsSource = readFileSync(path.resolve('src/ui/app/pages/SettingsPage.tsx'), 'utf-8');

  it('app uses new router only（入口只使用新路由）', () => {
    expect(appSource).toContain('appRouter');
    expect(appSource).toContain('appRouter } from "@/routes"');
    expect(appSource).not.toContain('routes-new');
    expect(appSource).not.toContain('getUIMode');
  });

  it('legacy settings and ui-mode files are removed（旧设置页和模式开关文件已删除）', () => {
    expect(fs.existsSync(path.resolve('src/components/Settings/SettingsPage.tsx'))).toBe(false);
    expect(fs.existsSync(path.resolve('src/config/ui-mode.ts'))).toBe(false);
  });

  it('new settings page dispatches registry-driven layouts（新设置页改为 registry/layout 驱动）', () => {
    expect(newSettingsSource).toContain('getVisibleSettings');
    expect(newSettingsSource).toContain('DesktopSettingsLayout');
    expect(newSettingsSource).toContain('MobileSettingsLayout');
    expect(newSettingsSource).not.toContain('旧版页面');
    expect(newSettingsSource).not.toContain('setUIMode');
  });
});
