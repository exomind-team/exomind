import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../components/settings/setup-settings-mocks';

type MockFocusBgmPreferences = {
  enabled: boolean;
  sourceType: 'preset' | 'custom';
  presetId: 'white-noise' | 'pink-noise' | 'brown-noise';
  customTracks: { path: string; name: string }[];
  playbackMode: 'loop' | 'sequence';
  stopBehavior: 'timer-end' | 'manual-end';
  volume: number;
};

const bgmState = vi.hoisted(() => ({
  value: {
    enabled: false,
    sourceType: 'preset' as const,
    presetId: 'white-noise' as const,
    customTracks: [] as { path: string; name: string }[],
    playbackMode: 'loop' as const,
    stopBehavior: 'manual-end' as const,
    volume: 60,
  } satisfies MockFocusBgmPreferences,
  listeners: new Set<(value: MockFocusBgmPreferences) => void>(),
}));

vi.mock('@/config/focus-bgm-preferences', () => ({
  getFocusBgmPreferences: vi.fn(() => bgmState.value),
  updateFocusBgmPreferences: vi.fn((patch: Partial<MockFocusBgmPreferences>) => {
    bgmState.value = {
      ...bgmState.value,
      ...patch,
    };
    bgmState.listeners.forEach((listener) => listener(bgmState.value));
    return bgmState.value;
  }),
  subscribeFocusBgmPreferencesChanges: vi.fn((listener: (value: MockFocusBgmPreferences) => void) => {
    bgmState.listeners.add(listener);
    return () => {
      bgmState.listeners.delete(listener);
    };
  }),
}));

import { pickFocusBgmTracks } from '@/lib/media/focus-bgm-file-picker';
import { SettingsPage } from '@/ui/app/pages/SettingsPage';

describe('issue-136 focus bgm setting（专注背景音设置项）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bgmState.value = {
      enabled: false,
      sourceType: 'preset',
      presetId: 'white-noise',
      customTracks: [],
      playbackMode: 'loop',
      stopBehavior: 'manual-end',
      volume: 60,
    };
    bgmState.listeners.clear();
    vi.mocked(pickFocusBgmTracks).mockResolvedValue([
      { path: 'D:/music/rain.mp3', name: 'rain.mp3' },
      { path: 'D:/music/cafe.mp3', name: 'cafe.mp3' },
    ]);
  });

  it('renders focus bgm row in timer settings（在计时设置中显示专注背景音入口）', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '专注设置' }));

    expect(screen.getByRole('button', { name: '专注背景音 已关闭' })).toBeInTheDocument();
  });

  it('can switch to local tracks and sequence mode（可切换到本地多音频顺序播放）', async () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '专注设置' }));

    fireEvent.click(screen.getByRole('button', { name: '专注背景音 已关闭' }));

    fireEvent.click(screen.getByRole('button', { name: '开启背景音' }));
    fireEvent.click(screen.getByRole('button', { name: '本地音频' }));
    fireEvent.click(screen.getByRole('button', { name: '选择本地音频' }));

    await waitFor(() => expect(pickFocusBgmTracks).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '顺序播放' }));

    await waitFor(() => {
      expect(screen.getByText('rain.mp3')).toBeInTheDocument();
      expect(screen.getByText('cafe.mp3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '顺序播放' }).className).toContain('border-[#C75B3A]');
    });
  });

  it('uses dark-mode friendly surfaces in the bgm panel（暗色模式下不应保留亮白面板块）', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: '专注设置' }));
    fireEvent.click(screen.getByRole('button', { name: '专注背景音 已关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '本地音频' }));

    const enableButton = screen.getByRole('button', { name: '开启背景音' });
    const localTracksPanel = screen.getByText('当前未选择本地音频').closest('div');

    expect(enableButton.className).toContain('dark:bg-');
    expect(enableButton.className).toContain('dark:text-');
    expect(enableButton.className).toContain('dark:border-');
    expect(localTracksPanel?.className ?? '').toContain('dark:bg-');
    expect(localTracksPanel?.className ?? '').toContain('dark:border-');
    expect(localTracksPanel?.className ?? '').toContain('dark:text-');
  });
});
