import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync } from 'node:fs';

import {
  ActiveBlockStorage,
  clearAllActiveBlockStorageInstances,
  getActiveBlockStorage,
  normalizeActiveBlockDbName,
} from '@/lib/storage/active-block-storage';
import type { ActiveBlockData } from '@/lib/types/event';

describe('Issue #104 ActiveBlockStorage', () => {
  beforeEach(() => {
    mkdirSync('.tmp/pouchdb-active-block/', { recursive: true });
    clearAllActiveBlockStorageInstances();
  });

  afterEach(async () => {
    await clearAllActiveBlockStorageInstances();
  });

  it('normalizes database names for broad usernames', () => {
    const dbName = normalizeActiveBlockDbName('User.Name+Tag@EXAMPLE.com');
    expect(dbName).toMatch(/^active_blocks_[a-z0-9_$()+-]+$/);
  });

  it('works without browser localStorage in node runtime', async () => {
    const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
    vi.stubGlobal('localStorage', undefined);

    try {
      const storage = getActiveBlockStorage();
      const active = await storage.loadActiveBlock();
      expect(active).toBeNull();
    } finally {
      vi.stubGlobal('localStorage', originalLocalStorage);
    }
  });

  it('notifies listeners when block changes remotely or locally', async () => {
    const storage = new ActiveBlockStorage('issue104-listener-user');
    const calls: Array<ActiveBlockData | null> = [];
    const unsubscribe = storage.onBlockChange((block) => {
      calls.push(block);
    });

    const block: ActiveBlockData = {
      startId: 'issue-104-start',
      name: 'issue-104',
      startTime: Date.now(),
      elapsed: 0,
      mode: 'countup',
      paused: false,
      updatedAt: Date.now(),
      pauseAccumulatedMs: 0,
    };

    await storage.saveActiveBlock(block);
    await storage.deleteActiveBlock();
    unsubscribe();

    expect(calls.some((item) => item?.startId === 'issue-104-start')).toBe(true);
    expect(calls[calls.length - 1]).toBeNull();
  });

  it('keeps higher phase state when stale running payload is saved later', async () => {
    const storage = new ActiveBlockStorage('issue104-non-regression-user');
    const now = Date.now();
    const terminal: ActiveBlockData = {
      startId: 'issue-104-same-start',
      name: 'terminal-state',
      startTime: now - 60_000,
      elapsed: 10_000,
      mode: 'countup',
      paused: false,
      actionEndedAt: now - 20_000,
      feedbackStartedAt: now - 18_000,
      feedbackSubmittedAt: now - 15_000,
      updatedAt: now - 15_000,
      pauseAccumulatedMs: 0,
    };

    await storage.saveActiveBlock(terminal);
    await storage.saveActiveBlock({
      startId: terminal.startId,
      name: 'stale-running',
      startTime: terminal.startTime,
      elapsed: 1_000,
      mode: 'countup',
      paused: false,
      updatedAt: now - 30_000,
      pauseAccumulatedMs: 0,
    });

    const loaded = await storage.loadActiveBlock();
    expect(loaded?.startId).toBe(terminal.startId);
    expect(loaded?.feedbackSubmittedAt).toBe(terminal.feedbackSubmittedAt);
    expect(loaded?.actionEndedAt).toBe(terminal.actionEndedAt);
  });

  it('prefers newer transition time over actorId when phase and version tie', async () => {
    const storage = new ActiveBlockStorage('issue104-ordering-user');
    const now = Date.now();

    await storage.saveActiveBlock({
      startId: 'issue104-same-start',
      name: 'older-actor-higher',
      startTime: now - 60_000,
      elapsed: 8_000,
      mode: 'countup',
      paused: false,
      version: 5,
      actorId: 'zz-local',
      lastTransitionAt: now - 5_000,
      lastResumedAt: now - 5_000,
      accumulatedRunMs: 8_000,
      updatedAt: now - 5_000,
      pauseAccumulatedMs: 0,
    });

    await storage.saveActiveBlock({
      startId: 'issue104-same-start',
      name: 'newer-actor-lower',
      startTime: now - 60_000,
      elapsed: 12_000,
      mode: 'countup',
      paused: false,
      version: 5,
      actorId: 'aa-remote',
      lastTransitionAt: now - 1_000,
      lastResumedAt: now - 1_000,
      accumulatedRunMs: 12_000,
      updatedAt: now - 1_000,
      pauseAccumulatedMs: 0,
    });

    const loaded = await storage.loadActiveBlock();
    expect(loaded?.name).toBe('newer-actor-lower');
    expect(loaded?.actorId).toBe('aa-remote');
    expect(loaded?.lastTransitionAt).toBe(now - 1_000);
  });
});
