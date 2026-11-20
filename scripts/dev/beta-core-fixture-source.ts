/** Shared immutable source-tree materialization and lock-retention guards for Core fixtures. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const CORE_SOURCE_PREFIX = 'crates/exomind-core/';
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_FILES = 512;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function inside(root: string, target: string) {
  const path = relative(root, target);
  return !path || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

function pathEntryExists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function outputPath(repository: string, out: string) {
  if (!isAbsolute(out)) throw new Error('Output must be an absolute path outside the repository');
  const name = basename(out);
  if (!name || name === '.' || name === '..') throw new Error('Output must name a new directory');
  const canonicalOut = join(realpathSync(dirname(out)), name);
  if (inside(realpathSync(repository), canonicalOut)) throw new Error('Output must stay outside the repository');
  if (pathEntryExists(canonicalOut)) throw new Error('Output already exists; existing inputs are never replaced');
  return canonicalOut;
}

function sourceComponents(path: string) {
  if (!path.startsWith(CORE_SOURCE_PREFIX)) throw new Error('Only regular Core source files are permitted');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\') || part.includes(':'))) {
    throw new Error('Core source path is not safe on all supported platforms');
  }
  return parts;
}

function createOutputDirectory(root: string, parts: string[], ownedDirectories: string[]) {
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (!pathEntryExists(current)) {
      mkdirSync(current);
      ownedDirectories.push(current);
    }
    const info = lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Refusing a non-directory or linked Core output path');
  }
  return current;
}

function writeNewFile(path: string, bytes: Buffer, ownedFiles?: string[]) {
  const descriptor = openSync(path, 'wx');
  ownedFiles?.push(path);
  try {
    writeFileSync(descriptor, bytes);
  } finally {
    closeSync(descriptor);
  }
}

function cleanupPartialOutput(files: string[], directories: string[]) {
  const errors: unknown[] = [];
  for (const path of files.reverse()) {
    try { rmSync(path, { force: true }); } catch (error) { errors.push(error); }
  }
  for (const path of directories.reverse()) {
    try { rmdirSync(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') errors.push(error);
    }
  }
  return errors;
}

function git(repository: string, args: string[]) {
  return execFileSync('git', args, { cwd: repository, timeout: 10000, maxBuffer: MAX_SOURCE_BYTES, windowsHide: true });
}

export function materializeCoreSource({
  repository,
  sourceSha,
  out,
  reservedPaths = [],
}: {
  repository: string;
  sourceSha: string;
  out: string;
  reservedPaths?: readonly string[];
}) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('An immutable 40-character source SHA is required');
  const canonicalOut = outputPath(repository, out);
  const entries = git(repository, ['ls-tree', '-rz', sourceSha, '--', 'crates/exomind-core']).toString('utf8').split('\0').filter(Boolean);
  if (!entries.length || entries.length > MAX_SOURCE_FILES) throw new Error('Unexpected source file count');
  let total = 0;
  const reserved = new Set([CORE_SOURCE_PREFIX + 'Cargo.lock', ...reservedPaths]);
  const outputPaths = new Set<string>();
  const files = entries.map(entry => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(entry);
    if (!match || !match[3].startsWith(CORE_SOURCE_PREFIX)) throw new Error('Only regular Core source files are permitted');
    const path = match[3];
    const parts = sourceComponents(path);
    if (reserved.has(path) || outputPaths.has(path)) throw new Error('Core source collides with a generated fixture file');
    outputPaths.add(path);
    if (!inside(canonicalOut, resolve(canonicalOut, ...parts))) throw new Error('Source path escapes output');
    const bytes = git(repository, ['show', sourceSha + ':' + path]);
    total += bytes.length;
    if (total > MAX_SOURCE_BYTES) throw new Error('Source byte budget exceeded');
    return { path, parts, blob: match[2], bytes, sha256: hash(bytes) };
  });
  const lock = git(repository, ['show', sourceSha + ':Cargo.lock']);
  const ownedDirectories: string[] = [];
  const ownedFiles: string[] = [];
  try {
    mkdirSync(canonicalOut);
    ownedDirectories.push(canonicalOut);
    const outputRoot = lstatSync(canonicalOut);
    if (!outputRoot.isDirectory() || outputRoot.isSymbolicLink()) {
      throw new Error('Refusing a non-directory or linked Core output root');
    }
    for (const file of files) {
      const parent = createOutputDirectory(canonicalOut, file.parts.slice(0, -1), ownedDirectories);
      writeNewFile(join(parent, file.parts[file.parts.length - 1]), file.bytes, ownedFiles);
    }
    const lockParts = sourceComponents(CORE_SOURCE_PREFIX + 'Cargo.lock');
    const lockParent = createOutputDirectory(canonicalOut, lockParts.slice(0, -1), ownedDirectories);
    writeNewFile(join(lockParent, lockParts[lockParts.length - 1]), lock, ownedFiles);
  } catch (error) {
    const cleanupErrors = cleanupPartialOutput(ownedFiles, ownedDirectories);
    if (cleanupErrors.length) {
      const detail = cleanupErrors.map(item => item instanceof Error ? item.message : String(item)).join('; ');
      throw new Error(`Core source materialization failed and partial output cleanup was incomplete at ${canonicalOut}: ${detail}`, { cause: error });
    }
    throw error;
  }
  return { sourceSha, output: canonicalOut, files: files.map(({ bytes, parts: _parts, ...file }) => ({ ...file, byteLength: bytes.length })), lock };
}

function lockPackages(text: string) {
  const records = text.split('[[package]]').slice(1).map(block => {
    const field = (name: string) => {
      const value = new RegExp('^' + name + ' = (".*")$', 'm').exec(block)?.[1];
      return value ? JSON.parse(value) as string : null;
    };
    const name = field('name'), version = field('version');
    if (!name || !version) throw new Error('Invalid Cargo package identity');
    return { identity: JSON.stringify([name, version, field('source')]), checksum: field('checksum') };
  });
  if (!records.length) throw new Error('No locked package was found');
  const packages = new Map<string, string | null>();
  for (const record of records) {
    if (packages.has(record.identity)) throw new Error('Duplicate Cargo package identity');
    packages.set(record.identity, record.checksum);
  }
  return packages;
}

export function assertRetainedLockPackages(before: string, after: string) {
  const previous = lockPackages(before), retained = lockPackages(after);
  for (const [identity, checksum] of retained) {
    if (!previous.has(identity) || previous.get(identity) !== checksum) throw new Error('A retained dependency version, source or checksum changed');
  }
  return { retained: retained.size, pruned: previous.size - retained.size };
}
