import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TaskDagPage } from '@/ui/app/pages/TaskDagPage';
import type { TaskNode } from '@/lib/types/task';

const listTasksMock = vi.fn<() => Promise<TaskNode[]>>();
const onTaskChangeMock = vi.fn(() => () => {});

const flowApiMocks = vi.hoisted(() => ({
  setCenter: vi.fn(),
  fitView: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@/lib/services', () => ({
  getTaskService: () => ({
    listTasks: listTasksMock,
    onTaskChange: onTaskChangeMock,
  }),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    children,
    onInit,
  }: {
    children?: ReactNode;
    onInit?: (instance: { setCenter: typeof flowApiMocks.setCenter; fitView: typeof flowApiMocks.fitView }) => void;
  }) => {
    onInit?.(flowApiMocks);
    return <div data-testid="mock-react-flow">{children}</div>;
  },
  Background: () => <div data-testid="mock-react-flow-background" />,
  Controls: ({ className, showInteractive }: { className?: string; showInteractive?: boolean }) => (
    <div
      data-testid="mock-react-flow-controls"
      className={className}
      data-show-interactive={showInteractive ? 'true' : 'false'}
    />
  ),
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right' },
}));

function makeTask(overrides: Partial<TaskNode> & { id: string; title: string }): TaskNode {
  return {
    id: overrides.id,
    title: overrides.title,
    description: undefined,
    status: 'not_started',
    priority: 'medium',
    dependsOn: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('TaskDagPage issue-413（任务 DAG controls 对齐网络页）', () => {
  beforeEach(() => {
    flowApiMocks.setCenter.mockReset();
    flowApiMocks.fitView.mockReset();
    listTasksMock.mockReset();
    onTaskChangeMock.mockClear();

    listTasksMock.mockResolvedValue([makeTask({ id: 'task-a', title: '当前根节点 A' })]);
  });

  it('uses shared topology controls class（复用网络页 controls 主题类）', async () => {
    render(<TaskDagPage />);

    await waitFor(() => {
      expect(listTasksMock).toHaveBeenCalledWith(true);
    });

    const controls = await screen.findByTestId('mock-react-flow-controls');
    expect(controls.className).toContain('agent-topology-controls');
  });

  it('enables interactive controls toggle（开启 interactive 开关以显示四按钮）', async () => {
    render(<TaskDagPage />);

    const controls = await screen.findByTestId('mock-react-flow-controls');
    expect(controls).toHaveAttribute('data-show-interactive', 'true');
  });
});
