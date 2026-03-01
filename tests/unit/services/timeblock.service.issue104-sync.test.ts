import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  syncToRemoteMock,
  stopSyncMock,
  loadActiveBlockMock,
  saveActiveBlockMock,
  deleteActiveBlockMock,
  getEventStorageMock,
} = vi.hoisted(() => ({
  syncToRemoteMock: vi.fn(),
  stopSyncMock: vi.fn(),
  loadActiveBlockMock: vi.fn(),
  saveActiveBlockMock: vi.fn(),
  deleteActiveBlockMock: vi.fn(),
  getEventStorageMock: vi.fn(() => ({ addEvent: vi.fn() })),
}));

let listener: ((block: unknown) => void) | null = null;

vi.mock('@/lib/storage/active-block-storage', () => ({
  getActiveBlockStorage: vi.fn(() => ({
    loadActiveBlock: loadActiveBlockMock,
    saveActiveBlock: saveActiveBlockMock,
    deleteActiveBlock: deleteActiveBlockMock,
    syncToRemote: syncToRemoteMock,
    stopSync: stopSyncMock,
    onBlockChange: (callback: (block: unknown) => void) => {
      listener = callback;
      return () => {
        if (listener === callback) {
          listener = null;
        }
      };
    },
  })),
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getEventStorage: getEventStorageMock,
}));

vi.mock('@/config/feedback-preferences', () => ({
  getFeedbackPreferences: vi.fn(() => ({
    timingInfoEnabled: true,
    statisticsEnabled: true,
    quickFeedbackEnabled: true,
  })),
}));

import { TimeBlockServiceImpl } from '@/lib/services/timeblock.service';

describe('Issue #104 TimeBlockService sync lifecycle', () => {
  beforeEach(() => {
    syncToRemoteMock.mockReset();
    stopSyncMock.mockReset();
    loadActiveBlockMock.mockReset();
    saveActiveBlockMock.mockReset();
    deleteActiveBlockMock.mockReset();
    getEventStorageMock.mockClear();
    listener = null;
  });

  it('starts and stops storage sync by service API', async () => {
    const service = new TimeBlockServiceImpl();
    const remoteUrl = 'http://127.0.0.1:6984/test-user';

    await service.startSync(remoteUrl);
    await service.stopSync();

    expect(syncToRemoteMock).toHaveBeenCalledWith(remoteUrl);
    expect(stopSyncMock).toHaveBeenCalled();
  });

  it('forwards remote block changes to onBlockChange subscribers', async () => {
    const service = new TimeBlockServiceImpl();
    const onChange = vi.fn();
    const unsubscribe = service.onBlockChange(onChange);

    await service.startSync('http://127.0.0.1:6984/test-user');
    expect(listener).toBeTypeOf('function');

    const remoteBlock = {
      startId: 'remote-1',
      name: 'from remote',
      startTime: Date.now(),
      mode: 'countup',
      elapsed: 321,
      paused: false,
      updatedAt: Date.now(),
      pauseAccumulatedMs: 0,
    };

    listener?.(remoteBlock);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ startId: 'remote-1' }));

    unsubscribe();
  });
});
