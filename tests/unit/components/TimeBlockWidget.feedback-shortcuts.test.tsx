import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TimeBlockWidget } from '@/components/TimeBlockWidget';
import { setInputSendMode } from '@/config/input-send-mode';

const {
  loadActiveBlockMock,
  startBlockMock,
  pauseBlockMock,
  resumeBlockMock,
  endBlockMock,
  markEndingMock,
  updateElapsedMock,
  onBlockChangeMock,
  startSyncMock,
  stopSyncMock,
} = vi.hoisted(() => ({
  loadActiveBlockMock: vi.fn(),
  startBlockMock: vi.fn(),
  pauseBlockMock: vi.fn(),
  resumeBlockMock: vi.fn(),
  endBlockMock: vi.fn(),
  markEndingMock: vi.fn(),
  updateElapsedMock: vi.fn(),
  onBlockChangeMock: vi.fn(() => () => {}),
  startSyncMock: vi.fn().mockResolvedValue(undefined),
  stopSyncMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: loadActiveBlockMock,
    startBlock: startBlockMock,
    pauseBlock: pauseBlockMock,
    resumeBlock: resumeBlockMock,
    endBlock: endBlockMock,
    markEnding: markEndingMock,
    updateElapsed: updateElapsedMock,
    onBlockChange: onBlockChangeMock,
    startSync: startSyncMock,
    stopSync: stopSyncMock,
  }),
}));

describe('TimeBlockWidget feedback shortcuts', () => {
  const now = new Date('2026-02-13T11:00:00.000Z').getTime();

  beforeEach(() => {
    setInputSendMode('ctrl-enter-send');
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    loadActiveBlockMock.mockReset();
    startBlockMock.mockReset();
    pauseBlockMock.mockReset();
    resumeBlockMock.mockReset();
    endBlockMock.mockReset();
    markEndingMock.mockReset();
    updateElapsedMock.mockReset();
    onBlockChangeMock.mockReset();
    onBlockChangeMock.mockReturnValue(() => {});
    startSyncMock.mockReset();
    stopSyncMock.mockReset();
    startSyncMock.mockResolvedValue(undefined);
    stopSyncMock.mockResolvedValue(undefined);

    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-running',
      name: 'Focus work',
      startTime: now - 5000,
      elapsed: 1000,
      mode: 'countup',
      paused: false,
    });
    endBlockMock.mockResolvedValue(null);
    markEndingMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pressing Ctrl+Enter in feedback textarea should confirm end by default', async () => {
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));

    await waitFor(() => {
      expect(markEndingMock).toHaveBeenCalledTimes(1);
    });

    const feedback = await screen.findByTestId('timeblock-feedback-textarea');
    fireEvent.change(feedback, { target: { value: '有点累，但完成了' } });
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith('有点累，但完成了');
    });
  });

  it('pressing Enter or Shift+Enter in feedback textarea should not confirm end by default', async () => {
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));

    await waitFor(() => {
      expect(markEndingMock).toHaveBeenCalledTimes(1);
    });

    const feedback = await screen.findByTestId('timeblock-feedback-textarea');
    fireEvent.change(feedback, { target: { value: '第一行' } });
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter', shiftKey: true });

    expect(endBlockMock).not.toHaveBeenCalled();
  });

  it('pressing Enter in feedback textarea should confirm end in enter-send mode', async () => {
    setInputSendMode('enter-send');
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));

    await waitFor(() => {
      expect(markEndingMock).toHaveBeenCalledTimes(1);
    });

    const feedback = await screen.findByTestId('timeblock-feedback-textarea');
    fireEvent.change(feedback, { target: { value: 'Enter 模式结束' } });
    // TimeBlockWidget uses submitMode: 'ctrl-enter-only', so plain Enter does NOT submit
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter' });

    expect(endBlockMock).not.toHaveBeenCalled();

    // Ctrl+Enter always submits regardless of inputSendMode
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter', ctrlKey: true });

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith('Enter 模式结束');
    });
  });

  it('allows closing feedback dialog on Escape and reopening it via end button', async () => {
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));
    await screen.findByTestId('timeblock-feedback-textarea');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('timeblock-feedback-textarea')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));
    await screen.findByTestId('timeblock-feedback-textarea');
    expect(markEndingMock).toHaveBeenCalledTimes(1);
  });

  it('requires 5s calm-down confirmation before skipping empty feedback', async () => {
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));
    await screen.findByTestId('timeblock-feedback-textarea');

    const confirmButton = screen.getByTestId('timeblock-feedback-confirm');
    vi.useFakeTimers();
    fireEvent.click(confirmButton);

    expect(endBlockMock).not.toHaveBeenCalled();
    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toHaveTextContent('确认跳过反馈(5s)');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(confirmButton).toHaveTextContent('确认跳过反馈(4s)');

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(confirmButton).not.toBeDisabled();
    expect(confirmButton).toHaveTextContent('确认跳过反馈');

    fireEvent.click(confirmButton);

    vi.useRealTimers();
    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith(undefined);
    });
  });

  it('resets skip-confirm state when feedback content changes', async () => {
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));
    const feedback = await screen.findByTestId('timeblock-feedback-textarea');
    const confirmButton = screen.getByTestId('timeblock-feedback-confirm');

    vi.useFakeTimers();
    fireEvent.click(confirmButton);
    expect(confirmButton).toHaveTextContent('确认跳过反馈(5s)');
    expect(confirmButton).toBeDisabled();

    fireEvent.change(feedback, { target: { value: '补一条反馈' } });
    expect(confirmButton).toHaveTextContent('确认结束');
    expect(confirmButton).not.toBeDisabled();
    vi.useRealTimers();
  });

  it('keeps end button square icon during normal running state', async () => {
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    const endButton = screen.getByRole('button', { name: '结束' });
    expect(endButton.querySelector('.lucide-square')).not.toBeNull();
    expect(endButton.querySelector('.lucide-notepad-text')).toBeNull();
    expect(endButton).toHaveAttribute('title', '结束');
    expect(endButton.className).not.toContain('bg-brand');

    const pauseButton = screen.getByRole('button', { name: '暂停' });
    expect(pauseButton.className).toContain('bg-warning');
    expect(pauseButton.className).toContain('text-white');
  });

  it('reopens feedback dialog when block is already in feedback stage', async () => {
    loadActiveBlockMock.mockResolvedValueOnce({
      startId: 'block-feedback',
      name: 'Focus work',
      startTime: now - 5000,
      elapsed: 1000,
      mode: 'countup',
      paused: true,
      phase: 'feedback_in_progress',
      actionEndedAt: now - 1000,
      feedbackStartedAt: now - 1000,
    });

    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    const endButton = screen.getByRole('button', { name: '结束' });
    expect(endButton).not.toBeDisabled();
    const feedbackIcon = endButton.querySelector('.lucide-notepad-text');
    expect(feedbackIcon).not.toBeNull();
    expect(endButton.querySelector('.lucide-square')).toBeNull();
    expect(endButton).toHaveAttribute('title', '反馈中');
    expect(endButton.className).toContain('bg-brand');
    expect(feedbackIcon).toHaveClass('text-white');

    fireEvent.click(endButton);

    await screen.findByTestId('timeblock-feedback-textarea');
    expect(markEndingMock).not.toHaveBeenCalled();
  });

  it('prevents duplicate submit while feedback is being submitted', async () => {
    endBlockMock.mockImplementation(() => new Promise(() => {}));
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));
    await screen.findByTestId('timeblock-feedback-textarea');
    fireEvent.change(screen.getByTestId('timeblock-feedback-textarea'), {
      target: { value: '提交中测试' },
    });

    fireEvent.click(screen.getByTestId('timeblock-feedback-confirm'));
    fireEvent.click(screen.getByTestId('timeblock-feedback-confirm'));

    expect(endBlockMock).toHaveBeenCalledTimes(1);
  });
});
