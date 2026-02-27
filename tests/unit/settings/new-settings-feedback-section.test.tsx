import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '../components/settings/setup-settings-mocks.tsx';
import { NewSettingsPage } from '@/ui/new/pages/NewSettingsPage';
import { setFeedbackPreferences } from '@/config/feedback-preferences';

describe('NewSettingsPage feedback section（反馈分组配置）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders feedback section and defaults to quick-feedback only', () => {
    render(<NewSettingsPage />);

    expect(screen.getByTestId('new-settings-feedback-section')).toBeInTheDocument();
    expect(screen.getByTestId('new-settings-feedback-content-row')).toBeInTheDocument();

    expect(screen.getByTestId('new-settings-feedback-content-timing')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('new-settings-feedback-content-statistics')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('new-settings-feedback-content-quick')).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports multi-select toggles and keeps middle option without rounded corners', () => {
    render(<NewSettingsPage />);

    const timing = screen.getByTestId('new-settings-feedback-content-timing');
    const statistics = screen.getByTestId('new-settings-feedback-content-statistics');
    const quick = screen.getByTestId('new-settings-feedback-content-quick');

    expect(statistics.className).toContain('rounded-none');

    fireEvent.click(timing);
    expect(timing).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(statistics);
    expect(statistics).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(quick);
    expect(quick).toHaveAttribute('aria-pressed', 'false');

    expect(setFeedbackPreferences).toHaveBeenCalledTimes(3);
    expect(setFeedbackPreferences).toHaveBeenLastCalledWith({
      timingInfoEnabled: true,
      statisticsEnabled: true,
      quickFeedbackEnabled: false,
    });
  });
});
