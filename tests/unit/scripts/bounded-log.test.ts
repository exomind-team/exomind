// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBoundedLogTail } from '../../../scripts/dev/bounded-log';

const roots: string[] = [];
function log(content: string) { const root=mkdtempSync(join(tmpdir(),'exomind-logread-'));roots.push(root);const path=join(root,'stdout.log');writeFileSync(path,content);return path; }
afterEach(()=>{for(const root of roots.splice(0)){if(dirname(resolve(root)).toLowerCase()!==resolve(tmpdir()).toLowerCase()||!basename(root).startsWith('exomind-logread-'))throw new Error('Refusing unowned log fixture cleanup');rmSync(root,{recursive:true,force:true});}});

describe('bounded log observation',()=>{
  it('returns only the requested tail even for a large log',()=>{
    const path=log('x'.repeat(1024*1024)+'sentinel');
    const result=readBoundedLogTail(path,16);
    expect(result).toMatchObject({snapshotBytes:1024*1024+8,bytesRead:16,truncated:true,text:'xxxxxxxxsentinel'});
    expect(result.offset).toBe(result.snapshotBytes-16);
  });
  it('reports a complete small file without pretending it was truncated',()=>{
    expect(readBoundedLogTail(log('small\n'),4096)).toMatchObject({snapshotBytes:6,offset:0,bytesRead:6,truncated:false,text:'small\n'});
  });
  it.each([0,65537,Number.POSITIVE_INFINITY,1.5])('rejects an invalid budget before opening a file: %s',value=>{
    expect(()=>readBoundedLogTail(resolve('missing-log-file'),value)).toThrow(/byte budget/);
  });
});
