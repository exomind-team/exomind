import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskBreadcrumb } from '@/ui/app/components/TaskBreadcrumb';
import { TASKS_LAST_PATH_KEY } from '@/ui/app/pages/task-route-memory';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    onClick,
  }: {
    children?: ReactNode;
    to: string;
    search?: Record<string, string>;
    onClick?: () => void;
  }) => (
    <button type="button" data-testid={`breadcrumb-link-${to}`} data-search={JSON.stringify(search ?? null)} onClick={onClick}>
      {children}
    </button>
  ),
}));

describe('TaskBreadcrumb return to task root', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('adds the force-main search flag and clears remembered task sub-routes', () => {
    sessionStorage.setItem(TASKS_LAST_PATH_KEY, '/tasks/dag');

    render(<TaskBreadcrumb segments={[{ label: '任务', to: '/tasks' }]} current={{ label: 'DAG 视图' }} />);

    const link = screen.getByTestId('breadcrumb-link-/tasks');
    expect(link.getAttribute('data-search')).toBe(JSON.stringify({ main: '1' }));

    fireEvent.click(link);
    expect(sessionStorage.getItem(TASKS_LAST_PATH_KEY)).toBeNull();
  });
});
