import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@/components/ui/toast-hook', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('TimeBlockWidget countdown end sound', () => {
  let now = 0;
  let rafCallback: FrameRequestCallback | null = null;

  const playMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    now = 0;
    rafCallback = null;

    vi.spyOn(Date, 'now').mockImplementation(() => now);

    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCallback = cb;
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    class MockAudio {
      url: string;
      loop = false;
      preload = '';
      currentTime = 0;

      constructor(url: string) {
        this.url = url;
      }

      play = playMock;
    }

    vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio);

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
    playMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('plays a sound once when countdown crosses zero (sound enabled)', async () => {
    const user = userEvent.setup();

    loadActiveBlockMock.mockResolvedValue(null);
    startBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: 'Meditation',
      startTime: 0,
      elapsed: 10,
      mode: 'countdown',
      paused: false,
    });

    render(<TimeBlockWidget expanded />);

    await user.type(screen.getByPlaceholderText('输入任务标题...'), 'Meditation');
    await user.click(screen.getByRole('button', { name: '开始' }));

    await waitFor(() => expect(requestAnimationFrame).toHaveBeenCalled());
    expect(rafCallback).not.toBeNull();

    now = 100;
    await act(async () => {
      rafCallback?.(0);
    });

    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));
  });

  it('does not play a sound when sound is disabled', async () => {
    const user = userEvent.setup();

    loadActiveBlockMock.mockResolvedValue(null);
    startBlockMock.mockResolvedValue({
      startId: 'block-2',
      name: 'Meditation',
      startTime: 0,
      elapsed: 10,
      mode: 'countdown',
      paused: false,
    });

    render(<TimeBlockWidget expanded />);

    await user.click(screen.getByRole('switch', { name: '提示音' }));
    await user.type(screen.getByPlaceholderText('输入任务标题...'), 'Meditation');
    await user.click(screen.getByRole('button', { name: '开始' }));

    await waitFor(() => expect(requestAnimationFrame).toHaveBeenCalled());
    expect(rafCallback).not.toBeNull();

    now = 100;
    await act(async () => {
      rafCallback?.(0);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(playMock).toHaveBeenCalledTimes(0);
  });

  it('continues counting overtime when soft end is enabled', async () => {
    const user = userEvent.setup();

    loadActiveBlockMock.mockResolvedValue(null);
    startBlockMock.mockResolvedValue({
      startId: 'block-3',
      name: 'Meditation',
      startTime: 0,
      elapsed: 10,
      mode: 'countdown',
      paused: false,
    });

    render(<TimeBlockWidget expanded />);

    await user.type(screen.getByPlaceholderText('输入任务标题...'), 'Meditation');
    await user.click(screen.getByRole('button', { name: '开始' }));

    await waitFor(() => expect(requestAnimationFrame).toHaveBeenCalled());
    expect(rafCallback).not.toBeNull();

    now = 100;
    await act(async () => {
      rafCallback?.(0);
    });

    await waitFor(() => expect(screen.getByText('+0:00')).toBeVisible());
    await waitFor(() => expect(screen.getByRole('button', { name: '暂停' })).toBeVisible());

    now = 2100;
    await act(async () => {
      rafCallback?.(0);
    });

    await waitFor(() => expect(screen.getByText('+0:02')).toBeVisible());
  });
});
