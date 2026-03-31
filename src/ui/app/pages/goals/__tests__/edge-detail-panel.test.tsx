import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EdgeDetailPanel } from '../components/EdgeDetailPanel';

describe('EdgeDetailPanel', () => {
  it('hides developer controls when developer mode is unavailable', () => {
    render(
      <EdgeDetailPanel
        edge={{
          id: 'edge-1',
          title: '',
          description: '',
          source: 'me',
          target: 'goal-1',
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        targetStatus="pending"
        taskTitle={undefined}
        sourceLabel="Me"
        targetLabel="Goal"
        showDeveloperControls={false}
        onClose={vi.fn()}
        onUpdate={() => true}
        onJumpNode={vi.fn()}
        onSetOverride={vi.fn()}
        onClearOverride={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '⚙ 开发者' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'pending' })).toBeNull();
  });

  it('keeps developer controls collapsed by default when developer mode is enabled', () => {
    render(
      <EdgeDetailPanel
        edge={{
          id: 'edge-1',
          title: '',
          description: '',
          source: 'me',
          target: 'goal-1',
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        targetStatus="pending"
        taskTitle={undefined}
        sourceLabel="Me"
        targetLabel="Goal"
        showDeveloperControls
        onClose={vi.fn()}
        onUpdate={() => true}
        onJumpNode={vi.fn()}
        onSetOverride={vi.fn()}
        onClearOverride={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '⚙ 开发者' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'pending' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '⚙ 开发者' }));

    expect(screen.getByRole('button', { name: 'pending' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除覆盖' })).toBeInTheDocument();
  });

  it('falls back to the bound task title in the panel title when the edge title is empty', () => {
    render(
      <EdgeDetailPanel
        edge={{
          id: 'edge-task-ref',
          title: '',
          description: '',
          source: 'me',
          target: 'goal-1',
          taskNodeRef: 'task-123',
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        targetStatus="pending"
        taskTitle="真实任务"
        sourceLabel="Me"
        targetLabel="Goal"
        showDeveloperControls
        onClose={vi.fn()}
        onUpdate={() => true}
        onJumpNode={vi.fn()}
        onSetOverride={vi.fn()}
        onClearOverride={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '真实任务' })).toBeInTheDocument();
  });

  it('disables editable fields when the target goal is cancelled', () => {
    render(
      <EdgeDetailPanel
        edge={{
          id: 'edge-cancelled-target',
          title: 'Path',
          description: 'Locked',
          source: 'me',
          target: 'goal-1',
          taskNodeRef: 'task-123',
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        targetStatus="cancelled"
        taskTitle="真实任务"
        sourceLabel="Me"
        targetLabel="Goal"
        showDeveloperControls
        onClose={vi.fn()}
        onUpdate={() => true}
        onJumpNode={vi.fn()}
        onSetOverride={vi.fn()}
        onClearOverride={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('Path')).toBeDisabled();
    expect(screen.getByDisplayValue('Locked')).toBeDisabled();
    expect(screen.getByDisplayValue('task-123')).toBeDisabled();
    expect(screen.getByText('待办')).toBeInTheDocument();
    expect(screen.getByText('target 已取消')).toBeInTheDocument();
  });

  it('submits the current draft once when an external freeze happens', () => {
    const onUpdate = vi.fn(() => true);
    const { rerender } = render(
      <EdgeDetailPanel
        edge={{
          id: 'edge-freeze',
          title: 'Old path',
          description: 'Old description',
          source: 'me',
          target: 'goal-1',
          taskNodeRef: 'task-123',
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        targetStatus="pending"
        taskTitle="真实任务"
        sourceLabel="Me"
        targetLabel="Goal"
        showDeveloperControls
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onJumpNode={vi.fn()}
        onSetOverride={vi.fn()}
        onClearOverride={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('Old path'), { target: { value: 'Draft path' } });
    fireEvent.change(screen.getByDisplayValue('Old description'), { target: { value: 'Draft description' } });

    rerender(
      <EdgeDetailPanel
        edge={{
          id: 'edge-freeze',
          title: 'Old path',
          description: 'Old description',
          source: 'me',
          target: 'goal-1',
          taskNodeRef: 'task-123',
          createdAt: 1,
          updatedAt: 1,
        }}
        status="pending"
        targetStatus="completed"
        taskTitle="真实任务"
        sourceLabel="Me"
        targetLabel="Goal"
        showDeveloperControls
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onJumpNode={vi.fn()}
        onSetOverride={vi.fn()}
        onClearOverride={vi.fn()}
      />,
    );

    expect(onUpdate).toHaveBeenCalledWith({
      title: 'Draft path',
      description: 'Draft description',
    });
  });
});
