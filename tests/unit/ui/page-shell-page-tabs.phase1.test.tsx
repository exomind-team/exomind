import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageShell } from '@/ui/app/components/PageShell';
import { PageTabs } from '@/ui/app/components/PageTabs';

describe('PageShell（统一页面壳层）', () => {
  it('renders title and content inside a shared page surface（统一渲染标题和内容容器）', () => {
    render(
      <PageShell title="测试页面">
        <div>内容区</div>
      </PageShell>,
    );

    expect(screen.getByRole('heading', { name: '测试页面' })).toBeInTheDocument();
    expect(screen.getByText('内容区')).toBeInTheDocument();
    expect(screen.getByTestId('page-shell-root')).toBeInTheDocument();
  });

  it('supports eyebrow, subtitle, header action, and header bottom（支持统一页面头部结构）', () => {
    render(
      <PageShell
        title="请求箱"
        headerTop={<div data-testid="page-shell-header-top">面包屑</div>}
        eyebrow="Proposal Inbox"
        subtitle="统一的页面头部结构"
        headerAction={<button type="button">刷新</button>}
        headerBottom={<div data-testid="page-shell-header-bottom">切换条</div>}
      >
        <div>内容区</div>
      </PageShell>,
    );

    expect(screen.getByTestId('page-shell-header-top')).toHaveTextContent('面包屑');
    expect(screen.getByText('Proposal Inbox')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '请求箱' })).toBeInTheDocument();
    expect(screen.getByText('统一的页面头部结构')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(screen.getByTestId('page-shell-header-bottom')).toHaveTextContent('切换条');
  });
});

describe('PageTabs（统一标签页容器）', () => {
  it('renders a tablist with the active panel（渲染标签列表和当前面板）', () => {
    render(
      <PageTabs
        activeTab="overview"
        onTabChange={() => {}}
        tabs={[
          { id: 'overview', label: '概览' },
          { id: 'details', label: '详情' },
        ]}
      >
        <div data-tab-id="overview">概览面板</div>
        <div data-tab-id="details">详情面板</div>
      </PageTabs>,
    );

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('概览面板')).toBeInTheDocument();
  });

  it('keeps tablist outside scroll content and clips panel overflow（标签栏固定在内容滚动层之外）', () => {
    render(
      <PageTabs
        activeTab="overview"
        onTabChange={() => {}}
        tabs={[
          { id: 'overview', label: '概览' },
          { id: 'details', label: '详情' },
        ]}
      >
        <div data-tab-id="overview">概览面板</div>
        <div data-tab-id="details">详情面板</div>
      </PageTabs>,
    );

    const tabList = screen.getByRole('tablist');
    const panel = screen.getByRole('tabpanel');

    expect(tabList.className).toContain('shrink-0');
    expect(panel.className).toContain('data-[state=active]:flex');
    expect(panel.className).toContain('data-[state=inactive]:hidden');
    expect(panel.className).toContain('overflow-hidden');
  });

  it('keeps inactive panels hidden so they do not occupy layout height（未激活面板不占布局高度）', () => {
    render(
      <PageTabs
        activeTab="overview"
        onTabChange={() => {}}
        tabs={[
          { id: 'overview', label: '概览' },
          { id: 'details', label: '详情' },
        ]}
      >
        <div data-tab-id="overview">概览面板</div>
        <div data-tab-id="details">详情面板</div>
      </PageTabs>,
    );

    expect(screen.getByText('概览面板')).toBeVisible();
    expect(screen.queryByText('详情面板')).toBeNull();
  });
});
