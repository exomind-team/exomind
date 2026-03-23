import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { TimeBlockWidget } from '@/components/TimeBlockWidget';

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

describe('TimeBlockWidget new-mobile layout', () => {
  beforeEach(() => {
    loadActiveBlockMock.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders collapse toggle as separated control in new-mobile variant', async () => {
    render(<TimeBlockWidget variant="new-mobile" />);

    const mainRow = await screen.findByTestId('timeblock-main-row');
    const collapseToggle = screen.getByTestId('timeblock-collapse-toggle');

    expect(collapseToggle).toBeInTheDocument();
    expect(within(mainRow).queryByTestId('timeblock-collapse-toggle')).toBeNull();
  });
});
