import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('SplitEdgeDialog', () => {
  it('filters existing goals with a search query', async () => {
    const { SplitEdgeDialog } = await import('../components/SplitEdgeDialog');

    render(
      <SplitEdgeDialog
        open
        availableGoals={[
          {
            id: 'goal-alpha',
            title: 'Alpha Route',
            description: '',
            cancelled: false,
            completionRule: [],
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'goal-beta',
            title: 'Beta Bridge',
            description: '',
            cancelled: false,
            completionRule: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        insertMode="existing"
        existingGoalId=""
        newGoalTitle=""
        originalEdgePlacement="second-half"
        onInsertModeChange={vi.fn()}
        onExistingGoalIdChange={vi.fn()}
        onNewGoalTitleChange={vi.fn()}
        onOriginalEdgePlacementChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('搜索已有目标'), { target: { value: 'beta' } });

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['请选择目标', 'Beta Bridge']);
  });
});
