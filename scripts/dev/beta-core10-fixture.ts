/** Generate a true Core10 database from the pinned historical Core tree. */
import { execFileSync, spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  assertRetainedLockPackages,
  CORE_SOURCE_PREFIX,
  materializeCoreSource,
} from './beta-core-fixture-source.ts';

export const CORE10_RECIPE_SHA = '5708e0baf5cdc896559fab5172dc13805531ba33';
export const CORE10_PAYLOAD_SHA = 'cc3bc937c4196d1a6a838b10a82018dc37d66480';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GENERATOR_SOURCE = 'tests/fixtures/beta/core10-summary-migration.rs';
const GENERATOR_TEST_PATH = CORE_SOURCE_PREFIX + 'tests/summary_prefreeze_legacy_fixture_generator.rs';
const CARGO_TARGET_DIR_DEFAULT = 'G:/exomind-beta-native-cache';
const CARGO_PHASE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_PROCESS_BUFFER = 32 * 1024 * 1024;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

type FixtureManifest = {
  baseline_commit?: unknown;
  core10_payload_commit?: unknown;
  database_file?: unknown;
  database_schema?: unknown;
  database_sha256?: unknown;
  artifact_digest?: unknown;
  artifact_body_sha256?: unknown;
  snapshot_digest?: unknown;
};

function writeNewFile(path: string, bytes: Buffer) {
  const descriptor = openSync(path, 'wx');
  try {
    writeFileSync(descriptor, bytes);
  } finally {
    closeSync(descriptor);
  }
}

function copyLegacyGenerator(output: string, source: Buffer) {
  const crate = join(output, CORE_SOURCE_PREFIX);
  const tests = join(crate, 'tests');
  const info = lstatSync(tests);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Refusing a non-directory or linked archived Core tests path');
  }
  const target = join(tests, 'summary_prefreeze_legacy_fixture_generator.rs');
  writeNewFile(target, source);
  return target;
}

function cargoEnvironment(fixture: string) {
  // Reuse the established local cache; CI supplies its shared CARGO_TARGET_DIR explicitly.
  const targetDirectory = process.env.CARGO_TARGET_DIR || CARGO_TARGET_DIR_DEFAULT;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_TARGET_DIR: targetDirectory,
    CARGO_BUILD_JOBS: '1',
    CARGO_PROFILE_DEV_DEBUG: '0',
    CARGO_PROFILE_DEV_INCREMENTAL: 'false',
    CARGO_PROFILE_DEV_CODEGEN_UNITS: '16',
    EXOMIND_PREFREEZE_BASE_SHA: CORE10_RECIPE_SHA,
    EXOMIND_PREFREEZE_PAYLOAD_SHA: CORE10_PAYLOAD_SHA,
    EXOMIND_PREFREEZE_FIXTURE_DIR: fixture,
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
  return env;
}

type CargoExecutor = (args: string[], options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string>;

function cargo({ output, env, phase, args, execute }: {
  output: string; env: NodeJS.ProcessEnv; phase: string; args: string[]; execute: CargoExecutor;
}) {
  const result = execute(args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: CARGO_PHASE_TIMEOUT_MS,
    maxBuffer: MAX_PROCESS_BUFFER,
    windowsHide: true,
  });
  const stdout = result.stdout ?? '';
  const stderr = [result.stderr ?? '', result.error ? `${result.error.name}: ${result.error.message}\n` : ''].join('');
  writeNewFile(join(output, phase + '.stdout'), Buffer.from(stdout));
  writeNewFile(join(output, phase + '.stderr'), Buffer.from(stderr));
  if (result.error || result.status !== 0) {
    throw new Error(`${phase} failed (status ${result.status ?? 'unavailable'}); evidence retained at ${output}`);
  }
}

function verifyGeneratedFixture(fixture: string) {
  const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8')) as FixtureManifest;
  if (manifest.baseline_commit !== CORE10_RECIPE_SHA || manifest.core10_payload_commit !== CORE10_PAYLOAD_SHA) {
    throw new Error('Generated fixture manifest does not match the pinned Core10 recipe and payload');
  }
  if (manifest.database_schema !== 10 || manifest.database_file !== 'beta-core.sqlite3') {
    throw new Error('Pinned generator did not produce a user_version 10 Core database');
  }
  const database = readFileSync(join(fixture, 'beta-core.sqlite3'));
  const body = readFileSync(join(fixture, 'summary-body.json'));
  const summaryDigest = readFileSync(join(fixture, 'summary-digest.txt'), 'utf8').trim();
  const snapshotDigest = readFileSync(join(fixture, 'snapshot-digest.txt'), 'utf8').trim();
  if (hash(database) !== manifest.database_sha256 || hash(body) !== manifest.artifact_body_sha256) {
    throw new Error('Generated Core10 database or raw summary body SHA does not match its manifest');
  }
  if (summaryDigest !== manifest.artifact_digest || snapshotDigest !== manifest.snapshot_digest) {
    throw new Error('Generated Core10 domain or snapshot digest does not match its manifest');
  }
  return { manifest, databaseSha256: hash(database), summaryBodySha256: hash(body) };
}

export function createCore10Fixture(out: string, executeCargo: CargoExecutor = (args, options) => spawnSync('cargo', args, options)) {
  const generatorSource = readFileSync(join(ROOT, GENERATOR_SOURCE));
  const snapshot = materializeCoreSource({
    repository: ROOT,
    sourceSha: CORE10_RECIPE_SHA,
    out,
    reservedPaths: [GENERATOR_TEST_PATH],
  });
  const output = snapshot.output;
  const generatorPath = copyLegacyGenerator(output, generatorSource);
  const crate = join(output, CORE_SOURCE_PREFIX);
  const manifestPath = join(crate, 'Cargo.toml');
  const fixture = join(output, 'legacy-core10');
  const env = cargoEnvironment(fixture);
  const compiler = execFileSync('rustc', ['-vV'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const host = /^host: ([A-Za-z0-9_-]+)$/m.exec(compiler)?.[1];
  if (!host) throw new Error('Cannot determine the Rust host target for the archived Core10 fixture');

  // Resolve only the archived crate's lock, then prove that retained pins match the frozen Core tree.
  cargo({ output, env, execute: executeCargo, phase: 'core10-resolve', args: [
    'metadata', '--offline', '--manifest-path', manifestPath, '--format-version', '1', '--filter-platform', host,
  ] });
  const isolatedLock = readFileSync(join(crate, 'Cargo.lock'));
  const lockScope = assertRetainedLockPackages(snapshot.lock.toString('utf8'), isolatedLock.toString('utf8'));
  cargo({ output, env, execute: executeCargo, phase: 'core10-generate', args: [
    'test', '--offline', '--locked', '--manifest-path', manifestPath,
    '--test', 'summary_prefreeze_legacy_fixture_generator',
    'generate_legacy_summary_fixture_from_old_core', '--', '--exact', '--test-threads=1',
  ] });
  const generated = verifyGeneratedFixture(fixture);
  const { lock: originalLock, ...source } = snapshot;
  writeNewFile(join(output, 'provenance.json'), Buffer.from(JSON.stringify({
    ...source,
    fixture,
    recipeSha: CORE10_RECIPE_SHA,
    payloadSha: CORE10_PAYLOAD_SHA,
    generatorSourceSha256: hash(generatorSource),
    originalLockSha256: hash(originalLock),
    isolatedLockSha256: hash(isolatedLock),
    lockScope,
    databaseSha256: generated.databaseSha256,
    summaryBodySha256: generated.summaryBodySha256,
    sourceGenerator: GENERATOR_SOURCE,
    userDataRead: false,
  }, null, 2)));
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
    if (!values.out) throw new Error('Use --out <new absolute path outside the repository>');
    process.stdout.write(JSON.stringify({
      fixture: createCore10Fixture(values.out),
      recipeSha: CORE10_RECIPE_SHA,
      payloadSha: CORE10_PAYLOAD_SHA,
      userDataRead: false,
    }) + '\n');
  } catch (error) {
    process.stderr.write(`Core10 fixture generation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
