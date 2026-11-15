import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('issue-198 desktop settings shell（桌面设置壳层）', () => {
  const sourcePath = path.resolve('src/routes.tsx');
  const source = readFileSync(sourcePath, 'utf-8');
  const view = readFileSync(path.resolve('src/ui/app/components/AlphaAppShellView.tsx'), 'utf-8');
  const desktopNavStart = source.indexOf('const desktopNavItems = [');
  const desktopNavEnd = source.indexOf('];', desktopNavStart);
  const desktopNavBlock = source.slice(desktopNavStart, desktopNavEnd);

  it('adds desktop shell components（新增桌面壳层组件）', () => {
    expect(source).toContain('function DesktopSidebar');
    expect(source).toContain('function DesktopLayout');
  });

  it('switches desktop layout for primary app routes（主应用路由切桌面布局）', () => {
    expect(source).toContain("const selectedShell = isDesktop && desktopAdaptiveEnabled ? 'desktop' : 'mobile';");
    expect(source).toContain("if (selectedShell === 'desktop')");
    expect(source).not.toContain('resolveAppShellMode({');
  });

  it('keeps enabled domains and excludes disabled task/proposal navigation（保留启用域，不重新暴露任务/提案）', () => {
    expect(desktopNavBlock).toContain("title: '当下', path: '/eventlog'");
    expect(desktopNavBlock).not.toContain("title: '任务'");
    expect(desktopNavBlock).not.toContain("path: '/tasks'");
    expect(desktopNavBlock).not.toContain("title: '提案箱'");
    expect(desktopNavBlock).not.toContain("path: '/proposals'");
    expect(desktopNavBlock).toContain('...(goalsPageEnabled ? [{');
    expect(desktopNavBlock).toContain("title: '目标'");
    expect(desktopNavBlock).toContain("path: '/goals'");
    expect(desktopNavBlock).toContain('icon: Orbit');
    expect(desktopNavBlock).toContain("key: 'agents'");
    expect(desktopNavBlock).toContain("title: '网络'");
    expect(desktopNavBlock).toContain("path: '/agents'");
    expect(desktopNavBlock).toContain('icon: Waypoints');
    expect(desktopNavBlock).not.toContain("key: 'workbench-test'");
    expect(desktopNavBlock).not.toContain("title: '工作台测试'");
    expect(desktopNavBlock).not.toContain("path: '/workbench'");
    expect(desktopNavBlock).toContain("title: '设置', path: '/settings'");
    expect(desktopNavBlock).not.toContain("title: '总览', path: '/dashboard'");
    expect(desktopNavBlock).not.toContain('事件日志');
    expect(desktopNavBlock).not.toContain('专注计时');
    expect(desktopNavBlock).not.toContain('available');
  });

  it('retains legacy URLs without restoring disabled navigation（旧地址兼容不恢复禁用域入口）', () => {
    expect(desktopNavBlock).not.toContain("key: 'tasks'");
    expect(desktopNavBlock).not.toContain("path: '/proposals'");
    expect(source).toContain("path: '/tasks'");
    expect(source).toContain("path: '/proposals'");
  });

  it('uses network label and waypoints icon in mobile shell nav（移动端底栏使用网络文案与拓扑图标）', () => {
    expect(source).toContain("{ title: '当下', path: '/eventlog', icon: Target }");
    expect(source).toContain("...(agentPageEnabled ? [{ title: '网络', path: '/agents', icon: Waypoints }] : [])");
    expect(source).not.toContain("...(agentPageEnabled ? [{ title: 'Agent', path: '/agents', icon: Bot }] : [])");
  });

  it('does not treat root as eventlog active anymore（根路由不再归到当下标签）', () => {
    expect(source).not.toContain("|| (item.path === '/eventlog' && locationPath === '/')");
    expect(desktopNavBlock).not.toContain("path === '/eventlog' || path === '/'");
  });

  it('registers dashboard route（注册dashboard路由）', () => {
    expect(source).toContain("path: '/dashboard'");
  });


  it('supports desktop adaptive toggle guard（支持桌面适配开关守卫）', () => {
    expect(source).toContain('getDesktopAdaptiveEnabled');
    expect(source).toContain('desktopAdaptiveEnabled');
  });

  it('adds collapsible desktop sidebar state and toggle（桌面侧栏支持收起状态与切换按钮）', () => {
    expect(source).toContain('desktopSidebarCollapsed');
    expect(source).toContain('setDesktopSidebarCollapsed');
    expect(source).toContain('getPersistedDesktopSidebarCollapsed');
    expect(source).toContain('setPersistedDesktopSidebarCollapsed');
    expect(source).toContain('<AlphaDesktopSidebarView');
    expect(view).toContain('data-testid="desktop-sidebar-toggle"');
    expect(view).toContain('收起侧边栏');
    expect(view).toContain('展开侧边栏');
  });

  it('uses settings content area marker（设置内容区标识）', () => {
    expect(source).toContain('<AlphaDesktopShellView');
    expect(view).toContain('data-testid="desktop-settings-content"');
    expect(source).not.toContain('data-testid="desktop-settings-nav"');
  });
});
