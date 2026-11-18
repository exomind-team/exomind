// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectVerificationInput } from '../../../scripts/dev/beta-contract-inputs';

const roots:string[]=[];
function git(root:string,args:string[]) { return execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim(); }
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'exomind-contract-inputs-')); roots.push(root);
  git(root,['init','-q']); git(root,['config','user.name','Fixture']); git(root,['config','user.email','fixture@example.invalid']);
  git(root,['config','commit.gpgsign','false']); git(root,['config','core.hooksPath',join(root,'no-hooks')]);
  git(root,['config','core.autocrlf','false']);
  writeFileSync(join(root,'tracked.txt'),'baseline\n'); git(root,['add','tracked.txt']); git(root,['commit','-qm','baseline']);
  const base=git(root,['rev-parse','HEAD']);
  writeFileSync(join(root,'tracked.txt'),'committed update\n'); git(root,['commit','-qam','update']);
  return {root,base,head:git(root,['rev-parse','HEAD'])};
}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe('source identity and verification change scopes',()=>{
  it('records the exact commit and committed paths for a clean base comparison',()=>{
    const f=fixture(),input=collectVerificationInput(f.root,f.base);
    expect(input).toMatchObject({head:f.head,scope:'commit-diff',changedPaths:['tracked.txt']}); expect(input.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(['unstaged','staged','untracked'])('rejects %s changes instead of testing dirty code under a clean commit identity',kind=>{
    const f=fixture(),path=kind==='untracked'?'new.txt':'tracked.txt'; writeFileSync(join(f.root,path),'outside commit\n');
    if(kind==='staged')git(f.root,['add',path]);
    expect(()=>collectVerificationInput(f.root,f.base)).toThrow(/clean worktree/);
  });
  it('collects local tracked and untracked paths without applying a previous tasks path policy',()=>{
    const f=fixture(); writeFileSync(join(f.root,'tracked.txt'),'local\n'); writeFileSync(join(f.root,'new-feature.md'),'new scope\n');
    const input=collectVerificationInput(f.root); expect(input.head).toBe(f.head);expect(input.scope).toBe('worktree');
    expect(input.changedPaths.sort()).toEqual(['new-feature.md','tracked.txt']);
  });
  it('requires an exact base SHA and verifies that it exists',()=>{
    const f=fixture(); expect(()=>collectVerificationInput(f.root,'HEAD~1')).toThrow(/exact/);
    expect(()=>collectVerificationInput(f.root,'a'.repeat(40))).toThrow();
  });
  it('detects changed bytes even when HEAD and the set of changed paths stay the same',()=>{
    const f=fixture(); writeFileSync(join(f.root,'tracked.txt'),'first\n'); writeFileSync(join(f.root,'new.txt'),'draft one\n');
    const before=collectVerificationInput(f.root);
    writeFileSync(join(f.root,'new.txt'),'draft two\n'); const afterUntracked=collectVerificationInput(f.root);
    expect(afterUntracked.changedPaths).toEqual(before.changedPaths); expect(afterUntracked.sourceFingerprint).not.toBe(before.sourceFingerprint);
    writeFileSync(join(f.root,'tracked.txt'),'second\n'); const afterTracked=collectVerificationInput(f.root);
    expect(afterTracked.changedPaths).toEqual(before.changedPaths); expect(afterTracked.sourceFingerprint).not.toBe(afterUntracked.sourceFingerprint);
  });
});
