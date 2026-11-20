import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createCore10Fixture } from '../../../scripts/dev/beta-core10-fixture';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function source(relativePath: string) {
  const path = join(repository, relativePath);
  const exists = existsSync(path);
  expect(exists, relativePath + ' must be present').toBe(true);
  return exists ? readFileSync(path, 'utf8') : '';
}

const temporaryParents: string[] = [];
afterEach(() => {
  for (const path of temporaryParents.splice(0)) {
    const target = realpathSync(path);
    if (dirname(target) !== realpathSync(tmpdir()) || !basename(target).startsWith('exomind-core10-bad-out-')) {
      throw new Error('Refuse to clean an unowned Core10 fixture test path');
    }
    rmSync(target, { recursive: true, force: true });
  }
});

function temporaryParent() {
  const path = mkdtempSync(join(tmpdir(), 'exomind-core10-bad-out-'));
  temporaryParents.push(path);
  return path;
}

describe('pinned Core10 summary migration fixture', () => {
  it('keeps both public CLIs callable by Node before any Cargo phase', () => {
    for (const file of ['beta-core8-fixture.ts', 'beta-core10-fixture.ts']) {
      const result = spawnSync('node', [join(repository, 'scripts/dev', file), '--out', 'relative-fixture-output'], {
        cwd: repository, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Output must be an absolute path outside the repository/);
      expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    }
  });
  it('pins the old Core recipe and frozen payload as separate identities', () => {
    const tool = source('scripts/dev/beta-core10-fixture.ts');
    expect(tool).toMatch(/CORE10_RECIPE_SHA\s*=\s*['"]5708e0baf5cdc896559fab5172dc13805531ba33['"]/);
    expect(tool).toMatch(/CORE10_PAYLOAD_SHA\s*=\s*['"]cc3bc937c4196d1a6a838b10a82018dc37d66480['"]/);
    expect(tool).toMatch(/sourceSha\s*:\s*CORE10_RECIPE_SHA/);
    expect(tool).not.toMatch(/PRAGMA\s+(?:main\.)?user_version\s*=\s*10/i);
  });

  it('uses the shared immutable Core source and lock guards while retaining the Core8 entrypoint', () => {
    const helper = source('scripts/dev/beta-core-fixture-source.ts');
    const core8 = source('scripts/dev/beta-core8-fixture.ts');
    const tool = source('scripts/dev/beta-core10-fixture.ts');
    expect(helper).toMatch(/export\s+function\s+materializeCoreSource/);
    expect(helper).toMatch(/export\s+function\s+assertRetainedLockPackages/);
    expect(tool).toMatch(/materializeCoreSource/);
    expect(tool).toMatch(/assertRetainedLockPackages/);
    expect(core8).toMatch(/materializeCore8Source/);
    expect(core8).toMatch(/createCore8Fixture/);
  });

  it('keeps repository, link, traversal, size and time guards on the generation path', () => {
    const helper = source('scripts/dev/beta-core-fixture-source.ts');
    const tool = source('scripts/dev/beta-core10-fixture.ts');
    expect(helper).toMatch(/isAbsolute/);
    expect(helper).toMatch(/isSymbolicLink\(\)/);
    expect(helper).toMatch(/sourceComponents/);
    expect(helper).toMatch(/MAX_SOURCE_BYTES/);
    expect(helper).toContain('Unexpected source file count');
    expect(helper).toContain('Output must be an absolute path outside the repository');
    expect(helper).toContain('Output already exists; existing inputs are never replaced');
    expect(helper).toContain('Only regular Core source files are permitted');
    expect(helper).toContain('Source byte budget exceeded');
    expect(tool).toMatch(/CARGO_PHASE_TIMEOUT_MS/);
    expect(tool).toMatch(/timeout\s*:\s*CARGO_PHASE_TIMEOUT_MS/);
  });

  it('generates a genuine user_version 10 database and snapshots the raw stored summary body', () => {
    const generator = source('tests/fixtures/beta/core10-summary-migration.rs');
    expect(generator).toContain('CORE_SCHEMA_VERSION, 10');
    expect(generator).toContain('CAST(body AS BLOB)');
    expect(generator).toContain('VACUUM INTO ?1');
    expect(generator).toContain('old_version, 10');
    expect(generator).toContain('EXOMIND_PREFREEZE_BASE_SHA');
    expect(generator).toContain('EXOMIND_PREFREEZE_PAYLOAD_SHA');
  });

  it('records domain digest, snapshot digest, and raw body SHA as separate evidence', () => {
    const generator = source('tests/fixtures/beta/core10-summary-migration.rs');
    expect(generator).toMatch(/stored_record\.computed_digest\(\)/);
    expect(generator).toContain('artifact_digest');
    expect(generator).toContain('snapshot_digest');
    expect(generator).toContain('artifact_body_sha256');
    expect(generator).toContain('summary-body.json');
    expect(generator).toContain('SQLite events.body cast to BLOB');
  });

  it('locates Cargo.lock in either the complete workspace or copied isolated crate', () => {
    const generator = source('tests/fixtures/beta/core10-summary-migration.rs');
    expect(generator).toMatch(/fn cargo_lock_path\(crate_root: &Path, workspace_root: &Path\)/);
    expect(generator).toContain('crate_root.join("Cargo.lock")');
    expect(generator).toContain('workspace_root.join("Cargo.lock")');
    expect(generator).toContain('summary_prefreeze_legacy_fixture_generator.rs');
  });

  it('reports the generated fixture directory and both pinned source identities through the CLI', () => {
    const tool = source('scripts/dev/beta-core10-fixture.ts');
    expect(tool).toMatch(/fixture\s*:\s*createCore10Fixture/);
    expect(tool).toMatch(/recipeSha\s*:\s*CORE10_RECIPE_SHA/);
    expect(tool).toMatch(/payloadSha\s*:\s*CORE10_PAYLOAD_SHA/);
    expect(tool.replaceAll('\\', '/')).toContain('G:/exomind-beta-native-cache');
    expect(tool).toContain('CARGO_TARGET_DIR');
  });

  it('rejects relative and repository-local output before entering a Cargo phase', () => {
    expect(() => createCore10Fixture('relative-core10-output')).toThrow(/absolute/i);
    const insideRepository = join(repository, '.core10-fixture-test-output');
    expect(() => createCore10Fixture(insideRepository)).toThrow(/outside/i);
    expect(existsSync(insideRepository)).toBe(false);
  });

  it('rejects existing or unresolved output parents without replacing or creating them', () => {
    const parent = temporaryParent();
    const existing = join(parent, 'existing-output');
    mkdirSync(existing);
    expect(() => createCore10Fixture(existing)).toThrow(/already exists/i);
    const missingParent = join(parent, 'missing-parent', 'output');
    expect(() => createCore10Fixture(missingParent)).toThrow();
    expect(existsSync(join(parent, 'missing-parent'))).toBe(false);
  });
});
