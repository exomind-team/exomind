import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_PATCH_BYTES = 8 * 1024 * 1024;

function patchSnapshot(path) {
  const file = openSync(path, 'r');
  try {
    const metadata = fstatSync(file);
    if (!metadata.isFile() || !metadata.size || metadata.size > MAX_PATCH_BYTES) throw new Error('Patch must be a nonempty file no larger than 8 MiB');
    const buffer = Buffer.alloc(metadata.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(file, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length !== metadata.size) throw new Error('Patch changed size during preflight');
    return buffer.subarray(0, length);
  } finally { closeSync(file); }
}

/** Read-only intake. A valid Git patch still needs source, test and UI review. */
export function preflightPatch({ repository, patchFile, expectedHead }) {
  if (!isAbsolute(repository) || !isAbsolute(patchFile)) throw new Error('Explicit absolute repository and patch paths are required');
  if (expectedHead !== undefined && !/^[0-9a-f]{40}$/i.test(expectedHead)) throw new Error('expectedHead must be an immutable 40-hex commit');
  const bytes = patchSnapshot(patchFile);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error('Regenerate the patch as UTF-8 without BOM');
  let patch;
  try { patch = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Regenerate the patch as valid UTF-8'); }
  if (patch.includes('\r')) throw new Error('Regenerate the final patch with LF line endings; do not normalize source hunks implicitly');
  const git = args => {
    try { return execFileSync('git', args, {cwd:repository, encoding:'utf8', timeout:10000, maxBuffer:1024*1024, windowsHide:true}).trim(); }
    catch (error) { throw new Error('Git patch preflight failed: ' + String(error.stderr ?? error.message).trim()); }
  };
  const head = git(['rev-parse', 'HEAD']);
  if (expectedHead && head.toLowerCase() !== expectedHead.toLowerCase()) throw new Error('Patch source HEAD differs from expectedHead');
  const numstat = git(['apply', '--numstat', '--', patchFile]);
  if (!numstat) throw new Error('Patch contains no file changes');
  git(['apply', '--check', '--whitespace=error-all', '--', patchFile]);
  if (git(['rev-parse', 'HEAD']) !== head) throw new Error('HEAD moved during patch preflight');
  if (!patchSnapshot(patchFile).equals(bytes)) throw new Error('Patch changed during preflight');
  return {scope:'read-only applicability against the current worktree; semantics and candidate acceptance unassessed', head, sha256:createHash('sha256').update(bytes).digest('hex'), bytes:bytes.length, files:numstat.split('\n').length};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [patchFile, expectedHead, ...extra] = process.argv.slice(2);
    if (!patchFile || extra.length) throw new Error('Usage: node scripts/dev/beta-patch-preflight.mjs <absolute patch> [expected 40-hex HEAD]');
    process.stdout.write(JSON.stringify(preflightPatch({repository:process.cwd(),patchFile,expectedHead})) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
