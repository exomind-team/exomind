import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EdgeDetailPanel } from '../components/EdgeDetailPanel';

describe('EdgeDetailPanel', () => {
  it('keeps developer controls collapsed by default', () => {
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
        sourceLabel="Me"
        targetLabel="Goal"
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
});
