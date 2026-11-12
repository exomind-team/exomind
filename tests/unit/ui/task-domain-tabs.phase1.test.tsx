import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskDomainTabs } from '@/ui/app/components/TaskDomainTabs';

const getProposalInboxEnabledMock = vi.fn(() => true);
const subscribeProposalInboxEnabledChangesMock = vi.fn(() => () => {});

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@/config/proposal-inbox-enabled', () => ({
  getProposalInboxEnabled: () => getProposalInboxEnabledMock(),
  subscribeProposalInboxEnabledChanges: (...args: unknown[]) => subscribeProposalInboxEnabledChangesMock(...args),
}));

describe('TaskDomainTabs（任务域顶部导航）', () => {
  it('renders task domain links with the active item highlighted（渲染任务域导航并标记当前路由）', () => {
    render(<TaskDomainTabs active="timeline" />);

    expect(screen.getByRole('navigation', { name: '任务域导航' })).toBeInTheDocument();
    expect(screen.getByTestId('task-domain-tab-list')).toHaveTextContent('列表');
    expect(screen.getByTestId('task-domain-tab-list')).toHaveAttribute('to', '/tasks');
    expect(screen.getByTestId('task-domain-tab-timeline')).toHaveAttribute('to', '/tasks/timeline');
    expect(screen.getByTestId('task-domain-tab-dag')).toHaveAttribute('to', '/tasks/dag');
    expect(screen.getByTestId('task-domain-tab-timeline')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('task-domain-tab-timeline')).not.toHaveAttribute('role', 'tab');
    expect(screen.queryByTestId('task-domain-tab-proposals')).not.toBeInTheDocument();
  });

  it.each([false, true])('keeps the proposal tab disabled when the stored flag is %s（旧开关不能恢复提案入口）', (enabled) => {
    getProposalInboxEnabledMock.mockReturnValue(enabled);

    render(<TaskDomainTabs active="list" />);

    expect(screen.queryByTestId('task-domain-tab-proposals')).toBeNull();
    expect(subscribeProposalInboxEnabledChangesMock).not.toHaveBeenCalled();
  });
});
