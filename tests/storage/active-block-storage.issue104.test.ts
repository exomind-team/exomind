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
});
