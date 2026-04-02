import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NowPage } from '@/ui/app/pages/NowPage';
import { EVENTLOG_LAST_TAB_KEY } from '@/ui/app/pages/eventlog-route-memory';

const navigateMock = vi.fn();
let locationState = {
  pathname: '/eventlog',
  searchStr: '',
};

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => locationState,
  useNavigate: () => navigateMock,
}));

vi.mock('@/ui/app/components/PageTabs', () => ({
  PageTabs: ({
    tabs,
    activeTab,
    onTabChange,
    children,
  }: {
    tabs: Array<{ id: string; label: string }>;
    activeTab: string;
    onTabChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <div data-testid="now-page-page-tabs">
      <div role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {Array.isArray(children)
        ? children.find((child) => child?.props?.['data-tab-id'] === activeTab) ?? null
        : children}
    </div>
  ),
}));

vi.mock('@/components/Chat/ChatPage', () => ({
  ChatPage: () => <div data-testid="now-page-record">记录页</div>,
}));

vi.mock('@/ui/app/components/FocusTimerWidget', () => ({
  FocusTimerWidget: () => <div data-testid="now-page-focus-widget">专注页</div>,
}));

vi.mock('@/ui/app/components/BlockTaskAssociationList', () => ({
  BlockTaskAssociationList: () => <div data-testid="now-page-association-list">关联列表</div>,
}));

vi.mock('@/ui/app/components/NowTodayTab', () => ({
  NowTodayTab: () => <div data-testid="now-page-today">今日页</div>,
}));

describe('NowPage tab routing', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    window.sessionStorage.clear();
    locationState = {
      pathname: '/eventlog',
      searchStr: '',
    };
  });

  it('defaults to focus tab when search is empty（默认进入专注页）', () => {
    render(<NowPage />);

    expect(screen.getByTestId('now-page-page-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('now-page-focus-widget')).toBeInTheDocument();
    expect(screen.getByTestId('now-page-association-list')).toBeInTheDocument();
    expect(screen.queryByTestId('now-page-record')).toBeNull();
    expect(screen.queryByTestId('now-page-today')).toBeNull();
  });

  it('lets the focus tab own page scrolling instead of clipping children（专注页由页面容器滚动而非截断子组件）', () => {
    render(<NowPage />);

    const focusContent = screen.getByTestId('now-page-focus-panel');
    expect(focusContent.className).toContain('overflow-y-auto');
    expect(focusContent.className).not.toContain('overflow-hidden');
  });

  it('keeps the record tab panel clipped so ChatPage owns the inner scroll（记录页由 ChatPage 接管内部滚动）', () => {
    locationState = {
      pathname: '/eventlog',
      searchStr: '?tab=record',
    };

    render(<NowPage />);

    const recordPanel = screen.getByTestId('now-page-record-panel');
    expect(recordPanel.className).toContain('overflow-hidden');
    expect(recordPanel.className).toContain('min-h-0');
    expect(recordPanel.className).toContain('flex-1');
  });

  it('reads tab from search and routes tab switch through navigate（读取 search 并通过路由切换页签）', () => {
    locationState = {
      pathname: '/eventlog',
      searchStr: '?tab=today',
    };

    render(<NowPage />);

    expect(screen.getByTestId('now-page-today')).toBeInTheDocument();
    expect(screen.queryByTestId('now-page-focus-widget')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '专注' }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/eventlog',
      search: {},
      replace: true,
    });
  });

  it('does not overwrite remembered tab when the route search is empty（空 search 不覆盖已记忆页签）', () => {
    window.sessionStorage.setItem(EVENTLOG_LAST_TAB_KEY, 'today');

    render(<NowPage />);

    expect(window.sessionStorage.getItem(EVENTLOG_LAST_TAB_KEY)).toBe('today');
  });
});
