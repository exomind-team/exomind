import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskDomainTabs } from '@/ui/app/components/TaskDomainTabs';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

describe('TaskDomainTabs（任务域顶部导航）', () => {
  it('renders task domain tabs with the active item highlighted（渲染任务域顶部切换并标记激活项）', () => {
    render(<TaskDomainTabs active="proposals" />);

    expect(screen.getByTestId('task-domain-tab-list')).toHaveAttribute('to', '/tasks');
    expect(screen.getByTestId('task-domain-tab-timeline')).toHaveAttribute('to', '/tasks/timeline');
    expect(screen.getByTestId('task-domain-tab-dag')).toHaveAttribute('to', '/tasks/dag');
    expect(screen.getByTestId('task-domain-tab-proposals')).toHaveAttribute('to', '/proposals');
    expect(screen.getByTestId('task-domain-tab-proposals')).toHaveAttribute('aria-selected', 'true');
  });
});
