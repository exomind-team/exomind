import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createCore10Fixture } from '../../../scripts/dev/beta-core10-fixture';

let parent: string | undefined;
afterEach(() => {
  if (!parent) return;
  const target = realpathSync(parent);
  if (dirname(target) !== realpathSync(tmpdir()) || !basename(target).startsWith('exomind-core10-execution-')) {
    throw new Error('Refuse to remove an unowned fixture test directory');
  }
  rmSync(target, { recursive: true, force: true });
  parent = undefined;
  vi.clearAllMocks();
});

it('retains failed Cargo phase evidence inside the requested fixture output', () => {
  parent = mkdtempSync(join(tmpdir(), 'exomind-core10-execution-'));
  const output = join(parent, 'fixture');
  // The real source and paths are materialized. Only the external Cargo
  // process is replaced to exercise its failure/evidence boundary.
  const executeCargo = vi.fn((_args: string[]) => ({ pid: 0, output: [], signal: null, status: 41,
    stdout: 'synthetic cargo output', stderr: 'synthetic cargo failure' }));
  let failure: unknown;
  try { createCore10Fixture(output, executeCargo); } catch (error) { failure = error; }
  expect(executeCargo).toHaveBeenCalledOnce();
  expect(failure instanceof Error ? failure.message : String(failure)).toMatch(/core10-resolve failed \(status 41\)/);
  expect(readFileSync(join(output, 'core10-resolve.stdout'), 'utf8')).toBe('synthetic cargo output');
  expect(readFileSync(join(output, 'core10-resolve.stderr'), 'utf8')).toBe('synthetic cargo failure');
  expect(executeCargo.mock.calls[0]?.[0]).toContain(join(output, 'crates/exomind-core/Cargo.toml'));
}, 30000);
