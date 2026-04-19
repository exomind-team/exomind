import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageHeaderNav } from '@/ui/app/components/PageHeaderNav';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

describe('PageHeaderNav（共享头部导航）', () => {
  it('renders button tabs for in-page panel switching（页内面板切换继续使用 tabs 语义）', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <PageHeaderNav
        mode="buttons"
        rootTestId="page-header-nav"
        activeId="focus"
        onChange={onChange}
        items={[
          { id: 'focus', label: '专注' },
          { id: 'record', label: '记录' },
        ]}
      />,
    );

    expect(screen.getByTestId('page-header-nav')).toHaveAttribute('role', 'tablist');
    expect(screen.getByRole('tab', { name: '专注' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: '记录' }));

    expect(onChange).toHaveBeenCalledWith('record');
  });

  it('renders route nav for cross-route switches（跨路由切换使用导航语义而不是 tab 语义）', () => {
    render(
      <PageHeaderNav
        mode="links"
        rootTestId="page-header-nav"
        navLabel="任务域导航"
        activeId="timeline"
        items={[
          { id: 'list', label: '任务', to: '/tasks', testId: 'task-domain-tab-list' },
          { id: 'timeline', label: '时间线', to: '/tasks/timeline', testId: 'task-domain-tab-timeline' },
        ]}
      />,
    );

    expect(screen.getByRole('navigation', { name: '任务域导航' })).toBeInTheDocument();
    expect(screen.getByTestId('task-domain-tab-list')).toHaveAttribute('to', '/tasks');
    expect(screen.getByTestId('task-domain-tab-list')).toHaveAttribute('preload', 'render');
    expect(screen.getByTestId('task-domain-tab-timeline')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('task-domain-tab-timeline')).not.toHaveAttribute('role', 'tab');
  });
});
