/** Rebuild an immutable synthetic Core8 input; never downgrade a current DB. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertRetainedLockPackages, CORE_SOURCE_PREFIX, materializeCoreSource } from './beta-core-fixture-source.ts';

export { assertRetainedLockPackages } from './beta-core-fixture-source.ts';
export const CORE8_SOURCE_SHA = '85f7df92d0eccf1de624ab9220d4d8944797f28b';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PREFIX = CORE_SOURCE_PREFIX;
const CARGO_PHASE_TIMEOUT_MS = 15 * 60 * 1000;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Backward-compatible Core8 name for the shared immutable Core source materializer. */
export const materializeCore8Source = materializeCoreSource;

function writeNewFile(path: string, bytes: Buffer) {
  const descriptor = openSync(path, 'wx');
  try {
    writeFileSync(descriptor, bytes);
  } finally {
    closeSync(descriptor);
  }
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
