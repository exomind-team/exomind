import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUpdateStore } from '@/ui/stores/update-store';
import type { UpdateInfo } from '@/lib/services/update.service';

const { mockAutoCheckStart, mockAutoCheckStop } = vi.hoisted(() => ({
  mockAutoCheckStart: vi.fn(),
  mockAutoCheckStop: vi.fn(),
}));

// Mock update.service
vi.mock('@/lib/services/update.service', () => ({
  checkForUpdate: vi.fn(),
  getCurrentVersion: vi.fn().mockResolvedValue('0.1.0'),
  getPlatform: vi.fn().mockReturnValue('windows-x64'),
  createAutoCheckController: vi.fn(() => ({
    start: mockAutoCheckStart,
    stop: mockAutoCheckStop,
  })),
}));

describe('update-store', () => {
  beforeEach(() => {
    // Reset store to initial state
    useUpdateStore.setState({
      channel: 'release',
      checkInterval: 'daily',
      autoDownloadPreview: false,
      updateAvailable: null,
      lastCheckTime: null,
      isChecking: false,
      downloadProgress: null,
      toastDismissed: false,
      error: null,
    });
  });

  describe('initial state', () => {
    it('has correct default values', () => {
      const state = useUpdateStore.getState();

      expect(state.channel).toBe('release');
      expect(state.checkInterval).toBe('daily');
      expect(state.autoDownloadPreview).toBe(false);
      expect(state.updateAvailable).toBeNull();
      expect(state.toastDismissed).toBe(false);
      expect(state.isChecking).toBe(false);
      expect(state.lastCheckTime).toBeNull();
      expect(state.downloadProgress).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe('setChannel', () => {
    it('updates channel to preview', () => {
      useUpdateStore.getState().setChannel('preview');
      expect(useUpdateStore.getState().channel).toBe('preview');
    });

    it('updates channel to release', () => {
      useUpdateStore.setState({ channel: 'preview' });
      useUpdateStore.getState().setChannel('release');
      expect(useUpdateStore.getState().channel).toBe('release');
    });
  });

  describe('setCheckInterval', () => {
    it('updates interval to hourly', () => {
      useUpdateStore.getState().setCheckInterval('hourly');
      expect(useUpdateStore.getState().checkInterval).toBe('hourly');
    });

    it('updates interval to manual', () => {
      useUpdateStore.getState().setCheckInterval('manual');
      expect(useUpdateStore.getState().checkInterval).toBe('manual');
    });

    it('updates interval to daily', () => {
      useUpdateStore.setState({ checkInterval: 'hourly' });
      useUpdateStore.getState().setCheckInterval('daily');
      expect(useUpdateStore.getState().checkInterval).toBe('daily');
    });
  });

  describe('setAutoDownloadPreview', () => {
    it('enables auto download preview', () => {
      useUpdateStore.getState().setAutoDownloadPreview(true);
      expect(useUpdateStore.getState().autoDownloadPreview).toBe(true);
    });

    it('disables auto download preview', () => {
      useUpdateStore.setState({ autoDownloadPreview: true });
      useUpdateStore.getState().setAutoDownloadPreview(false);
      expect(useUpdateStore.getState().autoDownloadPreview).toBe(false);
    });
  });

  describe('dismissToast', () => {
    it('sets toastDismissed to true', () => {
      useUpdateStore.getState().dismissToast();
      expect(useUpdateStore.getState().toastDismissed).toBe(true);
    });

    it('remains true when called multiple times', () => {
      useUpdateStore.getState().dismissToast();
      useUpdateStore.getState().dismissToast();
      expect(useUpdateStore.getState().toastDismissed).toBe(true);
    });
  });

  describe('setUpdateAvailable', () => {
    const mockUpdateInfo: UpdateInfo = {
      hasUpdate: true,
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      downloadUrl: 'https://example.com/download',
      size: 52428800,
      sha256: 'abc123',
      publishedAt: '2026-02-27T00:00:00Z',
    };

    it('sets update info', () => {
      useUpdateStore.getState().setUpdateAvailable(mockUpdateInfo);

      const state = useUpdateStore.getState();
      expect(state.updateAvailable).toEqual(mockUpdateInfo);
    });

    it('resets toastDismissed when new update is set', () => {
      useUpdateStore.setState({ toastDismissed: true });
      useUpdateStore.getState().setUpdateAvailable(mockUpdateInfo);

      expect(useUpdateStore.getState().toastDismissed).toBe(false);
    });

    it('can clear update info with null', () => {
      useUpdateStore.setState({ updateAvailable: mockUpdateInfo });
      useUpdateStore.getState().setUpdateAvailable(null);

      expect(useUpdateStore.getState().updateAvailable).toBeNull();
    });
  });

  describe('setIsChecking', () => {
    it('sets isChecking to true', () => {
      useUpdateStore.getState().setIsChecking(true);
      expect(useUpdateStore.getState().isChecking).toBe(true);
    });

    it('sets isChecking to false', () => {
      useUpdateStore.setState({ isChecking: true });
      useUpdateStore.getState().setIsChecking(false);
      expect(useUpdateStore.getState().isChecking).toBe(false);
    });
  });

  describe('setLastCheckTime', () => {
    it('sets last check time', () => {
      const now = Date.now();
      useUpdateStore.getState().setLastCheckTime(now);
      expect(useUpdateStore.getState().lastCheckTime).toBe(now);
    });
  });
});
