import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SplitEdgeDialog } from '../components/SplitEdgeDialog';
import type { GoalNode } from '../goal-types';

const baseGoal = (overrides: Partial<GoalNode>): GoalNode => ({
  id: 'goal-base',
  title: 'Base Goal',
  description: '',
  cancelled: false,
  completionRule: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('SplitEdgeDialog', () => {
  it('filters existing goals by search query', () => {
    render(
      <SplitEdgeDialog
        open
        availableGoals={[
          baseGoal({ id: 'goal-alpha', title: 'Alpha Path' }),
          baseGoal({ id: 'goal-beta', title: 'Beta Bridge' }),
          baseGoal({ id: 'goal-gamma', title: 'Gamma Route' }),
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
