import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
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

const TabsContext = createContext<{
  value: string;
  onValueChange?: (value: string) => void;
} | null>(null);

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) => (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div data-testid="mock-tabs-root">{children}</div>
    </TabsContext.Provider>
  ),
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => {
    const context = useContext(TabsContext);
    return (
      <button
        type="button"
        role="tab"
        aria-selected={context?.value === value}
        onClick={() => context?.onValueChange?.(value)}
      >
        {children}
      </button>
    );
  },
  TabsContent: ({
    value,
    children,
    className,
  }: {
    value: string;
    children: ReactNode;
    className?: string;
  }) => {
    const context = useContext(TabsContext);
    return context?.value === value ? <div data-testid={`tab-content-${value}`} className={className}>{children}</div> : null;
  },
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

    expect(screen.getByTestId('now-page-focus-widget')).toBeInTheDocument();
    expect(screen.getByTestId('now-page-association-list')).toBeInTheDocument();
    expect(screen.queryByTestId('now-page-record')).toBeNull();
    expect(screen.queryByTestId('now-page-today')).toBeNull();
  });

  it('lets the focus tab own page scrolling instead of clipping children（专注页由页面容器滚动而非截断子组件）', () => {
    render(<NowPage />);

    const focusContent = screen.getByTestId('tab-content-focus');
    expect(focusContent.className).toContain('overflow-y-auto');
    expect(focusContent.className).not.toContain('overflow-hidden');
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
