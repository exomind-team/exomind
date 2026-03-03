import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getActiveBlockStorageMock,
  getCurrentSyncUserIdMock,
  syncToRemoteMock,
  stopSyncMock,
  loadActiveBlockMock,
  saveActiveBlockMock,
  deleteActiveBlockMock,
  getEventStorageMock,
} = vi.hoisted(() => ({
  getActiveBlockStorageMock: vi.fn(),
  getCurrentSyncUserIdMock: vi.fn(() => 'local-user'),
  syncToRemoteMock: vi.fn(),
  stopSyncMock: vi.fn(),
  loadActiveBlockMock: vi.fn(),
  saveActiveBlockMock: vi.fn(),
  deleteActiveBlockMock: vi.fn(),
  getEventStorageMock: vi.fn(() => ({ addEvent: vi.fn() })),
}));

let listener: ((block: unknown, source: 'local' | 'sync') => void) | null = null;
let storageForUser: Record<string, {
  loadActiveBlock: typeof loadActiveBlockMock;
  saveActiveBlock: typeof saveActiveBlockMock;
  deleteActiveBlock: typeof deleteActiveBlockMock;
  syncToRemote: typeof syncToRemoteMock;
  stopSync: typeof stopSyncMock;
  onBlockChange: (callback: (block: unknown, source: 'local' | 'sync') => void) => () => void;
}> = {};

vi.mock('@/lib/storage/active-block-storage', () => ({
  getActiveBlockStorage: getActiveBlockStorageMock,
  getCurrentSyncUserId: getCurrentSyncUserIdMock,
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
    storageForUser = {};
    getActiveBlockStorageMock.mockReset();
    getCurrentSyncUserIdMock.mockReset();
    getCurrentSyncUserIdMock.mockReturnValue('local-user');

    getActiveBlockStorageMock.mockImplementation((userId?: string) => {
      const id = userId ?? getCurrentSyncUserIdMock();
      if (!storageForUser[id]) {
        storageForUser[id] = {
          loadActiveBlock: loadActiveBlockMock,
          saveActiveBlock: saveActiveBlockMock,
          deleteActiveBlock: deleteActiveBlockMock,
          syncToRemote: syncToRemoteMock,
          stopSync: stopSyncMock,
          onBlockChange: (callback: (block: unknown, source: 'local' | 'sync') => void) => {
            listener = callback;
            return () => {
              if (listener === callback) {
                listener = null;
              }
            };
          },
        };
      }
      return storageForUser[id];
    });

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

  it('switches active storage when remote user changes', async () => {
    const service = new TimeBlockServiceImpl();

    await service.startSync('http://127.0.0.1:6984/user-a');
    await service.startSync('http://127.0.0.1:6984/user-b');

    expect(getActiveBlockStorageMock).toHaveBeenCalledWith('local-user');
    expect(getActiveBlockStorageMock).toHaveBeenCalledWith('user-a');
    expect(getActiveBlockStorageMock).toHaveBeenCalledWith('user-b');
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

    listener?.(remoteBlock, 'sync');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ startId: 'remote-1' }));

    unsubscribe();
  });

  it('ignores local storage writes to avoid self-overwrite loops', async () => {
    const service = new TimeBlockServiceImpl();
    const onChange = vi.fn();
    const unsubscribe = service.onBlockChange(onChange);

    await service.startSync('http://127.0.0.1:6984/test-user');
    expect(listener).toBeTypeOf('function');

    listener?.({
      startId: 'local-echo',
      name: 'from local',
      startTime: Date.now(),
      mode: 'countup',
      elapsed: 10,
      paused: false,
      updatedAt: Date.now(),
      pauseAccumulatedMs: 0,
    }, 'local');

    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notifies UI subscribers even when remote block requires normalization write-back', async () => {
    const service = new TimeBlockServiceImpl();
    const onChange = vi.fn();
    const unsubscribe = service.onBlockChange(onChange);

    await service.startSync('http://127.0.0.1:6984/test-user');
    expect(listener).toBeTypeOf('function');

    const remoteBlock = {
      startId: 'remote-old-timestamp',
      name: 'normalized from remote',
      startTime: Date.now() - 30_000,
      mode: 'countup',
      elapsed: 1_000,
      paused: false,
      updatedAt: Date.now() - 5_000,
      pauseAccumulatedMs: 0,
    };

    listener?.(remoteBlock, 'sync');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ startId: 'remote-old-timestamp' })
    );
    expect(saveActiveBlockMock).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('rejects stale running sync updates after feedback is already submitted', async () => {
    const service = new TimeBlockServiceImpl();
    const onChange = vi.fn();
    const unsubscribe = service.onBlockChange(onChange);

    await service.startSync('http://127.0.0.1:6984/test-user');
    expect(listener).toBeTypeOf('function');

    const base = Date.now();
    listener?.({
      startId: 'same-start',
      name: 'terminal',
      startTime: base - 60_000,
      mode: 'countup',
      elapsed: 30_000,
      paused: false,
      actionEndedAt: base - 10_000,
      feedbackStartedAt: base - 9_000,
      feedbackSubmittedAt: base - 1_000,
      updatedAt: base - 1_000,
      pauseAccumulatedMs: 0,
    }, 'sync');

    listener?.({
      startId: 'same-start',
      name: 'stale-running',
      startTime: base - 60_000,
      mode: 'countup',
      elapsed: 5_000,
      paused: false,
      updatedAt: base - 20_000,
      pauseAccumulatedMs: 0,
    }, 'sync');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(saveActiveBlockMock).toHaveBeenCalledWith(expect.objectContaining({
      startId: 'same-start',
      feedbackSubmittedAt: expect.any(Number),
    }));

    unsubscribe();
  });

  it('writes back canonical local block when stale sync packet has older startId', async () => {
    const service = new TimeBlockServiceImpl();
    const base = Date.now();

    const localBaseline = {
      startId: 'local-newer',
      name: 'local newer block',
      startTime: base - 10_000,
      mode: 'countup',
      elapsed: 8_000,
      paused: false,
      version: 3,
      actorId: 'actor-local',
      lastTransitionAt: base - 2_000,
      lastResumedAt: base - 2_000,
      accumulatedRunMs: 8_000,
      pauseAccumulatedMs: 0,
      updatedAt: base - 2_000,
    };

    loadActiveBlockMock.mockResolvedValue(localBaseline);
    await service.startSync('http://127.0.0.1:6984/test-user');
    saveActiveBlockMock.mockClear();

    listener?.({
      startId: 'remote-older',
      name: 'remote stale block',
      startTime: base - 60_000,
      mode: 'countup',
      elapsed: 5_000,
      paused: false,
      version: 1,
      actorId: 'actor-remote',
      lastTransitionAt: base - 30_000,
      lastResumedAt: base - 30_000,
      accumulatedRunMs: 5_000,
      pauseAccumulatedMs: 0,
      updatedAt: base - 30_000,
    }, 'sync');

    await vi.waitFor(() => {
      expect(saveActiveBlockMock).toHaveBeenCalledWith(
        expect.objectContaining({ startId: 'local-newer' })
      );
    });
  });
});
