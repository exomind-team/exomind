import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimerConfigPanel } from '@/ui/app/components/TimerConfigPanel';

describe('TimerConfigPanel', () => {
  it('defaults to countdown mode with 25 preset selected（默认倒计时显示 25 分钟）', () => {
    render(
      <TimerConfigPanel
        timerMode="countdown"
        countdownMinutes={25}
        setTimerMode={vi.fn()}
        setCountdownMinutes={vi.fn()}
        customDurationDraft="25"
        setCustomDurationDraft={vi.fn()}
        commitCustomDuration={vi.fn()}
      />,
    );

    expect(screen.getByTestId('task-mode-countdown')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('task-countdown-preset-15')).toBeInTheDocument();
    expect(screen.getByTestId('task-countdown-preset-25')).toBeInTheDocument();
    expect(screen.getByTestId('task-countdown-preset-45')).toBeInTheDocument();
    expect(screen.getByTestId('task-countdown-preset-60')).toBeInTheDocument();
    expect(screen.getByTestId('task-countdown-preset-25')).toHaveClass('font-semibold');
  });

  it('hides countdown presets in countup mode（切到正计时时隐藏倒计时预设）', () => {
    render(
      <TimerConfigPanel
        timerMode="countup"
        countdownMinutes={25}
        setTimerMode={vi.fn()}
        setCountdownMinutes={vi.fn()}
        customDurationDraft="25"
        setCustomDurationDraft={vi.fn()}
        commitCustomDuration={vi.fn()}
      />,
    );

    expect(screen.getByTestId('task-mode-countup')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('task-countdown-preset-25')).toBeNull();
    expect(screen.queryByTestId('task-countdown-custom-trigger')).toBeNull();
  });

  it('calls preset callback when preset button clicked（点击预设按钮触发回调）', () => {
    const setCountdownMinutes = vi.fn();

    render(
      <TimerConfigPanel
        timerMode="countdown"
        countdownMinutes={25}
        setTimerMode={vi.fn()}
        setCountdownMinutes={setCountdownMinutes}
        customDurationDraft="25"
        setCustomDurationDraft={vi.fn()}
        commitCustomDuration={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('task-countdown-preset-45'));

    expect(setCountdownMinutes).toHaveBeenCalledWith(45);
  });

  it('commits custom countdown input（自定义输入提交回调正确）', () => {
    const setCustomDurationDraft = vi.fn();
    const commitCustomDuration = vi.fn();

    render(
      <TimerConfigPanel
        timerMode="countdown"
        countdownMinutes={25}
        setTimerMode={vi.fn()}
        setCountdownMinutes={vi.fn()}
        customDurationDraft="25"
        setCustomDurationDraft={setCustomDurationDraft}
        commitCustomDuration={commitCustomDuration}
      />,
    );

    fireEvent.click(screen.getByTestId('task-countdown-custom-trigger'));
    const customInput = screen.getByTestId('task-countdown-custom-input');
    fireEvent.change(customInput, { target: { value: '37' } });
    fireEvent.keyDown(customInput, { key: 'Enter' });

    expect(setCustomDurationDraft).toHaveBeenCalledWith('37');
    expect(commitCustomDuration).toHaveBeenCalledTimes(1);
  });

  it('shows estimated minutes as initial selected value（estimatedMinutes 作为初始选中值）', () => {
    render(
      <TimerConfigPanel
        timerMode="countdown"
        countdownMinutes={45}
        setTimerMode={vi.fn()}
        setCountdownMinutes={vi.fn()}
        customDurationDraft="45"
        setCustomDurationDraft={vi.fn()}
        commitCustomDuration={vi.fn()}
      />,
    );

    expect(screen.getByTestId('task-countdown-preset-45')).toHaveClass('font-semibold');
  });
});
