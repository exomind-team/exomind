import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { EventStorage } from '@/lib/storage/event-storage';

async function removeDirWithRetry(targetPath: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && !['EBUSY', 'ENOTEMPTY', 'EPERM', 'ENOENT'].includes(code)) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

async function removeRootArtifacts(baseName: string): Promise<void> {
  const repoRoot = process.cwd();
  const dbPath = path.join(repoRoot, baseName);
  const mrviewPrefix = `${baseName}-mrview-`;

  if (fs.existsSync(dbPath)) {
    await removeDirWithRetry(dbPath);
  }

  const entries = await fs.promises.readdir(repoRoot, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(mrviewPrefix))
      .map((entry) => removeDirWithRetry(path.join(repoRoot, entry.name)))
  );
}

describe('EventStorage path isolation (issue #128)', () => {
  let storage: EventStorage;
  let dbBaseName: string;

  beforeEach(async () => {
    const userId = `issue128-path-${Date.now()}`;
    dbBaseName = `events_${userId}`;
    await removeRootArtifacts(dbBaseName);
    storage = new EventStorage(userId);
  });

  afterEach(async () => {
    if (storage) {
      await storage.stopSync();
      await storage.clearAll();
      await storage.close();
    }

    await removeRootArtifacts(dbBaseName);
  });

  it('does not leak events_* folders in repository root during tests（测试期间不污染仓库根目录）', async () => {
    const event = {
      id: `evt-${Date.now()}`,
      content: 'issue128-regression',
      createdAt: new Date().toISOString(),
    };

    await storage.addEvent(event);
    await storage.getEvents();

    const repoRoot = process.cwd();
    const rootDbPath = path.join(repoRoot, dbBaseName);
    const rootEntries = await fs.promises.readdir(repoRoot, { withFileTypes: true });
    const mrviewDirs = rootEntries.filter((entry) => entry.isDirectory() && entry.name.startsWith(`${dbBaseName}-mrview-`));

    expect(fs.existsSync(rootDbPath)).toBe(false);
    expect(mrviewDirs).toHaveLength(0);
  });
});
