import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TimeBlockWidget } from '@/components/TimeBlockWidget';

const {
  loadActiveBlockMock,
  startBlockMock,
  pauseBlockMock,
  resumeBlockMock,
  endBlockMock,
  markEndingMock,
  updateElapsedMock,
} = vi.hoisted(() => ({
  loadActiveBlockMock: vi.fn(),
  startBlockMock: vi.fn(),
  pauseBlockMock: vi.fn(),
  resumeBlockMock: vi.fn(),
  endBlockMock: vi.fn(),
  markEndingMock: vi.fn(),
  updateElapsedMock: vi.fn(),
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
  }),
}));

describe('TimeBlockWidget feedback shortcuts', () => {
  const now = new Date('2026-02-13T11:00:00.000Z').getTime();

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    loadActiveBlockMock.mockReset();
    startBlockMock.mockReset();
    pauseBlockMock.mockReset();
    resumeBlockMock.mockReset();
    endBlockMock.mockReset();
    markEndingMock.mockReset();
    updateElapsedMock.mockReset();

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
    vi.unstubAllGlobals();
  });

  it('pressing Enter in feedback textarea should confirm end', async () => {
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
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith('有点累，但完成了');
    });
  });

  it('pressing Shift/Ctrl+Enter in feedback textarea should not confirm end', async () => {
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
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter', shiftKey: true });
    fireEvent.keyDown(feedback, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(endBlockMock).not.toHaveBeenCalled();
  });
});
