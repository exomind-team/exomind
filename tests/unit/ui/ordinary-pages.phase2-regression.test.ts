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
    expect(source).toContain('title="请求箱"');
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
});
