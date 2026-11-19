import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRetainedLockPackages, CORE8_SOURCE_SHA, materializeCore8Source } from '../../../scripts/dev/beta-core8-fixture';

const owned: string[] = [];
afterEach(() => {
  for (const path of owned.splice(0)) {
    const target = realpathSync(path);
    if (dirname(target) !== realpathSync(tmpdir()) || !basename(target).startsWith('exomind-core8-fixture-')) throw new Error('Refuse to clean an unowned test path');
    rmSync(target, { recursive: true, force: true });
  }
});
function directory() { const path = mkdtempSync(join(tmpdir(), 'exomind-core8-fixture-')); owned.push(path); return path; }
function repository() {
  const root = directory();
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=' + join(root, 'no-hooks'), '-c', 'commit.gpgsign=false', '-c', 'user.name=Synthetic', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
  git('init', '--quiet');
  mkdirSync(join(root, 'crates/exomind-core/src'), { recursive: true });
  writeFileSync(join(root, 'crates/exomind-core/src/lib.rs'), 'pub const CORE_SCHEMA_VERSION: i64 = 8;\n');
  writeFileSync(join(root, 'crates/exomind-core/Cargo.toml'), '[package]\nname="synthetic-core"\nversion="0.0.0"\n');
  writeFileSync(join(root, 'Cargo.lock'), '# synthetic locked dependencies\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic Core8');
  return { root, git, sha: git('rev-parse', 'HEAD') };
}

describe('immutable Core8 migration source', () => {
  it('uses the pinned historical tree after HEAD changes and leaves both repository and existing files intact', () => {
    expect(CORE8_SOURCE_SHA).toBe('85f7df92d0eccf1de624ab9220d4d8944797f28b');
    const { root, git, sha } = repository();
    writeFileSync(join(root, 'crates/exomind-core/src/lib.rs'), 'pub const CORE_SCHEMA_VERSION: i64 = 9;\n');
    git('add', '.'); git('commit', '--quiet', '-m', 'synthetic Core9');
    const out = join(directory(), 'source');
    const snapshot = materializeCore8Source({ repository: root, sourceSha: sha, out });
    expect(snapshot.files.length).toBe(2);
    expect(readFileSync(join(out, 'crates/exomind-core/src/lib.rs'), 'utf8')).toContain('= 8;');
    expect(readFileSync(join(root, 'crates/exomind-core/src/lib.rs'), 'utf8')).toContain('= 9;');
    expect(git('status', '--porcelain')).toBe('');
    expect(() => materializeCore8Source({ repository: root, sourceSha: sha, out })).toThrow(/exist/i);
    expect(readFileSync(join(out, 'crates/exomind-core/src/lib.rs'), 'utf8')).toContain('= 8;');

    const collision = repository();
    writeFileSync(join(collision.root, 'crates/exomind-core/Cargo.lock'), '# reserved by the fixture exporter\n');
    collision.git('add', '.'); collision.git('commit', '--quiet', '-m', 'synthetic reserved output collision');
    const collisionOut = join(directory(), 'collision');
    expect(() => materializeCore8Source({ repository: collision.root, sourceSha: collision.git('rev-parse', 'HEAD'), out: collisionOut })).toThrow(/collides/i);
    expect(existsSync(collisionOut)).toBe(false);
  });

  it('rejects a moving ref, repository output, and a Git symlink without materializing them', () => {
    const { root, git, sha } = repository();
    const movingOut = join(directory(), 'moving');
    expect(() => materializeCore8Source({ repository: root, sourceSha: 'HEAD', out: movingOut })).toThrow();
    expect(existsSync(movingOut)).toBe(false);
    const inside = join(root, 'temporary');
    expect(() => materializeCore8Source({ repository: root, sourceSha: sha, out: inside })).toThrow();
    expect(existsSync(inside)).toBe(false);
    const aliasParent = directory();
    const repositoryAlias = join(aliasParent, 'repository-link');
    symlinkSync(root, repositoryAlias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => materializeCore8Source({ repository: root, sourceSha: sha, out: join(repositoryAlias, 'output') })).toThrow(/outside/i);
    const missingParent = join(directory(), 'not-created', 'output');
    expect(() => materializeCore8Source({ repository: root, sourceSha: sha, out: missingParent })).toThrow();
    expect(existsSync(dirname(missingParent))).toBe(false);
    const blob = git('hash-object', '-w', '--stdin');
    git('update-index', '--add', '--cacheinfo', '120000,' + blob + ',crates/exomind-core/link');
    git('commit', '--quiet', '-m', 'synthetic unsupported source link');
    const linkOut = join(directory(), 'links');
    expect(() => materializeCore8Source({ repository: root, sourceSha: git('rev-parse', 'HEAD'), out: linkOut })).toThrow(/regular/i);
    expect(existsSync(linkOut)).toBe(false);
  });

  it('allows pruning unrelated workspace packages but rejects a changed version or checksum', () => {
    const packageBlock = (name: string, version: string, checksum: string) => `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "registry+https://example.invalid/index"\nchecksum = "${checksum}"\n`;
    const retained = packageBlock('kept', '1.0.0', 'a');
    expect(assertRetainedLockPackages(retained + packageBlock('unused', '2.0.0', 'b'), retained)).toEqual({ retained: 1, pruned: 1 });
    expect(() => assertRetainedLockPackages(retained, packageBlock('kept', '1.0.1', 'a'))).toThrow();
    expect(() => assertRetainedLockPackages(retained, packageBlock('kept', '1.0.0', 'b'))).toThrow();
    expect(() => assertRetainedLockPackages(retained, retained.replace('registry+https://example.invalid/index', 'registry+https://mirror.invalid/index'))).toThrow();
    expect(() => assertRetainedLockPackages(retained + retained, retained)).toThrow(/duplicate/i);
  });
});
