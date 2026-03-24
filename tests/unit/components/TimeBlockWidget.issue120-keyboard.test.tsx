import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeBlockWidget, type TimeBlockWidgetHandle } from '@/components/TimeBlockWidget';

const {
  loadActiveBlockMock,
  startBlockMock,
  pauseBlockMock,
  resumeBlockMock,
  endBlockMock,
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
    updateElapsed: updateElapsedMock,
    onBlockChange: onBlockChangeMock,
    startSync: startSyncMock,
    stopSync: stopSyncMock,
  }),
}));

vi.mock('@/components/ui/toast-hook', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('TimeBlockWidget keyboard shortcuts (Issue #120)', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    loadActiveBlockMock.mockReset();
    startBlockMock.mockReset();
    pauseBlockMock.mockReset();
    resumeBlockMock.mockReset();
    endBlockMock.mockReset();
    updateElapsedMock.mockReset();
    onBlockChangeMock.mockReset();
    onBlockChangeMock.mockReturnValue(() => {});
    startSyncMock.mockReset();
    stopSyncMock.mockReset();
    startSyncMock.mockResolvedValue(undefined);
    stopSyncMock.mockResolvedValue(undefined);

    loadActiveBlockMock.mockResolvedValue(null);
    startBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: 'Test Task',
      startTime: Date.now(),
      elapsed: 0,
      mode: 'countdown',
      paused: false,
    });
    pauseBlockMock.mockResolvedValue(undefined);
    resumeBlockMock.mockResolvedValue(undefined);
    endBlockMock.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('pauseOrResume should pause running time block', async () => {
    const ref = React.createRef<TimeBlockWidgetHandle>();
    render(<TimeBlockWidget ref={ref} expanded={true} />);

    // Enter task name and start
    const textarea = await screen.findByTestId('timeblock-task-textarea');
    fireEvent.change(textarea, { target: { value: 'Test Task' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(startBlockMock).toHaveBeenCalled();
    });

    // Test pauseOrResume when running
    await ref.current?.pauseOrResume();
    expect(pauseBlockMock).toHaveBeenCalled();
  });

  it('pauseOrResume should resume paused time block', async () => {
    const ref = React.createRef<TimeBlockWidgetHandle>();
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: 'Test Task',
      startTime: Date.now() - 60000,
      elapsed: 60000,
      mode: 'countdown',
      paused: true, // Already paused
    });

    render(<TimeBlockWidget ref={ref} expanded={true} />);

    // Wait for component to load active block
    await waitFor(() => {
      expect(loadActiveBlockMock).toHaveBeenCalled();
    });

    // Test pauseOrResume when paused
    await ref.current?.pauseOrResume();
    expect(resumeBlockMock).toHaveBeenCalled();
  });

  it('endDialog should open feedback dialog', async () => {
    const ref = React.createRef<TimeBlockWidgetHandle>();
    render(<TimeBlockWidget ref={ref} expanded={true} />);

    // Start a time block
    const textarea = await screen.findByTestId('timeblock-task-textarea');
    fireEvent.change(textarea, { target: { value: 'Test Task' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(startBlockMock).toHaveBeenCalled();
    });

    // Test endDialogtoHaveBeenCalled - should not call endBlock, just open dialog
    ref.current?.endDialog();
    // endBlock should NOT have been called yet
    expect(endBlockMock).not.toHaveBeenCalled();
  });

  it('getTimerState should return current timer state', async () => {
    const ref = React.createRef<TimeBlockWidgetHandle>();
    render(<TimeBlockWidget ref={ref} expanded={true} />);

    // Initial state should be idle
    expect(ref.current?.getTimerState()).toBe('idle');

    // Start a time block
    const textarea = await screen.findByTestId('timeblock-task-textarea');
    fireEvent.change(textarea, { target: { value: 'Test Task' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(startBlockMock).toHaveBeenCalled();
    });

    // After starting, state should be running
    expect(ref.current?.getTimerState()).toBe('running');
  });
});
