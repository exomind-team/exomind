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
  updateElapsedMock,
} = vi.hoisted(() => ({
  loadActiveBlockMock: vi.fn(),
  startBlockMock: vi.fn(),
  pauseBlockMock: vi.fn(),
  resumeBlockMock: vi.fn(),
  endBlockMock: vi.fn(),
  updateElapsedMock: vi.fn(),
}));

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: loadActiveBlockMock,
    startBlock: startBlockMock,
    pauseBlock: pauseBlockMock,
    resumeBlock: resumeBlockMock,
    endBlock: endBlockMock,
    updateElapsed: updateElapsedMock,
  }),
}));

describe('TimeBlockWidget Issue-120 behaviors', () => {
  beforeEach(() => {
    loadActiveBlockMock.mockResolvedValue(null);
    startBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: 'Task',
      startTime: Date.now(),
      elapsed: 1500000,
      mode: 'countdown',
      paused: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('clicking Start with empty task name expands and focuses the task textarea', async () => {
    render(<TimeBlockWidget />);

    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    const textarea = await screen.findByTestId('timeblock-task-textarea');
    expect(startBlockMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
  });
});

