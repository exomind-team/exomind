import fs from 'fs';
import path from 'path';

const LOCKED_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

export function listLevelDbLockFiles(dataDir) {
  if (!fs.existsSync(dataDir)) {
    return [];
  }

  const entries = fs.readdirSync(dataDir, { withFileTypes: true });
  const lockFiles = [];

  for (const entry of entries) {
    const entryPath = path.join(dataDir, entry.name);

    if (entry.isDirectory()) {
      const lockFilePath = path.join(entryPath, 'LOCK');
      if (fs.existsSync(lockFilePath)) {
        lockFiles.push(lockFilePath);
      }
      continue;
    }

    if (entry.isFile() && entry.name === 'LOCK') {
      lockFiles.push(entryPath);
    }
  }

  return lockFiles;
}

export function isFileLocked(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return false;
  } catch (error) {
    if (error && typeof error === 'object' && LOCKED_ERROR_CODES.has(error.code)) {
      return true;
    }
    throw error;
  }
}

export function detectLockedLevelDbFiles(dataDir) {
  const lockFiles = listLevelDbLockFiles(dataDir);
  return lockFiles.filter((lockFilePath) => isFileLocked(lockFilePath));
}
