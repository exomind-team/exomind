import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

describe('ordinary pages phase 2 regression（普通页面阶段二回归）', () => {
  it('keeps NowPage on shared shell with route-driven header tabs（当下页继续走共享壳层与路由头部导航）', () => {
    const source = readSource('src/ui/app/pages/NowPage.tsx');

    expect(source).toContain('<PageShell');
    expect(source).toContain('title="当下"');
    expect(source).toContain('headerBottom={<NowViewBar');
    expect(source).toContain("getEventlogPathForTab(normalized)");
  });

  it('keeps TasksPage on shared shell with task domain tabs（任务页继续走共享壳层与任务域导航）', () => {
    const source = readSource('src/ui/app/pages/TasksPage.tsx');

    expect(source).toContain('<PageShell');
    expect(source).toContain('title="任务"');
    expect(source).toContain('headerBottom={<TaskDomainTabs active="list" />}');
    expect(source).toContain('<NowInputRow');
  });

  it('keeps ProposalInboxPage inside shared shell and task domain tabs（请求箱继续挂在共享壳层和任务域导航下）', () => {
    const source = readSource('src/ui/app/pages/proposals/ProposalInboxPage.tsx');

    expect(source).toContain('<PageShell');
    expect(source).not.toContain('TaskBreadcrumb');
    expect(source).toContain('title="任务"');
    expect(source).toContain('eyebrow="Proposal Inbox"');
    expect(source).toContain('headerBottom={<TaskDomainTabs active="proposals" />}');
  });

  it('keeps MePage and RemindersPage on shared shell plus PageTabs（Me 与提醒页继续走共享壳层和 PageTabs）', () => {
    const meSource = readSource('src/ui/app/pages/MePage.tsx');
    const remindersSource = readSource('src/ui/app/pages/RemindersPage.tsx');

    expect(meSource).toContain('<PageShell');
    expect(meSource).toContain('title="Me"');
    expect(meSource).toContain('<PageTabs');

    expect(remindersSource).toContain('<PageShell');
    expect(remindersSource).toContain('title="提醒"');
    expect(remindersSource).toContain('<PageTabs');
  });

  it('keeps SettingsPage on shared shell in both desktop and mobile flows（设置页桌面/移动仍走共享壳层）', () => {
    const source = readSource('src/ui/app/pages/SettingsPage.tsx');

    expect(source).toContain('<PageShell title="设置" hideHeader');
    expect(source).toContain('<PageShell title="设置" contentClassName=');
  });

  it('places task timeline domain tabs below the title block and before timeline controls（时间线页任务域 tabs 应位于标题之后、时间线控件之前）', () => {
    const source = readSource('src/ui/app/pages/TaskTimelinePage.tsx');
    const tabsIndex = source.indexOf('<TaskDomainTabs active="timeline" />');
    const headingIndex = source.indexOf('<h1 className="text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务</h1>');
    const rangeControlsIndex = source.indexOf('显示待办段');
    const metricsIndex = source.indexOf("比例尺：");

    expect(tabsIndex).toBeGreaterThan(-1);
    expect(headingIndex).toBeGreaterThan(-1);
    expect(rangeControlsIndex).toBeGreaterThan(-1);
    expect(metricsIndex).toBeGreaterThan(-1);
    expect(tabsIndex).toBeGreaterThan(headingIndex);
    expect(tabsIndex).toBeLessThan(rangeControlsIndex);
    expect(tabsIndex).toBeLessThan(metricsIndex);
  });

  it('places task dag domain tabs below the title block（依赖图页任务域 tabs 应位于标题之后）', () => {
    const source = readSource('src/ui/app/pages/TaskDagPage.tsx');
    const tabsIndex = source.indexOf('<TaskDomainTabs active="dag" />');
    const headingIndex = source.indexOf('<h1 className="text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务</h1>');

    expect(tabsIndex).toBeGreaterThan(-1);
    expect(headingIndex).toBeGreaterThan(-1);
    expect(tabsIndex).toBeGreaterThan(headingIndex);
  });

  it('removes breadcrumb/url-like bars from task subviews that already use top tabs（已使用顶部 tabs 的任务子页不再显示面包屑条）', () => {
    const timelineSource = readSource('src/ui/app/pages/TaskTimelinePage.tsx');
    const dagSource = readSource('src/ui/app/pages/TaskDagPage.tsx');
    const proposalSource = readSource('src/ui/app/pages/proposals/ProposalInboxPage.tsx');

    expect(timelineSource).not.toContain('TaskBreadcrumb');
    expect(dagSource).not.toContain('TaskBreadcrumb');
    expect(proposalSource).not.toContain('TaskBreadcrumb');
  });
});
