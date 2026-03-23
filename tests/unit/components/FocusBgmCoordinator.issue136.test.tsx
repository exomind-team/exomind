import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { ActiveBlockData } from '@/lib/types/event';

type MockFocusBgmPreferences = {
  enabled: boolean;
  sourceType: 'preset' | 'custom';
  presetId: 'white-noise' | 'pink-noise' | 'brown-noise';
  customTracks: { path: string; name: string }[];
  playbackMode: 'loop' | 'sequence';
  stopBehavior: 'timer-end' | 'manual-end';
  volume: number;
};

const loadActiveBlockMock = vi.hoisted(() => vi.fn());
const onBlockChangeMock = vi.hoisted(() => vi.fn());
const startFromPreferencesMock = vi.hoisted(() => vi.fn());
const syncRuntimePreferencesMock = vi.hoisted(() => vi.fn());
const pauseMock = vi.hoisted(() => vi.fn());
const resumeMock = vi.hoisted(() => vi.fn());
const stopMock = vi.hoisted(() => vi.fn());
const resolveCountdownOverrunMsMock = vi.hoisted(() => vi.fn(() => 0));

const bgmState = vi.hoisted(() => ({
  value: {
    enabled: true,
    sourceType: 'preset' as const,
    presetId: 'white-noise' as const,
    customTracks: [] as { path: string; name: string }[],
    playbackMode: 'loop' as const,
    stopBehavior: 'manual-end' as const,
    volume: 60,
  } satisfies MockFocusBgmPreferences,
  listeners: new Set<(value: MockFocusBgmPreferences) => void>(),
}));

vi.mock('@/lib/services', () => ({
  getTimeBlockService: () => ({
    loadActiveBlock: loadActiveBlockMock,
    onBlockChange: onBlockChangeMock,
  }),
}));

vi.mock('@/config/focus-bgm-preferences', () => ({
  getFocusBgmPreferences: vi.fn(() => bgmState.value),
  subscribeFocusBgmPreferencesChanges: vi.fn((listener: (value: MockFocusBgmPreferences) => void) => {
    bgmState.listeners.add(listener);
    return () => {
      bgmState.listeners.delete(listener);
    };
  }),
}));

vi.mock('@/lib/media/focus-bgm-player', () => ({
  getFocusBgmPlayer: () => ({
    getState: () => ({ status: 'idle', sourceType: null, trackLabel: null, currentIndex: -1, total: 0 }),
    startFromPreferences: startFromPreferencesMock,
    syncRuntimePreferences: syncRuntimePreferencesMock,
    pause: pauseMock,
    resume: resumeMock,
    stop: stopMock,
  }),
}));

vi.mock('@/lib/timeblock/countdown-overrun', () => ({
  resolveCountdownOverrunMs: resolveCountdownOverrunMsMock,
}));

import { FocusBgmCoordinator } from '@/ui/app/components/FocusBgmCoordinator';

function runningBlock(overrides: Partial<ActiveBlockData> = {}): ActiveBlockData {
  return {
    startId: 'block-1',
    name: '专注任务',
    mode: 'countdown',
    targetMinutes: 25,
    elapsed: 1000,
    startTime: 0,
    paused: false,
    phase: 'running',
    ...overrides,
  };
}

describe('issue-136 focus bgm coordinator（专注背景音全局协调器）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bgmState.value = {
      enabled: true,
      sourceType: 'preset',
      presetId: 'white-noise',
      customTracks: [],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 60,
    };
    bgmState.listeners.clear();
    loadActiveBlockMock.mockResolvedValue(null);
    onBlockChangeMock.mockImplementation(() => () => {});
    startFromPreferencesMock.mockResolvedValue(undefined);
    syncRuntimePreferencesMock.mockResolvedValue(undefined);
    pauseMock.mockResolvedValue(undefined);
    resumeMock.mockResolvedValue(undefined);
    stopMock.mockResolvedValue(undefined);
    resolveCountdownOverrunMsMock.mockReturnValue(0);
  });

  it('starts bgm for an active running block（存在运行中的专注块时自动开始播放）', async () => {
    loadActiveBlockMock.mockResolvedValue(runningBlock());

    render(<FocusBgmCoordinator />);

    await waitFor(() => expect(startFromPreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      presetId: 'white-noise',
    })));
  });

  it('pauses and resumes based on block state（随专注暂停与恢复同步暂停/恢复）', async () => {
    let listener: ((block: ActiveBlockData | null) => void) | null = null;
    onBlockChangeMock.mockImplementation((cb: (block: ActiveBlockData | null) => void) => {
      listener = cb;
      return () => {};
    });

    render(<FocusBgmCoordinator />);

    listener?.(runningBlock({ paused: true, phase: 'paused' }));
    await waitFor(() => expect(pauseMock).toHaveBeenCalledTimes(1));

    listener?.(runningBlock({ paused: false, phase: 'running' }));
    await waitFor(() => expect(startFromPreferencesMock).toHaveBeenCalledTimes(1));
  });

  it('stops when countdown overrun should end music（到达停止条件时停止播放）', async () => {
    let listener: ((block: ActiveBlockData | null) => void) | null = null;
    onBlockChangeMock.mockImplementation((cb: (block: ActiveBlockData | null) => void) => {
      listener = cb;
      return () => {};
    });
    bgmState.value = {
      ...bgmState.value,
      stopBehavior: 'timer-end',
    };
    resolveCountdownOverrunMsMock.mockReturnValue(3_000);

    render(<FocusBgmCoordinator />);

    listener?.(runningBlock());
    await waitFor(() => expect(stopMock).toHaveBeenCalledTimes(1));
  });

  it('pushes updated preferences into the active player（设置变更时应把新音量推给当前播放器）', async () => {
    loadActiveBlockMock.mockResolvedValue(runningBlock());

    render(<FocusBgmCoordinator />);

    await waitFor(() => expect(startFromPreferencesMock).toHaveBeenCalledTimes(1));

    bgmState.listeners.forEach((listener) => listener({
      ...bgmState.value,
      volume: 88,
    }));

    await waitFor(() => expect(syncRuntimePreferencesMock).toHaveBeenCalledWith(expect.objectContaining({
      volume: 88,
    })));
  });
});
