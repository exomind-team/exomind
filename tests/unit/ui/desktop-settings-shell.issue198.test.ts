import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('issue-198 desktop settings shell（桌面设置壳层）', () => {
  const sourcePath = path.resolve('src/routes.tsx');
  const source = readFileSync(sourcePath, 'utf-8');
  const desktopNavStart = source.indexOf('const desktopNavItems = [');
  const desktopNavEnd = source.indexOf('];', desktopNavStart);
  const desktopNavBlock = source.slice(desktopNavStart, desktopNavEnd);

  it('adds desktop shell components（新增桌面壳层组件）', () => {
    expect(source).toContain('function DesktopSidebar');
    expect(source).toContain('function DesktopLayout');
  });

  it('switches desktop layout for primary app routes（主应用路由切桌面布局）', () => {
    expect(source).toContain('const isDesktopAdaptiveRoute');
    expect(source).toContain("location.pathname === '/'");
    expect(source).toContain("location.pathname === '/eventlog'");
    expect(source).toContain("location.pathname === '/dashboard'");
    expect(source).toContain("location.pathname === '/tasks'");
    expect(source).toContain("location.pathname.startsWith('/tasks/')");
    expect(source).toContain("location.pathname === '/me'");
    expect(source).toContain("location.pathname === '/update'");
    expect(source).toContain("location.pathname === '/settings'");
    expect(source).toContain("location.pathname === '/agents'");
  });

  it('uses four desktop nav items with network entry（桌面导航4项且使用网络入口）', () => {
    expect(desktopNavBlock).toContain("title: '当下', path: '/eventlog'");
    expect(desktopNavBlock).toContain("title: '任务', path: '/tasks'");
    expect(desktopNavBlock).toContain("key: 'agents'");
    expect(desktopNavBlock).toContain("title: '网络'");
    expect(desktopNavBlock).toContain("path: '/agents'");
    expect(desktopNavBlock).toContain('icon: Waypoints');
    expect(desktopNavBlock).toContain("title: '设置', path: '/settings'");
    expect(desktopNavBlock).not.toContain("title: '总览', path: '/dashboard'");
    expect(desktopNavBlock).not.toContain('事件日志');
    expect(desktopNavBlock).not.toContain('专注计时');
    expect(desktopNavBlock).not.toContain('available');
  });

  it('uses network label and waypoints icon in mobile shell nav（移动端底栏使用网络文案与拓扑图标）', () => {
    expect(source).toContain("...(agentPageEnabled ? [{ title: '网络', path: '/agents', icon: Waypoints }] : [])");
    expect(source).not.toContain("...(agentPageEnabled ? [{ title: 'Agent', path: '/agents', icon: Bot }] : [])");
  });

  it('registers dashboard route（注册dashboard路由）', () => {
    expect(source).toContain("path: '/dashboard'");
  });

  it('registers legal-support route（注册法律与支持二级路由）', () => {
    expect(source).toContain("path: '/settings/legal-support'");
  });

  it('supports desktop adaptive toggle guard（支持桌面适配开关守卫）', () => {
    expect(source).toContain('getDesktopAdaptiveEnabled');
    expect(source).toContain('desktopAdaptiveEnabled');
  });

  it('uses settings content area marker（设置内容区标识）', () => {
    expect(source).toContain('data-testid="desktop-settings-content"');
    expect(source).not.toContain('data-testid="desktop-settings-nav"');
  });
});
