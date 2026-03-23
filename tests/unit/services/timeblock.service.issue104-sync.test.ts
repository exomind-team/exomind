import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getActiveBlockStorageMock,
  getCurrentSyncUserIdMock,
  getTimeblockBackendModeMock,
  syncToRemoteMock,
  stopSyncMock,
  loadActiveBlockMock,
  saveActiveBlockMock,
  deleteActiveBlockMock,
  getEventStorageMock,
  rtListCompletedBlocksMock,
  rtReplaceCompletedBlocksMock,
  rtGetActiveBlockMock,
  rtPutActiveBlockMock,
  rtDeleteActiveBlockMock,
  publishActiveBlockReplicationSnapshotMock,
  appendEventWithEcsReplicationMock,
} = vi.hoisted(() => ({
  getActiveBlockStorageMock: vi.fn(),
  getCurrentSyncUserIdMock: vi.fn(() => 'local-user'),
  getTimeblockBackendModeMock: vi.fn(() => 'legacy'),
  syncToRemoteMock: vi.fn(),
  stopSyncMock: vi.fn(),
  loadActiveBlockMock: vi.fn(),
  saveActiveBlockMock: vi.fn(),
  deleteActiveBlockMock: vi.fn(),
  getEventStorageMock: vi.fn(() => ({ addEvent: vi.fn() })),
  rtListCompletedBlocksMock: vi.fn(async () => []),
  rtReplaceCompletedBlocksMock: vi.fn(async () => undefined),
  rtGetActiveBlockMock: vi.fn(async () => null),
  rtPutActiveBlockMock: vi.fn(async () => undefined),
  rtDeleteActiveBlockMock: vi.fn(async () => undefined),
  publishActiveBlockReplicationSnapshotMock: vi.fn(),
  appendEventWithEcsReplicationMock: vi.fn(async (event) => event),
}));

let listener: ((block: unknown, source: 'local' | 'sync') => void) | null = null;
let storageForUser: Record<string, {
  loadActiveBlock: typeof loadActiveBlockMock;
  saveActiveBlock: typeof saveActiveBlockMock;
  deleteActiveBlock: typeof deleteActiveBlockMock;
  syncToRemote: (remoteUrl: string) => Promise<void> | void;
  stopSync: () => Promise<void> | void;
  listeners: Set<(block: unknown, source: 'local' | 'sync') => void>;
  onBlockChange: (callback: (block: unknown, source: 'local' | 'sync') => void) => () => void;
}> = {};

function emitStorageChange(userId: string, block: unknown, source: 'local' | 'sync'): void {
  const storage = storageForUser[userId];
  if (!storage) {
    return;
  }
  for (const callback of Array.from(storage.listeners)) {
    callback(block, source);
  }
}

vi.mock('@/lib/storage/active-block-storage', () => ({
  getActiveBlockStorage: getActiveBlockStorageMock,
  getCurrentSyncUserId: getCurrentSyncUserIdMock,
}));

vi.mock('@/lib/storage/event-storage', () => ({
  getEventStorage: getEventStorageMock,
}));

vi.mock('@/config/domain-backend-mode', () => ({
  getTimeblockBackendMode: getTimeblockBackendModeMock,
}));

vi.mock('@/lib/adapters/timeblock-rt-adapter', () => ({
  TimeBlockRtAdapter: class MockTimeBlockRtAdapter {
    listCompletedBlocks = rtListCompletedBlocksMock;
    replaceCompletedBlocks = rtReplaceCompletedBlocksMock;
    getActiveBlock = rtGetActiveBlockMock;
    putActiveBlock = rtPutActiveBlockMock;
    deleteActiveBlock = rtDeleteActiveBlockMock;
  },
}));

vi.mock('@/lib/services/ecs-active-block-replication.service', () => ({
  publishActiveBlockReplicationSnapshot: publishActiveBlockReplicationSnapshotMock,
}));

vi.mock('@/lib/services/ecs-eventlog-replication.service', () => ({
  appendEventWithEcsReplication: appendEventWithEcsReplicationMock,
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
    getTimeblockBackendModeMock.mockReset();
    getTimeblockBackendModeMock.mockReturnValue('legacy');

    getActiveBlockStorageMock.mockImplementation((userId?: string) => {
      const id = userId ?? getCurrentSyncUserIdMock();
      if (!storageForUser[id]) {
        storageForUser[id] = {
          loadActiveBlock: loadActiveBlockMock,
          saveActiveBlock: saveActiveBlockMock,
          deleteActiveBlock: deleteActiveBlockMock,
          syncToRemote: (remoteUrl: string) => syncToRemoteMock(id, remoteUrl),
          stopSync: () => stopSyncMock(id),
          listeners: new Set(),
          onBlockChange: (callback: (block: unknown, source: 'local' | 'sync') => void) => {
            storageForUser[id].listeners.add(callback);
            return () => {
              storageForUser[id].listeners.delete(callback);
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
    rtListCompletedBlocksMock.mockReset();
    rtListCompletedBlocksMock.mockResolvedValue([]);
    rtReplaceCompletedBlocksMock.mockReset();
    rtReplaceCompletedBlocksMock.mockResolvedValue(undefined);
    rtGetActiveBlockMock.mockReset();
    rtGetActiveBlockMock.mockResolvedValue(null);
    rtPutActiveBlockMock.mockReset();
    rtPutActiveBlockMock.mockResolvedValue(undefined);
    rtDeleteActiveBlockMock.mockReset();
    rtDeleteActiveBlockMock.mockResolvedValue(undefined);
    publishActiveBlockReplicationSnapshotMock.mockReset();
    appendEventWithEcsReplicationMock.mockClear();
  });

  it('falls back to legacy storage outside tauri even when preference is rt-sqlite', async () => {
    getTimeblockBackendModeMock.mockReturnValue('rt-sqlite');
    loadActiveBlockMock.mockResolvedValueOnce(null);
    const service = new TimeBlockServiceImpl();

    await service.loadActiveBlock();

    expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
    expect(rtGetActiveBlockMock).not.toHaveBeenCalled();
  });

  it('starts and stops ECS sync mode without calling storage syncToRemote', async () => {
    const service = new TimeBlockServiceImpl();

    await service.startSync();
    await service.stopSync();

    expect(syncToRemoteMock).not.toHaveBeenCalled();
  });

  it('rolls back subscriber count when ECS seed fails so retry can re-attempt', async () => {
    const service = new TimeBlockServiceImpl();

    loadActiveBlockMock
      .mockRejectedValueOnce(new Error('sync failed once'))
      .mockResolvedValueOnce(null);

    await expect(service.startSync()).rejects.toThrow('sync failed once');
    await service.startSync();
    const stopSyncCallsBeforeStop = stopSyncMock.mock.calls.length;
    await service.stopSync();

    expect(loadActiveBlockMock).toHaveBeenCalledTimes(2);
    expect(stopSyncMock.mock.calls.length).toBe(stopSyncCallsBeforeStop + 1);
  });

  it('switches active storage when remote user changes', async () => {
    const service = new TimeBlockServiceImpl();

    await service.startSync('http://127.0.0.1:6984/user-a');
    await service.startSync('http://127.0.0.1:6984/user-b');

    expect(getActiveBlockStorageMock).toHaveBeenCalledWith('local-user');
    expect(getActiveBlockStorageMock).toHaveBeenCalledWith('user-a');
    expect(getActiveBlockStorageMock).toHaveBeenCalledWith('user-b');
  });

  it('serializes old stopSync before seeding next user storage to avoid dual-channel window', async () => {
    const service = new TimeBlockServiceImpl();
    const userAUrl = 'http://127.0.0.1:6984/user-a';
    const userBUrl = 'http://127.0.0.1:6984/user-b';
    let releaseUserAStop: (() => void) | null = null;

    stopSyncMock.mockImplementation((userId: string) => {
      if (userId !== 'user-a') {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        releaseUserAStop = resolve;
      });
    });

    await service.startSync(userAUrl);
    loadActiveBlockMock.mockClear();

    const switchPromise = service.startSync(userBUrl);
    await vi.waitFor(() => {
      expect(stopSyncMock).toHaveBeenCalledWith('user-a');
    });
    expect(loadActiveBlockMock).not.toHaveBeenCalled();

    releaseUserAStop?.();
    await switchPromise;
    expect(loadActiveBlockMock).toHaveBeenCalledTimes(1);
  });

  it('notifies current snapshot when switching sync user to prevent stale UI state', async () => {
    const service = new TimeBlockServiceImpl();
    const onChange = vi.fn();
    const unsubscribe = service.onBlockChange(onChange);
    const base = Date.now();

    loadActiveBlockMock
      .mockResolvedValueOnce({
        startId: 'user-a-block',
        name: 'user-a running',
        startTime: base - 8_000,
        mode: 'countup',
        elapsed: 6_000,
        paused: false,
        updatedAt: base - 2_000,
        pauseAccumulatedMs: 0,
      })
      .mockResolvedValueOnce(null);

    await service.startSync('http://127.0.0.1:6984/user-a');
    await service.startSync('http://127.0.0.1:6984/user-b');

    expect(onChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ startId: 'user-a-block' })
    );
    expect(onChange).toHaveBeenNthCalledWith(2, null);

    unsubscribe();
  });

  it('forwards remote block changes to onBlockChange subscribers', async () => {
    const service = new TimeBlockServiceImpl();
    const onChange = vi.fn();
    const unsubscribe = service.onBlockChange(onChange);

    await service.startSync('http://127.0.0.1:6984/test-user');
    expect(storageForUser['test-user'].listeners.size).toBeGreaterThan(0);
    onChange.mockClear();

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

    emitStorageChange('test-user', remoteBlock, 'sync');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ startId: 'remote-1' }));

    unsubscribe();
  });

  it('ignores local storage writes to avoid self-overwrite loops', async () => {
    const service = new TimeBlockServiceImpl();
    const onChange = vi.fn();
    const unsubscribe = service.onBlockChange(onChange);

    await service.startSync('http://127.0.0.1:6984/test-user');
    expect(storageForUser['test-user'].listeners.size).toBeGreaterThan(0);
    onChange.mockClear();

    emitStorageChange('test-user', {
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
    expect(storageForUser['test-user'].listeners.size).toBeGreaterThan(0);
    onChange.mockClear();

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

    emitStorageChange('test-user', remoteBlock, 'sync');

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
    expect(storageForUser['test-user'].listeners.size).toBeGreaterThan(0);
    onChange.mockClear();

    const base = Date.now();
    emitStorageChange('test-user', {
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

    emitStorageChange('test-user', {
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

    emitStorageChange('test-user', {
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

  it('prefers newer transition time over actorId when phase and version tie', async () => {
    const service = new TimeBlockServiceImpl();
    const onChange = vi.fn();
    const unsubscribe = service.onBlockChange(onChange);
    const base = Date.now();

    loadActiveBlockMock.mockResolvedValueOnce({
      startId: 'same-start',
      name: 'local-older',
      startTime: base - 60_000,
      mode: 'countup',
      elapsed: 10_000,
      paused: false,
      version: 7,
      actorId: 'zz-local',
      lastTransitionAt: base - 5_000,
      lastResumedAt: base - 5_000,
      accumulatedRunMs: 10_000,
      pauseAccumulatedMs: 0,
      updatedAt: base - 5_000,
    });

    await service.startSync('http://127.0.0.1:6984/test-user');
    onChange.mockClear();
    saveActiveBlockMock.mockClear();

    emitStorageChange('test-user', {
      startId: 'same-start',
      name: 'remote-newer',
      startTime: base - 60_000,
      mode: 'countup',
      elapsed: 20_000,
      paused: false,
      version: 7,
      actorId: 'aa-remote',
      lastTransitionAt: base - 1_000,
      lastResumedAt: base - 1_000,
      accumulatedRunMs: 20_000,
      pauseAccumulatedMs: 0,
      updatedAt: base - 1_000,
    }, 'sync');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      startId: 'same-start',
      name: 'remote-newer',
      actorId: 'aa-remote',
    }));
    expect(saveActiveBlockMock).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('keeps remaining subscriber active after another subscriber unsubscribes', async () => {
    const service = new TimeBlockServiceImpl();
    const onChangeA = vi.fn();
    const onChangeB = vi.fn();
    const unsubscribeA = service.onBlockChange(onChangeA);
    const unsubscribeB = service.onBlockChange(onChangeB);
    const base = Date.now();

    await service.startSync('http://127.0.0.1:6984/test-user');
    onChangeA.mockClear();
    onChangeB.mockClear();

    unsubscribeA();
    emitStorageChange('test-user', {
      startId: 'multi-subscriber',
      name: 'remote-sync',
      startTime: base - 10_000,
      mode: 'countup',
      elapsed: 4_000,
      paused: false,
      updatedAt: base - 100,
      pauseAccumulatedMs: 0,
    }, 'sync');

    expect(onChangeA).not.toHaveBeenCalled();
    expect(onChangeB).toHaveBeenCalledWith(expect.objectContaining({ startId: 'multi-subscriber' }));

    unsubscribeB();
  });

  it('ignores stale sync packets from previous user storage after user switch', async () => {
    const service = new TimeBlockServiceImpl();
    const onChange = vi.fn();
    const unsubscribe = service.onBlockChange(onChange);
    const base = Date.now();

    loadActiveBlockMock
      .mockResolvedValueOnce({
        startId: 'user-a-block',
        name: 'user-a running',
        startTime: base - 20_000,
        mode: 'countup',
        elapsed: 5_000,
        paused: false,
        updatedAt: base - 5_000,
        pauseAccumulatedMs: 0,
      })
      .mockResolvedValueOnce({
        startId: 'user-b-block',
        name: 'user-b running',
        startTime: base - 10_000,
        mode: 'countup',
        elapsed: 3_000,
        paused: false,
        updatedAt: base - 2_000,
        pauseAccumulatedMs: 0,
      });

    await service.startSync('http://127.0.0.1:6984/user-a');
    await service.startSync('http://127.0.0.1:6984/user-b');
    onChange.mockClear();

    emitStorageChange('user-a', {
      startId: 'user-a-stale',
      name: 'stale from old user',
      startTime: base - 30_000,
      mode: 'countup',
      elapsed: 1_000,
      paused: false,
      updatedAt: base - 15_000,
      pauseAccumulatedMs: 0,
    }, 'sync');

    expect(onChange).not.toHaveBeenCalled();
    expect(storageForUser['user-a'].listeners.size).toBe(0);
    expect(storageForUser['user-b'].listeners.size).toBeGreaterThan(0);

    unsubscribe();
  });

  it('includes remote context in canonical write-back dedupe signature', async () => {
    const service = new TimeBlockServiceImpl();
    const base = Date.now();

    loadActiveBlockMock.mockResolvedValue({
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
    });

    await service.startSync('http://127.0.0.1:6984/test-user');
    saveActiveBlockMock.mockClear();

    const stalePacket = {
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
    };

    emitStorageChange('test-user', stalePacket, 'sync');
    await vi.waitFor(() => {
      expect(saveActiveBlockMock).toHaveBeenCalledTimes(1);
    });

    await service.startSync('http://127.0.0.1:6999/test-user');
    const writesBeforeSecondPacket = saveActiveBlockMock.mock.calls.length;
    emitStorageChange('test-user', stalePacket, 'sync');
    await vi.waitFor(() => {
      expect(saveActiveBlockMock.mock.calls.length).toBe(writesBeforeSecondPacket + 1);
    });
  });

  it('emits structured diagnostics when rejecting stale sync packets', async () => {
    const service = new TimeBlockServiceImpl();
    const base = Date.now();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    loadActiveBlockMock.mockResolvedValue({
      startId: 'same-start',
      name: 'local-accepted',
      startTime: base - 30_000,
      mode: 'countup',
      elapsed: 12_000,
      paused: false,
      version: 6,
      actorId: 'actor-local',
      lastTransitionAt: base - 2_000,
      lastResumedAt: base - 2_000,
      accumulatedRunMs: 12_000,
      pauseAccumulatedMs: 0,
      updatedAt: base - 2_000,
    });

    await service.startSync('http://127.0.0.1:6984/test-user');
    saveActiveBlockMock.mockClear();

    emitStorageChange('test-user', {
      startId: 'same-start',
      name: 'remote-stale',
      startTime: base - 30_000,
      mode: 'countup',
      elapsed: 2_000,
      paused: false,
      version: 6,
      actorId: 'actor-remote',
      lastTransitionAt: base - 20_000,
      lastResumedAt: base - 20_000,
      accumulatedRunMs: 2_000,
      pauseAccumulatedMs: 0,
      updatedAt: base - 20_000,
    }, 'sync');

    await vi.waitFor(() => {
      expect(saveActiveBlockMock).toHaveBeenCalledTimes(1);
    });
    expect(warnSpy).toHaveBeenCalledWith(
      '[WARN]',
      expect.stringContaining('"reason":"current_newer_transition"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[WARN]',
      expect.stringContaining('"compared":"transition_time"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[WARN]',
      expect.stringContaining('"storageUserId":"test-user"'),
    );
    await vi.waitFor(() => {
      expect(infoSpy).toHaveBeenCalledWith(
        '[INFO]',
        expect.stringContaining('"trigger":"reject_non_preferred_sync"'),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        '[INFO]',
        expect.stringContaining('"reason":"current_newer_transition"'),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        '[INFO]',
        expect.stringContaining('"storageUserId":"test-user"'),
      );
    });

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('publishes canonical snapshot when local storage emits ECS-replicated change trigger', async () => {
    const service = new TimeBlockServiceImpl();
    const base = Date.now();

    await service.startSync('http://127.0.0.1:6984/test-user');

    emitStorageChange('test-user', {
      startId: 'ecs-local-start',
      name: 'local running block',
      startTime: base - 20_000,
      mode: 'countup',
      elapsed: 6_000,
      paused: false,
      phase: 'running',
      version: 2,
      actorId: 'desktop',
      lastTransitionAt: base - 1_000,
      lastResumedAt: base - 1_000,
      accumulatedRunMs: 6_000,
      pauseAccumulatedMs: 0,
      updatedAt: base - 1_000,
    }, 'local');

    await vi.waitFor(() => {
      expect(publishActiveBlockReplicationSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({
          startId: 'ecs-local-start',
          phase: 'running',
          version: 2,
        }),
      );
    });
  });
});
