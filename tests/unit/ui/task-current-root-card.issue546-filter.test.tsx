import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import type { TaskNode } from '@/lib/types/task';
import { TaskCurrentRootCard } from '@/ui/app/components/TaskCurrentRootCard';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string; updatedAt: number }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: undefined,
    status: 'pending',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: overrides.updatedAt,
    updatedAt: overrides.updatedAt,
    ...overrides,
  };
}

function renderCard(tasks: TaskNode[], searchQuery = ''): void {
  const graph = buildTaskGraph(tasks);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  render(
    <TaskCurrentRootCard
      graph={graph}
      taskById={taskById}
      searchQuery={searchQuery}
      collapsible={true}
    />,
  );
}

describe('TaskCurrentRootCard issue-546 filter and collapse', () => {
  it('filters unblocked tasks by the same fuzzy title rule', () => {
    renderCard([
      makeTask({ id: 'task-1', title: 'aba', updatedAt: 10 }),
      makeTask({ id: 'task-2', title: 'baaab', updatedAt: 20 }),
      makeTask({ id: 'task-3', title: 'delta', updatedAt: 30 }),
      makeTask({ id: 'task-4', title: 'abacus', updatedAt: 40 }),
    ], 'ab');

    expect(screen.getByTestId('task-current-root-card')).toHaveTextContent('未阻塞节点 · 3');
    expect(screen.getByTestId('task-current-root-card-link-task-2')).toBeInTheDocument();
    expect(screen.getByTestId('task-current-root-card-link-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('task-current-root-card-link-task-4')).toBeInTheDocument();
    expect(screen.queryByTestId('task-current-root-card-link-task-3')).toBeNull();
  });

  it('collapses to at most 3 tasks and expands from the header button', () => {
    renderCard([
      makeTask({ id: 'task-1', title: 'Task 1', updatedAt: 10 }),
      makeTask({ id: 'task-2', title: 'Task 2', updatedAt: 20 }),
      makeTask({ id: 'task-3', title: 'Task 3', updatedAt: 30 }),
      makeTask({ id: 'task-4', title: 'Task 4', updatedAt: 40 }),
    ]);

    expect(screen.getByTestId('task-current-root-card-link-task-1')).toBeInTheDocument();
    expect(screen.getByTestId('task-current-root-card-link-task-2')).toBeInTheDocument();
    expect(screen.getByTestId('task-current-root-card-link-task-3')).toBeInTheDocument();
    expect(screen.queryByTestId('task-current-root-card-link-task-4')).toBeNull();

    fireEvent.click(screen.getByTestId('task-current-root-card-collapse-toggle'));

    expect(screen.getByTestId('task-current-root-card-link-task-4')).toBeInTheDocument();
  });
});
