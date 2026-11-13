import { describe, expect, it, vi } from 'vitest';
import { BetaDraftController } from '@/beta/drafts';
import { collectOriginalDownload } from '@/beta/original-download';
import type { FileSourceStore } from '@/beta/file-source-store';
import type { BetaBeginStage, BetaOriginalClient, BetaStage } from '@/beta/original-types';
import { deferred, fakeClient, memoryStorage, saved } from './fixtures';

function sources() {
  const blobs = new Map<string, Blob>();
  return { blobs, put: vi.fn(async (key: string, blob: Blob) => { blobs.set(key, blob.slice()); }),
    get: vi.fn(async (key: string) => blobs.get(key) ?? null), remove: vi.fn(async (key: string) => { blobs.delete(key); }) } satisfies FileSourceStore;
}
function originalClient() {
  const stages = new Map<string, BetaStage>(); const bytes = new Map<string, Uint8Array>();
  const api = {
    begin: vi.fn(async (input: BetaBeginStage): Promise<BetaStage> => {
      const previous = stages.get(input.stage_id); if (previous) return previous;
      const stage: BetaStage = { stage_id: input.stage_id, profile_id: input.profile_id, original: { original_id:input.original_id,sha256:input.expected_sha256,byte_length:input.byte_length,file_name:input.file_name,media_type:input.media_type }, state:'uploading',next_offset:0,generation:1 };
      stages.set(input.stage_id,stage); bytes.set(input.stage_id,new Uint8Array()); return stage;
    }),
    status: vi.fn(async (_profile: string, id: string) => { const stage=stages.get(id); if (!stage) throw { code:'not_found',message:'no stage' }; return stage; }),
    write: vi.fn(async (_profile: string, id: string, offset: number, part: Uint8Array) => {
      const old=bytes.get(id)!; if (offset !== old.length) throw new Error('bad offset');
      const next=new Uint8Array(old.length+part.length);next.set(old);next.set(part,old.length);bytes.set(id,next);
      const stage={ ...stages.get(id)!,next_offset:next.length };stages.set(id,stage);return stage;
    }),
    verify: vi.fn(async (_profile: string,id: string) => { const stage={ ...stages.get(id)!,state:'verified' as const };stages.set(id,stage);return stage; }),
    readStage: vi.fn(async (_profile: string,id: string,offset: number,length: number) => bytes.get(id)!.slice(offset,offset+length)),
    readOriginal: vi.fn(async (_profile: string,id: string,offset: number,length: number) => {const stage=[...stages.values()].find(item=>item.original.original_id===id)!;return bytes.get(stage.stage_id)!.slice(offset,offset+length);}),
  } satisfies BetaOriginalClient;
  return { api, bytes, stages };
}
function fixture() {
  const original=originalClient();const client={ ...fakeClient(),originals:original.api };const store=sources();const storage=memoryStorage();let id=0;
  const create=()=>new BetaDraftController(client,'device-a',storage,()=>`id-${++id}`,()=>1234,store);
  return { ...original,client,store,storage,create };
}
const file=(name:string,bytes:BlobPart[]=['data'])=>new File(bytes,name,{type:'application/octet-stream'});

describe('Beta original drafts',()=>{
  it('freezes A/B and original command while upload A is blocked, preserving same-text next revision with C',async()=>{
    const f=fixture();const gate=deferred<void>();const entered=deferred<void>();const write=f.api.write.getMockImplementation()!;
    f.api.write.mockImplementationOnce(async (...args)=>{entered.resolve();await gate.promise;return write(...args);});
    const draft=f.create();draft.setDraft('p','same text');await draft.addFiles('p',[file('A'),file('B')]);await entered.promise;
    const selected=draft.snapshot().drafts.p.files!;const sending=draft.submit('p');
    const original=draft.snapshot().pending[0].command;
    expect(f.client.capture).not.toHaveBeenCalled();
    draft.removeFile('p',selected[0].id);await draft.addFiles('p',[file('C')]);draft.setDraft('p','same text');
    gate.resolve();await sending;
    expect(f.client.capture).toHaveBeenCalledTimes(1);
    expect(f.client.capture.mock.calls[0][0]).toEqual(original);
    expect(original.originals?.map(item=>item.file_name)).toEqual(['A','B']);
    expect(draft.snapshot().drafts.p.text).toBe('same text');
    expect(draft.snapshot().drafts.p.files!.map(item=>item.file_name)).toEqual(['B','C']);
  });
  it('persists source bytes before any stage RPC and never falls back to a partial pure-text submission',async()=>{
    const f=fixture();const copied=deferred<void>();f.store.put.mockImplementationOnce(async()=>copied.promise);
    const draft=f.create();draft.setDraft('p','text');const adding=draft.addFiles('p',[file('unknown.custom')]);
    expect(f.api.begin).not.toHaveBeenCalled();
    await expect(draft.submit('p')).rejects.toMatchObject({code:'original_preparing'});
    copied.reject(new Error('IDB quota'));await adding;
    expect(draft.snapshot().drafts.p.files![0].state).toBe('failed');
    await expect(draft.submit('p')).rejects.toBeDefined();expect(f.client.capture).not.toHaveBeenCalled();
    expect(draft.snapshot().drafts.p.text).toBe('text');
  });
  it('supports file-only unknown binary and empty file, and reads original bytes with complete hash verification',async()=>{
    const f=fixture();const draft=f.create();const binary=new Uint8Array([0,255,1,128,7]);
    await draft.addFiles('p',[file('data.custom',[binary]),file('empty.xyz',[])]);
    await draft.submit('p');const command=f.client.capture.mock.calls[0][0];
    expect(command.text).toBe('');expect(command.originals).toHaveLength(2);
    const blob=await collectOriginalDownload(f.client,'p',command.originals![0]);
    expect(new Uint8Array(await blob.arrayBuffer()).join(',')).toBe(binary.join(','));
    const empty=await collectOriginalDownload(f.client,'p',command.originals![1]);expect(empty.size).toBe(0);
    expect(f.api.readOriginal).toHaveBeenCalledWith('p',command.originals![1].original_id,0,1);
    expect(draft.snapshot().drafts.p.files).toEqual([]);
  });
  it('reopens failed uploads without automatically capturing and resumes durable bytes using the original pending command',async()=>{
    const f=fixture();f.api.write.mockRejectedValueOnce({code:'storage_failed',message:'disk full'});
    const first=f.create();first.setDraft('p','original');await first.addFiles('p',[file('resume')]);await first.submit('p');
    const command=first.snapshot().pending[0].command;expect(f.client.capture).not.toHaveBeenCalled();first.dispose();
    const restored=f.create();expect(f.client.capture).not.toHaveBeenCalled();
    await restored.retry(command.command_id);
    expect(f.client.capture).toHaveBeenCalledTimes(1);expect(f.client.capture.mock.calls[0][0]).toEqual(command);
  });
  it('checks a lost capture receipt before needing sources or uploading another byte',async()=>{
    const f=fixture();f.client.capture.mockRejectedValueOnce(new Error('lost reply'));
    const first=f.create();await first.addFiles('p',[file('one')]);await first.submit('p');
    const command=first.snapshot().pending[0].command;const writes=f.api.write.mock.calls.length;first.dispose();f.store.blobs.clear();
    f.client.receipt.mockResolvedValueOnce(saved(command));const reopened=f.create();await reopened.retry(command.command_id);
    expect(f.api.write).toHaveBeenCalledTimes(writes);expect(f.client.capture).toHaveBeenCalledTimes(1);
    expect(reopened.snapshot().drafts.p.files).toEqual([]);
  });
  it('keeps missing sources visible and rejects a different reselected file against the frozen hash',async()=>{
    const f=fixture();f.api.write.mockRejectedValue({code:'offline',message:'offline'});
    const first=f.create();await first.addFiles('p',[file('lost')]);await first.submit('p');const item=first.snapshot().drafts.p.files![0];first.dispose();f.store.blobs.clear();
    const restored=f.create();await restored.resumeFiles('p');
    expect(restored.snapshot().drafts.p.files![0].state).toBe('source_missing');
    await expect(restored.reselectFile('p',item.id,file('lost',['evil']))).rejects.toMatchObject({code:'source_mismatch'});
    expect(f.client.capture).not.toHaveBeenCalled();
  });
  it('never starts stage or capture RPC when descriptor/pending cache persistence fails',async()=>{
    const f=fixture();const storage={getItem:()=>null,setItem:vi.fn()};const draft=new BetaDraftController(f.client,'device-a',storage,()=>crypto.randomUUID(),Date.now,f.store);
    storage.setItem.mockImplementation(()=>{throw new Error('quota');});
    await draft.addFiles('p',[file('unsent')]);
    expect(f.api.begin).not.toHaveBeenCalled();expect(f.client.capture).not.toHaveBeenCalled();
  });
  it('rejects corrupt downloads and bounds the basic Blob-download memory before reading',async()=>{
    const f=fixture();const draft=f.create();await draft.addFiles('p',[file('x')]);await draft.submit('p');const original=f.client.capture.mock.calls[0][0].originals![0];
    f.api.readOriginal.mockResolvedValue(new Uint8Array([101,118,105,108]));
    await expect(collectOriginalDownload(f.client,'p',original)).rejects.toMatchObject({code:'original_integrity'});
    f.api.readOriginal.mockClear();
    await expect(collectOriginalDownload(f.client,'p',{...original,byte_length:65*1024*1024})).rejects.toMatchObject({code:'download_too_large'});
    expect(f.api.readOriginal).not.toHaveBeenCalled();
  });
});
