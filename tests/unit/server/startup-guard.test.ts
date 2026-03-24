import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLockedLevelDbFiles, isFileLocked, listLevelDbLockFiles } from '../../../server/startup-guard.js';

describe('startup guard', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('lists leveldb LOCK files under data subdirectories', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-lock-test-'));
    tempDirs.push(tempDir);
    const replicatorDir = path.join(tempDir, '_replicator');
    const usersDir = path.join(tempDir, '_users');
    const randomDir = path.join(tempDir, 'no-lock');

    fs.mkdirSync(replicatorDir, { recursive: true });
    fs.mkdirSync(usersDir, { recursive: true });
    fs.mkdirSync(randomDir, { recursive: true });

    fs.writeFileSync(path.join(replicatorDir, 'LOCK'), '');
    fs.writeFileSync(path.join(usersDir, 'LOCK'), '');
    fs.writeFileSync(path.join(randomDir, 'NOT_LOCK'), '');

    const lockFiles = listLevelDbLockFiles(tempDir);

    expect(lockFiles).toHaveLength(2);
    expect(lockFiles).toContain(path.join(replicatorDir, 'LOCK'));
    expect(lockFiles).toContain(path.join(usersDir, 'LOCK'));
  });

  it('reports unlocked file when LOCK file is openable', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-lock-test-'));
    tempDirs.push(tempDir);
    const lockFile = path.join(tempDir, 'LOCK');
    fs.writeFileSync(lockFile, '');

    expect(isFileLocked(lockFile)).toBe(false);
  });

  it('treats EBUSY as a locked file', () => {
    const openSyncSpy = vi.spyOn(fs, 'openSync').mockImplementation(() => {
      const error = new Error('busy') as NodeJS.ErrnoException;
      error.code = 'EBUSY';
      throw error;
    });

    expect(isFileLocked('D:/fake/LOCK')).toBe(true);
    expect(openSyncSpy).toHaveBeenCalledTimes(1);
  });

  it('detects only locked LOCK files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-lock-test-'));
    tempDirs.push(tempDir);
    const dbA = path.join(tempDir, 'dbA');
    const dbB = path.join(tempDir, 'dbB');
    const lockA = path.join(dbA, 'LOCK');
    const lockB = path.join(dbB, 'LOCK');

    fs.mkdirSync(dbA, { recursive: true });
    fs.mkdirSync(dbB, { recursive: true });
    fs.writeFileSync(lockA, '');
    fs.writeFileSync(lockB, '');

    const originalOpenSync = fs.openSync.bind(fs);
    vi.spyOn(fs, 'openSync').mockImplementation((filePath: fs.PathLike, flags?: string | number) => {
      if (String(filePath) === lockA) {
        const error = new Error('busy') as NodeJS.ErrnoException;
        error.code = 'EBUSY';
        throw error;
      }
      return originalOpenSync(filePath, flags as string | number | undefined);
    });

    const lockedFiles = detectLockedLevelDbFiles(tempDir);
    expect(lockedFiles).toEqual([lockA]);
  });
});
