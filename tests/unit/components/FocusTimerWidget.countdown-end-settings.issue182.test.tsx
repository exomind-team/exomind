import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusTimerWidget } from '@/ui/app/components/FocusTimerWidget';

const TIMER_PREFERENCES_STORAGE_KEY = 'exomind:timerPreferences';

function clearLocalStorageSafely() {
  const storage = window.localStorage as Partial<Storage>;
  if (typeof storage.clear === 'function') {
    storage.clear();
    return;
  }
  if (typeof storage.removeItem !== 'function' || typeof storage.key !== 'function') {
    return;
  }
  const keys: string[] = [];
  const length = typeof storage.length === 'number' ? storage.length : 0;
  for (let index = 0; index < length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem?.(key));
}

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

describe('FocusTimerWidget countdown end behavior（新计时器结束分支）', () => {
  let now = 0;
  let rafCallbacks: FrameRequestCallback[] = [];
  const playMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    now = 0;
    rafCallbacks = [];
    vi.clearAllMocks();
    clearLocalStorageSafely();

    vi.spyOn(Date, 'now').mockImplementation(() => now);

    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
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

    loadActiveBlockMock.mockResolvedValue(null);
    startBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: '专注任务',
      startTime: 0,
      elapsed: 10,
      mode: 'countdown',
      paused: false,
      targetMinutes: 25,
    });
    pauseBlockMock.mockResolvedValue(undefined);
    resumeBlockMock.mockResolvedValue(undefined);
    endBlockMock.mockResolvedValue(null);
    markEndingMock.mockResolvedValue(undefined);
    updateElapsedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('hard end mode opens feedback dialog automatically（硬结束自动进入反馈）', async () => {
    window.localStorage.setItem(
      TIMER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        countdownEndMode: 'hard',
        countdownEndSoundEnabled: true,
        countdownEndSoundPresetId: 'dang',
      }),
    );

    render(<FocusTimerWidget />);
    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), { target: { value: '硬结束任务' } });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => expect(requestAnimationFrame).toHaveBeenCalled());
    expect(rafCallbacks.length).toBeGreaterThan(0);

    now = 100;
    await act(async () => {
      const callbacks = rafCallbacks.splice(0);
      callbacks.forEach((callback) => callback(0));
    });

    await waitFor(() => expect(markEndingMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('new-focus-feedback-textarea')).toBeInTheDocument());
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('soft end mode continues overtime and keeps running（软结束继续超时计时）', async () => {
    window.localStorage.setItem(
      TIMER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        countdownEndMode: 'soft',
        countdownEndSoundEnabled: true,
        countdownEndSoundPresetId: 'dang',
      }),
    );

    render(<FocusTimerWidget />);
    fireEvent.click(screen.getByTestId('new-focus-idle-card'));
    fireEvent.change(screen.getByTestId('new-focus-task-input'), { target: { value: '软结束任务' } });
    fireEvent.click(screen.getByTestId('new-focus-start-button'));

    await waitFor(() => expect(requestAnimationFrame).toHaveBeenCalled());
    expect(rafCallbacks.length).toBeGreaterThan(0);

    now = 100;
    await act(async () => {
      const callbacks = rafCallbacks.splice(0);
      callbacks.forEach((callback) => callback(0));
    });

    await waitFor(() =>
      expect(screen.getByTestId('new-focus-running-clock').textContent).toContain('+'),
    );
    expect(screen.getByTestId('new-focus-running-clock').className).toContain('text-[#C75B3A]');
    expect(markEndingMock).not.toHaveBeenCalled();
    expect(playMock).toHaveBeenCalledTimes(1);
  });

});
