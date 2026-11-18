import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface VerificationInput {
  head: string;
  scope: 'commit-diff' | 'worktree';
  changedPaths: string[];
  sourceFingerprint: string;
}

/** Establish which source is being tested; task path policy is a separate choice. */
export function collectVerificationInput(root: string, base?: string): VerificationInput {
  const git = (args: string[]) => execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:16*1024*1024,stdio:'pipe'});
  const paths = (args: string[]) => git(args).split('\0').filter(Boolean);
  const head = git(['rev-parse','HEAD']).trim();
  const untracked = paths(['ls-files','--others','--exclude-standard','-z']).sort();
  let changedPaths: string[];
  if (base) {
    if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('--base requires an exact commit SHA');
    git(['rev-parse','--verify',`${base}^{commit}`]);
    if (git(['status','--porcelain=v1','-z','--untracked-files=all']).length) {
      throw new Error('--base requires a clean worktree; commit the intended source or verify worktree inputs without --base');
    }
    changedPaths = paths(['diff','--no-renames','--name-only','-z',base,'HEAD','--']);
  } else {
    // CLI 1.4.0 auto-detection mixes absolute Windows change paths with a
    // canonical \\?\ root. Explicit Git-relative paths preserve its policy.
    changedPaths = [...new Set([
      ...paths(['diff','--no-renames','--name-only','-z','HEAD','--']),
      ...untracked,
    ])];
  }
  const fingerprint = createHash('sha256').update(head).update('\0');
  fingerprint.update(git(['diff','--binary','--no-ext-diff','--no-textconv','--no-renames','HEAD','--']));
  for (const path of untracked) {
    const absolute = join(root,path), stat = lstatSync(absolute);
    if (stat.size > 16*1024*1024) throw new Error('Untracked input exceeds the 16 MiB source-evidence budget; classify it before verification');
    const content = stat.isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute);
    fingerprint.update(path).update('\0').update(createHash('sha256').update(content).digest());
  }
  if (git(['rev-parse','HEAD']).trim() !== head) throw new Error('Source HEAD changed during input collection');
  return {head,scope:base?'commit-diff':'worktree',changedPaths:changedPaths.sort(),sourceFingerprint:fingerprint.digest('hex')};
}
