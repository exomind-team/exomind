import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {afterEach,test} from 'node:test';
import {checkStagedSourceImports} from '../../../scripts/dev/beta-staged-imports.mjs';

const owned=[];
afterEach(()=>{for(const directory of owned.splice(0)){const path=realpathSync(directory);assert.equal(dirname(path),realpathSync(tmpdir()));assert(basename(path).startsWith('exomind-staged-imports-'));rmSync(path,{recursive:true,force:true});}});

function fixture(){
 const repository=mkdtempSync(join(tmpdir(),'exomind-staged-imports-'));owned.push(repository);
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath='+join(repository,'no-hooks'),'-c','commit.gpgsign=false','-c','user.name=Synthetic','-c','user.email=test@example.invalid',...args],{cwd:repository,encoding:'utf8',windowsHide:true,timeout:10000}).trim();
 git('init','--quiet');
 const write=(name,text)=>{const path=join(repository,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);};
 return {repository,git,write};
}

test('rejects an untracked dependency and reads the staged content after it is added',()=>{
 const f=fixture();f.write('src/app.ts',"import {value} from './helper'; export {value};\n");f.write('src/helper.ts','export const value=1;\n');f.git('add','src/app.ts');
 const before=f.git('status','--porcelain');
 const red=checkStagedSourceImports({repository:f.repository});
 assert.equal(red.ok,false);assert.deepEqual(red.missing,[{from:'src/app.ts',specifier:'./helper'}]);
 assert.equal(f.git('status','--porcelain'),before,'The audit must not change the index or worktree');
 f.git('add','src/helper.ts');
 f.write('src/app.ts',"import './unrelated-worktree-only';\n");
 assert.equal(checkStagedSourceImports({repository:f.repository}).ok,true,'Only indexed source is being approved');
});

test('follows an unchanged indexed module to find a missing nested source',()=>{
 const f=fixture();f.write('src/app.ts',"import './helper';\n");f.write('src/helper.ts',"import './missing';\n");f.git('add','.');f.git('commit','--quiet','-m','synthetic broken baseline');
 f.write('src/app.ts',"import './helper'; export const updated=true;\n");f.git('add','src/app.ts');
 const result=checkStagedSourceImports({repository:f.repository});assert.equal(result.ok,false);assert.deepEqual(result.missing,[{from:'src/helper.ts',specifier:'./missing'}]);
});

test('resolves the project alias, directory indexes and assets without inspecting external packages',()=>{
 const f=fixture();f.write('src/app.ts',"import '@/feature'; import './style.css'; import 'external-package';\n");f.write('src/feature/index.ts',"export * from '../app';\n");f.write('src/style.css','body{}\n');f.git('add','src/app.ts','src/feature/index.ts');
 assert.deepEqual(checkStagedSourceImports({repository:f.repository}).missing,[{from:'src/app.ts',specifier:'./style.css'}]);
 f.git('add','src/style.css');const result=checkStagedSourceImports({repository:f.repository});assert.equal(result.ok,true);assert.equal(result.checkedFiles,2);
});

test('refuses a partial proof when the source traversal exceeds its budget',()=>{
 const f=fixture();f.write('src/app.ts',"import './helper';\n");f.write('src/helper.ts','export {};\n');f.git('add','.');
 assert.throws(()=>checkStagedSourceImports({repository:f.repository,maxFiles:1}),/source_import_budget_exceeded/);
});
