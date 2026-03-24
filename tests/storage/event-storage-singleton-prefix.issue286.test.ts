import { afterEach, describe, expect, it } from 'vitest';

import {
  clearAllStorageInstances,
  getEventStorage,
} from '@/lib/storage/event-storage';

const PREFIX_ENV = 'EXOMIND_EVENT_STORAGE_PREFIX';

async function closeUniqueStorages(storages: Array<ReturnType<typeof getEventStorage>>): Promise<void> {
  const unique = Array.from(new Set(storages));
  await Promise.all(unique.map(async (storage) => {
    await storage.stopSync();
    await storage.clearAll();
    await storage.close();
  }));
}

describe('EventStorage singleton cache key with prefix（单例缓存应包含前缀）', () => {
  const originalPrefix = process.env[PREFIX_ENV];

  afterEach(async () => {
    clearAllStorageInstances();
    if (originalPrefix === undefined) {
      delete process.env[PREFIX_ENV];
    } else {
      process.env[PREFIX_ENV] = originalPrefix;
    }
  });

  it('creates different singleton instances when prefix changes（前缀变化时不应复用旧实例）', async () => {
    const userId = `singleton-prefix-${Date.now()}`;
    process.env[PREFIX_ENV] = '.tmp/pouchdb-event-storage/a';
    const first = getEventStorage(userId);

    process.env[PREFIX_ENV] = '.tmp/pouchdb-event-storage/b';
    const second = getEventStorage(userId);

    await closeUniqueStorages([first, second]);
    expect(first).not.toBe(second);
  });
});
