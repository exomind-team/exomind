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

  it('keeps feedback dialog open on Escape and hides close button', async () => {
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));
    await screen.findByTestId('timeblock-feedback-textarea');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    expect(screen.getByTestId('timeblock-feedback-textarea')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('supports skip-feedback path and ends block without note', async () => {
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));
    await screen.findByTestId('timeblock-feedback-textarea');

    fireEvent.click(screen.getByTestId('timeblock-feedback-skip'));

    await waitFor(() => {
      expect(endBlockMock).toHaveBeenCalledWith(undefined);
    });
  });

  it('prevents duplicate submit while feedback is being submitted', async () => {
    endBlockMock.mockImplementation(() => new Promise(() => {}));
    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '结束' }));
    await screen.findByTestId('timeblock-feedback-textarea');

    fireEvent.click(screen.getByTestId('timeblock-feedback-confirm'));
    fireEvent.click(screen.getByTestId('timeblock-feedback-confirm'));

    expect(endBlockMock).toHaveBeenCalledTimes(1);
  });
});
