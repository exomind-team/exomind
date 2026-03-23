import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EnergyBar } from '@/ui/app/pages/agents/AgentDetailPage';

describe('agent energy bar issue-444（Agent 能量条）', () => {
  it('shows refill button for dormant energy when callback exists（休眠时显示充能按钮）', () => {
    const onRefill = vi.fn();

    render(
      <EnergyBar
        energy={{
          agent_id: 'life-alpha',
          current: 0,
          max: 100,
          ratio: 0,
          tick_cost: 5,
          phase: 'dormant',
          is_dormant: true,
        }}
        onRefill={onRefill}
      />,
    );

    const button = screen.getByRole('button', { name: '充能复活' });
    fireEvent.click(button);
    expect(onRefill).toHaveBeenCalledTimes(1);
  });

  it('hides refill button for non-dormant energy（非休眠时不显示充能按钮）', () => {
    render(
      <EnergyBar
        energy={{
          agent_id: 'life-alpha',
          current: 80,
          max: 100,
          ratio: 0.8,
          tick_cost: 5,
          phase: 'slowing',
          is_dormant: false,
        }}
        onRefill={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '充能复活' })).not.toBeInTheDocument();
  });

  it('shows pending label while refilling（充能中显示进行态）', () => {
    render(
      <EnergyBar
        energy={{
          agent_id: 'life-alpha',
          current: 0,
          max: 100,
          ratio: 0,
          tick_cost: 5,
          phase: 'dormant',
          is_dormant: true,
        }}
        onRefill={vi.fn()}
        isRefilling
      />,
    );

    expect(screen.getByRole('button', { name: '充能中...' })).toBeDisabled();
  });
});
