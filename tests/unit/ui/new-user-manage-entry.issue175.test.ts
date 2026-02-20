import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('new ui user-manage entry issue-175', () => {
  const routesNewPath = path.resolve('src/routes-new.tsx');
  const newSettingsPath = path.resolve('src/ui/new/pages/NewSettingsPage.tsx');
  const routesSource = readFileSync(routesNewPath, 'utf-8');
  const settingsSource = readFileSync(newSettingsPath, 'utf-8');

  it('defines /user-manage route in new router（新路由需保留用户管理路径）', () => {
    expect(routesSource).toContain("path: '/user-manage'");
  });

  it('embeds user-manage component in new settings page（新设置页内嵌用户管理组件）', () => {
    expect(settingsSource).toContain("import { UserManagePage } from '@/ui/pages/UserManagePage'");
    expect(settingsSource).toContain('<UserManagePage embedded />');
    expect(settingsSource).not.toContain('打开用户管理');
    expect(settingsSource).not.toContain("window.location.pathname = '/user-manage'");
  });
});
