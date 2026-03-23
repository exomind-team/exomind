import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusTimerWidget } from '@/ui/app/components/FocusTimerWidget';

const loadActiveBlockMock = vi.hoisted(() => vi.fn());
const onBlockChangeMock = vi.hoisted(() => vi.fn(() => () => {}));
const pickFocusBgmTracksMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: loadActiveBlockMock,
    startBlock: vi.fn(),
    pauseBlock: vi.fn(),
    resumeBlock: vi.fn(),
    endBlock: vi.fn(),
    markEnding: vi.fn(),
    updateElapsed: vi.fn(),
    onBlockChange: onBlockChangeMock,
    startSync: vi.fn(),
    stopSync: vi.fn(),
  }),
  getTaskService: () => ({
    getTask: vi.fn().mockResolvedValue(null),
  }),
  getTaskTimerService: () => ({
    startBlockForTask: vi.fn(),
  }),
}));

vi.mock('@/config/timer-preferences', () => ({
  getTimerPreferences: () => ({
    countdownEndMode: 'soft',
    countdownEndSoundEnabled: false,
    countdownEndSoundPresetId: 'dang',
  }),
  subscribeTimerPreferencesChanges: () => () => {},
}));

vi.mock('@/config/focus-bgm-preferences', () => ({
  getFocusBgmPreferences: () => ({
    enabled: true,
    sourceType: 'preset',
    presetId: 'white-noise',
    customTracks: [],
    playbackMode: 'loop',
    stopBehavior: 'manual-end',
    volume: 60,
  }),
  subscribeFocusBgmPreferencesChanges: () => () => {},
  updateFocusBgmPreferences: vi.fn((patch: Record<string, unknown>) => patch),
}));

vi.mock('@/lib/media/focus-bgm-file-picker', () => ({
  pickFocusBgmTracks: pickFocusBgmTracksMock,
}));

describe('issue-136 FocusTimerWidget bgm control（专注计时器背景音快捷控制）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pickFocusBgmTracksMock.mockResolvedValue([]);
    loadActiveBlockMock.mockResolvedValue({
      startId: 'block-1',
      name: '专注任务',
      startTime: 0,
      elapsed: 10_000,
      mode: 'countdown',
      paused: false,
      targetMinutes: 25,
      phase: 'running',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('opens bgm settings dialog while running（运行态背景音按钮可打开设置弹窗）', async () => {
    render(<FocusTimerWidget />);

    await waitFor(() => expect(screen.getByTestId('new-focus-state-running')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('new-focus-bgm-toggle-button'));

    expect(screen.getByText('专注背景音')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开启背景音' })).toBeInTheDocument();
  });
});
