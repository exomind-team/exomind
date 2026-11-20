import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { preflightPatch } from '../../../scripts/dev/beta-patch-preflight.mjs';

const patch = 'diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+after\n';
function fixture(run) {
  const root=mkdtempSync(join(tmpdir(),'exomind-patch-intake-'));
  try {
    const globalConfig=join(root,'synthetic-global.gitconfig');writeFileSync(globalConfig,'');
    const env={...process.env,GIT_CONFIG_GLOBAL:globalConfig,GIT_CONFIG_NOSYSTEM:'1'};
    execFileSync('git',['init','--quiet',root],{env,windowsHide:true});
    writeFileSync(join(root,'example.txt'),'before\n');
    execFileSync('git',['-C',root,'add','example.txt'],{env,windowsHide:true});
    execFileSync('git',['-C',root,'-c','user.name=Synthetic Test','-c','user.email=test@example.invalid','commit','--quiet','-m','fixture'],{env,windowsHide:true});
    const file=join(root,'change.patch'); writeFileSync(file,patch);
    run(root,file);
  } finally { rmSync(root,{recursive:true,force:true}); }
}
test('validates the actual Git context without modifying source or index',()=>fixture((repository,patchFile)=>{
  const index=readFileSync(join(repository,'.git/index'));
  assert.equal(preflightPatch({repository,patchFile}).files,1);
  assert.equal(readFileSync(join(repository,'example.txt'),'utf8'),'before\n');
  assert.deepEqual(readFileSync(join(repository,'.git/index')),index);
}));
test('rejects malformed hunk counts instead of treating text as an applicable patch',()=>fixture((repository,patchFile)=>{
  writeFileSync(patchFile,patch.replace('@@ -1 +1 @@','@@ -1,2 +1,2 @@'));
  assert.throws(()=>preflightPatch({repository,patchFile}),/Git patch preflight failed/);
}));
test('rejects final CRLF output that would fail against normalized source',()=>fixture((repository,patchFile)=>{
  writeFileSync(patchFile,patch.replaceAll('\n','\r\n'));
  assert.throws(()=>preflightPatch({repository,patchFile}),/LF line endings/);
}));
test('rejects invalid UTF-8 and BOM without repairing the supplied artifact',()=>fixture((repository,patchFile)=>{
  writeFileSync(patchFile,Buffer.from([0xff]));assert.throws(()=>preflightPatch({repository,patchFile}),/valid UTF-8/);
  writeFileSync(patchFile,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(patch)]));
  assert.throws(()=>preflightPatch({repository,patchFile}),/without BOM/);
}));
test('rejects an immutable baseline mismatch before reporting applicability',()=>fixture((repository,patchFile)=>{
  assert.throws(()=>preflightPatch({repository,patchFile,expectedHead:'f'.repeat(40)}),/differs from expectedHead/);
}));
