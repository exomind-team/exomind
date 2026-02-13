import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeBlockWidget } from '@/components/TimeBlockWidget';

const {
  loadActiveBlockMock,
  startBlockMock,
  markEndingMock,
  pauseBlockMock,
  resumeBlockMock,
  endBlockMock,
  updateElapsedMock,
} = vi.hoisted(() => ({
  loadActiveBlockMock: vi.fn(),
  startBlockMock: vi.fn(),
  markEndingMock: vi.fn(),
  pauseBlockMock: vi.fn(),
  resumeBlockMock: vi.fn(),
  endBlockMock: vi.fn(),
  updateElapsedMock: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: loadActiveBlockMock,
    startBlock: startBlockMock,
    markEnding: markEndingMock,
    pauseBlock: pauseBlockMock,
    resumeBlock: resumeBlockMock,
    endBlock: endBlockMock,
    updateElapsed: updateElapsedMock,
  }),
}));

vi.mock('@/components/ui/toast-hook', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('TimeBlockWidget resume behavior', () => {
  const now = new Date('2026-02-11T08:00:00.000Z').getTime();

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    loadActiveBlockMock.mockReset();
    startBlockMock.mockReset();
    markEndingMock.mockReset();
    pauseBlockMock.mockReset();
    resumeBlockMock.mockReset();
    endBlockMock.mockReset();
    updateElapsedMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('starts timer loop when restoring a running active block', async () => {
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-running',
      name: 'Focus work',
      startTime: now - 5000,
      elapsed: 1000,
      mode: 'countup',
      paused: false,
    });

    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    const rafMock = vi.mocked(requestAnimationFrame);
    expect(rafMock).toHaveBeenCalled();
  });

  it('does not start timer loop when restoring a paused active block', async () => {
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-paused',
      name: 'Paused work',
      startTime: now - 5000,
      elapsed: 1000,
      mode: 'countup',
      paused: true,
      pausedAt: now - 1000,
    });

    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    const rafMock = vi.mocked(requestAnimationFrame);
    expect(rafMock).not.toHaveBeenCalled();
  });

  it('marks ending before opening feedback dialog when clicking end', async () => {
    markEndingMock.mockResolvedValue(undefined);
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-running',
      name: 'Focus work',
      startTime: now - 5000,
      elapsed: 1000,
      mode: 'countup',
      paused: false,
    });

    render(<TimeBlockWidget />);

    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText('结束'));

    await waitFor(() => {
      expect(markEndingMock).toHaveBeenCalledTimes(1);
    });
  });
});
