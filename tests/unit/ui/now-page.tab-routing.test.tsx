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

    expect(screen.getByRole('heading', { name: '当下' })).toBeInTheDocument();
    expect(screen.getByTestId('now-page-view-toggle-focus')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('now-page-focus-widget')).toBeInTheDocument();
    expect(screen.getByTestId('now-page-association-list')).toBeInTheDocument();
    expect(screen.queryByTestId('now-page-record')).toBeNull();
    expect(screen.queryByTestId('now-page-today')).toBeNull();
  });

  it('uses a signal-network style header and left-aligned fixed-width toggles（头部样式对齐网络页且切换条左对齐）', () => {
    render(<NowPage />);

    const heading = screen.getByRole('heading', { name: '当下' });
    const toggleBar = screen.getByTestId('now-page-view-bar');
    const focusToggle = screen.getByTestId('now-page-view-toggle-focus');

    expect(heading.className).toContain('text-lg');
    expect(heading.className).toContain('font-semibold');
    expect(toggleBar.className).toContain('self-start');
    expect(focusToggle.className).not.toContain('flex-1');
    expect(focusToggle.className).toContain('px-3');
  });

  it('lets the focus tab own page scrolling instead of clipping children（专注页由页面容器滚动而非截断子组件）', () => {
    render(<NowPage />);

    const focusContent = screen.getByTestId('now-page-focus-panel');
    expect(focusContent.className).toContain('overflow-y-auto');
    expect(focusContent.className).not.toContain('overflow-hidden');
  });

  it('keeps the record tab panel clipped so ChatPage owns the inner scroll（记录页由 ChatPage 接管内部滚动）', () => {
    locationState = {
      pathname: '/eventlog/record',
      searchStr: '',
    };

    render(<NowPage />);

    const recordPanel = screen.getByTestId('now-page-record-panel');
    expect(recordPanel.className).toContain('overflow-hidden');
    expect(recordPanel.className).toContain('min-h-0');
    expect(recordPanel.className).toContain('flex-1');
  });

  it('reads tab from search and routes tab switch through navigate（读取 search 并通过路由切换页签）', () => {
    locationState = {
      pathname: '/eventlog/today',
      searchStr: '',
    };

    render(<NowPage />);

    expect(screen.getByTestId('now-page-today')).toBeInTheDocument();
    expect(screen.queryByTestId('now-page-focus-widget')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '专注' }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/eventlog',
      replace: true,
    });
  });

  it('does not overwrite remembered tab when the route search is empty（空 search 不覆盖已记忆页签）', () => {
    window.sessionStorage.setItem(EVENTLOG_LAST_TAB_KEY, 'today');

    render(<NowPage />);

    expect(window.sessionStorage.getItem(EVENTLOG_LAST_TAB_KEY)).toBe('today');
  });

  it('does not reset remembered tab when leaving the eventlog domain（离开当下域时不重置已记忆页签）', () => {
    locationState = {
      pathname: '/eventlog/record',
      searchStr: '',
    };

    const { rerender } = render(<NowPage />);

    expect(window.sessionStorage.getItem(EVENTLOG_LAST_TAB_KEY)).toBe('record');

    locationState = {
      pathname: '/tasks',
      searchStr: '',
    };

    rerender(<NowPage />);

    expect(window.sessionStorage.getItem(EVENTLOG_LAST_TAB_KEY)).toBe('record');
  });
});
