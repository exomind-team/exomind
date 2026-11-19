/** Rebuild an immutable synthetic Core8 input; never downgrade a current DB. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
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
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const CORE8_SOURCE_SHA = '85f7df92d0eccf1de624ab9220d4d8944797f28b';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PREFIX = 'crates/exomind-core/';
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const CARGO_PHASE_TIMEOUT_MS = 15 * 60 * 1000;
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
  if (!path.startsWith(PREFIX)) throw new Error('Only regular Core source files are permitted');
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

export function materializeCore8Source({
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
  if (!entries.length || entries.length > 512) throw new Error('Unexpected source file count');
  let total = 0;
  const reserved = new Set([PREFIX + 'Cargo.lock', ...reservedPaths]);
  const outputPaths = new Set<string>();
  const files = entries.map(entry => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(entry);
    if (!match || !match[3].startsWith(PREFIX)) throw new Error('Only regular Core source files are permitted');
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
    const lockParts = sourceComponents(PREFIX + 'Cargo.lock');
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

export function createCore8Fixture(out: string) {
  const fixtureSource = readFileSync(join(ROOT, 'tests/fixtures/beta/core8-migration.rs'));
  const snapshot = materializeCore8Source({
    repository: ROOT,
    sourceSha: CORE8_SOURCE_SHA,
    out,
    reservedPaths: [PREFIX + 'examples/core8_migration.rs'],
  });
  const output = snapshot.output;
  const crate = join(output, PREFIX), manifest = join(crate, 'Cargo.toml');
  mkdirSync(join(crate, 'examples'), { recursive: true });
  writeNewFile(join(crate, 'examples/core8_migration.rs'), fixtureSource);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_BUILD_JOBS: '1',
    CARGO_PROFILE_DEV_DEBUG: '0',
    CARGO_PROFILE_DEV_INCREMENTAL: 'false',
    CARGO_PROFILE_DEV_CODEGEN_UNITS: '16',
    EXOMIND_SYNTHETIC_FIXTURE_OUT: join(output, 'synthetic'),
  };
  delete env.CARGO_BUILD_TARGET;
  if (process.platform === 'win32') {
    const sysroot = execFileSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
    Object.assign(env, {
      CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER: join(sysroot, 'lib/rustlib/x86_64-pc-windows-msvc/bin/rust-lld.exe'),
      RUSTFLAGS: '-C linker-flavor=lld-link -C link-arg=/threads:1 -C link-arg=/DEBUG:NONE',
    });
    delete env.CARGO_ENCODED_RUSTFLAGS;
  }
  const cargo = (phase: string, args: string[]) => {
    const result = spawnSync('cargo', args, {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: CARGO_PHASE_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    const stdout = result.stdout ?? '';
    const stderr = [result.stderr ?? '', result.error ? `${result.error.name}: ${result.error.message}\n` : ''].join('');
    writeNewFile(join(output, phase + '.stdout'), Buffer.from(stdout));
    writeNewFile(join(output, phase + '.stderr'), Buffer.from(stderr));
    if (result.error || result.status !== 0) throw new Error(`${phase} failed (status ${result.status ?? 'unavailable'}); evidence retained at ${output}`);
  };
  const compiler = execFileSync('rustc', ['-vV'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const host = /^host: ([A-Za-z0-9_-]+)$/m.exec(compiler)?.[1];
  if (!host) throw new Error('Cannot determine the Rust host target for the archived fixture');
  // --no-deps leaves the workspace lock untouched. Resolve the archived crate
  // fully, filtering platform fetches, then verify pins before --locked build.
  cargo('resolve', ['metadata', '--offline', '--manifest-path', manifest, '--format-version', '1', '--filter-platform', host]);
  const lock = readFileSync(join(crate, 'Cargo.lock'));
  const lockScope = assertRetainedLockPackages(snapshot.lock.toString('utf8'), lock.toString('utf8'));
  cargo('generate', ['run', '--offline', '--locked', '--manifest-path', manifest, '--example', 'core8_migration']);
  const fixture = join(output, 'synthetic/archive');
  if (!existsSync(join(fixture, 'beta-core.sqlite3'))) throw new Error('Fixture generation did not produce a Core archive');
  const { lock: originalLock, ...source } = snapshot;
  const provenance = {
    ...source,
    fixture,
    originalLockSha256: hash(originalLock),
    isolatedLockSha256: hash(lock),
    lockScope,
    fixtureSourceSha256: hash(fixtureSource),
    scope: 'synthetic Core8 storage migration; trusted Host admission with fixed proof bytes, not a cryptographic verification test',
    userDataRead: false,
  };
  writeNewFile(join(output, 'provenance.json'), Buffer.from(JSON.stringify(provenance, null, 2)));
  return fixture;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const invoked = realpathSync(resolve(process.argv[1]));
    const current = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? invoked.toLowerCase() === current.toLowerCase() : invoked === current;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    const { values } = parseArgs({ options: { out: { type: 'string' } }, allowPositionals: false });
    if (!values.out) throw new Error('Use --out <new absolute directory outside the repository>');
    process.stdout.write(JSON.stringify({ fixture: createCore8Fixture(values.out), sourceSha: CORE8_SOURCE_SHA, userDataRead: false }) + '\n');
  } catch (error) {
    process.stderr.write(`Core8 fixture generation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
