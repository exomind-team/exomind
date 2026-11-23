import { describe, expect, it, vi } from 'vitest';
import { BetaDraftController } from '@/beta/drafts';
import { collectOriginalDownload } from '@/beta/original-download';
import type { FileSourceStore } from '@/beta/file-source-store';
import type { NativeAttachmentSources, SharedHandoffAttachmentFile } from '@/beta/native-attachment-types';
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
  const create=(retryDelay?:(milliseconds:number)=>Promise<void>)=>new BetaDraftController(client,'device-a',storage,()=>`id-${++id}`,()=>1234,store,retryDelay);
  return { ...original,client,store,storage,create };
}
const file=(name:string,bytes:BlobPart[]=['data'])=>new File(bytes,name,{type:'application/octet-stream'});

describe('Beta original drafts',()=>{
  it('strips only text boundaries from the Capture while preserving the exact editor source after rejection',async()=>{
    const f=fixture(),draft=f.create(),sourceText=' \n  first line \n\n second line\t\n ';
    f.client.capture.mockRejectedValueOnce({code:'network_error',message:'synthetic response loss'});
    draft.setDraft('p',sourceText);

    await draft.submit('p');

    expect(f.client.capture).toHaveBeenCalledTimes(1);
    expect(f.client.capture.mock.calls[0][0].text).toBe('first line \n\n second line');
    expect(draft.snapshot().pending[0]?.command.text).toBe('first line \n\n second line');
    expect(draft.snapshot().pending[0]?.editable_text).toBe(sourceText);
    expect(JSON.parse(f.storage.getItem('exomind:beta:drafts:device-a')!).pending[0].editable_text).toBe(sourceText);
    expect(draft.snapshot().drafts.p.text).toBe(sourceText);
    draft.dispose();
  });

  it('appends shared text once per handoff and persists the handoff identity with the draft',async()=>{
    const f=fixture(),draft=f.create();
    draft.setDraft('p','existing note');

    const first=await draft.appendSharedHandoffText('p','handoff-1','https://example.test\nshared text');

    expect(first).toBe(true);
    expect(draft.snapshot().drafts.p.text).toBe('existing note\n\nhttps://example.test\nshared text');
    expect(draft.snapshot().drafts.p.imported_handoffs).toEqual(['handoff-1']);
    expect(JSON.parse(f.storage.getItem('exomind:beta:drafts:device-a')!).drafts.p.imported_handoffs).toEqual(['handoff-1']);

    const duplicate=await draft.appendSharedHandoffText('p','handoff-1','https://example.test\nshared text');

    expect(duplicate).toBe(false);
    expect(draft.snapshot().drafts.p.text).toBe('existing note\n\nhttps://example.test\nshared text');
    draft.dispose();
  });

  it('keeps a share handoff available when appending it would exceed the Capture text limit',async()=>{
    const f=fixture(),draft=f.create(),large='x'.repeat(128*1024-1);
    draft.setDraft('p',large);

    await expect(draft.appendSharedHandoffText('p','handoff-size-1','y')).rejects.toMatchObject({code:'capture_text_too_large'});
    expect(draft.snapshot().drafts.p.text).toBe(large);
    expect(draft.snapshot().drafts.p.imported_handoffs).toBeUndefined();

    draft.setDraft('p','short');
    await expect(draft.appendSharedHandoffText('p','handoff-size-1','y')).resolves.toBe(true);
    expect(draft.snapshot().drafts.p.text).toBe('short\n\ny');
    draft.dispose();
  });

  it('requires durable draft recovery before a duplicate share handoff may be acknowledged',async()=>{
    const f=fixture(),journal={read:vi.fn(async()=>null),write:vi.fn(async()=>{})};
    const draft=await BetaDraftController.open(f.client,'device-a',{legacy:memoryStorage(),sources:f.store,journal});
    journal.write.mockImplementationOnce(async()=>{throw new Error('synthetic journal failure');});

    await expect(draft.appendSharedHandoffText('p','handoff-durable-1','shared text')).rejects.toMatchObject({code:'draft_cache_unavailable'});
    expect(draft.snapshot().drafts.p.text).toBe('shared text');
    expect(draft.snapshot().persistenceState).toBe('failed');

    const duplicate=await draft.appendSharedHandoffText('p','handoff-durable-1','shared text');

    expect(duplicate).toBe(false);
    expect(draft.snapshot().drafts.p.text).toBe('shared text');
    expect(draft.snapshot().persistenceState).toBe('idle');
    expect(journal.write).toHaveBeenCalledTimes(2);
    await draft.close();
  });

  it('imports a shared handoff handle through Native private storage without materializing a Blob or path',async()=>{
    const f=fixture(),digest='a'.repeat(64);
    const nativeSources={
      put:vi.fn(async()=>{}),get:vi.fn(async()=>null),remove:vi.fn(async()=>{}),
      importFile:vi.fn(async()=>{}),
      importSharedHandoff:vi.fn(async(_key:string,_source:SharedHandoffAttachmentFile)=>{}),
      verifySource:vi.fn(async(_key:string)=>({size:4,sha256:digest})),
      stageLocalSource:vi.fn(async(_key:string,command:BetaBeginStage)=>({
        stage:{stage_id:command.stage_id,profile_id:command.profile_id,original:{original_id:command.original_id,sha256:command.expected_sha256,byte_length:command.byte_length,file_name:command.file_name,media_type:command.media_type},state:'verified' as const,next_offset:command.byte_length,generation:1},
        cleanupConfirmed:true,
      })),
    } satisfies NativeAttachmentSources;
    const draft=new BetaDraftController(f.client,'device-a',f.storage,()=> 'shared-attachment-1',()=>1234,nativeSources);
    const shared:SharedHandoffAttachmentFile={kind:'shared_handoff_file',handoffId:'handoff-1',itemId:'item-1',profileId:'p',name:'shared.png',size:4,type:'image/png'};

    const [id]=await draft.addFiles('p',[shared],{sourceIds:['share-handoff:handoff-1:item-1']});
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.[0].state).toBe('verified'));

    expect(id).toBe('shared-attachment-1');
    expect(nativeSources.importSharedHandoff).toHaveBeenCalledWith(
      draft.snapshot().drafts.p.files?.[0].source_key,shared,expect.any(Object),
    );
    expect(nativeSources.put).not.toHaveBeenCalled();
    expect(f.api.begin).not.toHaveBeenCalled();
    draft.dispose();
  });

  it('reuses an audio attachment by stable source identity, not a retry filename',async()=>{
    const f=fixture(),draft=f.create();
    const first=await draft.addFiles('p',[file('first-name.webm',['same bytes'])],{sourceIds:['recording-session-1']});
    const selected=draft.snapshot().drafts.p.files?.[0];expect(selected?.id).toBe(first[0]);
    const retried=await draft.addFiles('p',[file('renamed-on-retry.webm',['same bytes'])],{sourceIds:['recording-session-1']});
    expect(retried).toEqual(first);
    expect(draft.snapshot().drafts.p.files).toHaveLength(1);
    expect(draft.snapshot().drafts.p.files?.[0]).toMatchObject({id:first[0],source_id:'recording-session-1',file_name:'first-name.webm'});
    draft.dispose();
  });

  it('B14-A03: a late selection-intent write failure preserves text typed while waiting for its acknowledgement',async()=>{
    const f=fixture(),entered=deferred<void>(),gate=deferred<void>();
    const owner=await BetaDraftController.open(f.client,'device-a',{legacy:memoryStorage(),sources:f.store,journal:{read:async()=>null,write:async()=>{entered.resolve();await gate.promise;}}});
    try{const adding=owner.addFiles('p',[file('pending-file')]);await entered.promise;owner.setDraft('p','newer text while waiting');gate.reject(new Error('synthetic disk write failure'));await adding;expect(owner.snapshot().drafts.p.text).toBe('newer text while waiting');expect(f.api.begin).not.toHaveBeenCalled();expect(f.client.capture).not.toHaveBeenCalled();}
    finally{owner.dispose();}
  });
  it('B14-A03: a verified draft preview remains readable after releasing its duplicate source',async()=>{
    const f=fixture(),draft=f.create();await draft.addFiles('p',[file('preview.txt',['data'])]);
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.[0].state).toBe('verified'));
    const selected=draft.snapshot().drafts.p.files![0];expect(f.store.blobs.size).toBe(0);
    const source=await draft.previewSource('p',selected.id);expect(source?.size).toBe(4);expect(f.client.capture).not.toHaveBeenCalled();
    expect(await import('@/beta/file-source-store').then(({readFileSource})=>readFileSource(source!,0,4))).toEqual(new TextEncoder().encode('data'));
  });
  it('B14-A03: reports real preparation progress and a removed selection cannot continue into Core',async()=>{
    const f=fixture(),copy=deferred<void>(),entered=deferred<void>();
    f.store.put=vi.fn(async(_key:string,_blob:Blob,work?:import('@/beta/attachment-progress').FileSourceWork)=>{
      work?.progress('copying',2,4);entered.resolve();await copy.promise;
    });
    const draft=f.create();const adding=draft.addFiles('p',[file('slow',['data'])]);await entered.promise;
    const id=draft.snapshot().drafts.p.files![0].id;
    expect(draft.snapshot().fileProgress[id]).toMatchObject({phase:'copying',completed:2,total:4});
    draft.removeFile('p',id);copy.resolve();await adding;
    expect(f.store.get).not.toHaveBeenCalled();expect(f.api.begin).not.toHaveBeenCalled();expect(f.client.capture).not.toHaveBeenCalled();
  });
  it('prepares a later small image while the first large file is still being copied',async()=>{
    const f=fixture(),largeEntered=deferred<void>(),smallEntered=deferred<void>(),largeGate=deferred<void>();
    f.store.put=vi.fn(async(key:string,blob:Blob,work?:import('@/beta/attachment-progress').FileSourceWork)=>{
      if(blob.size>1024*1024){largeEntered.resolve();await largeGate.promise;}else smallEntered.resolve();
      if(work?.cancelled())throw{code:'selection_removed',message:'removed'};
      f.store.blobs.set(key,blob.slice());work?.progress('copying',blob.size,blob.size);
    });
    const draft=f.create(),large=file('large.bin',[new Uint8Array(2*1024*1024)]),image=new File([new Uint8Array([1,2,3])],'small.png',{type:'image/png'});
    const adding=draft.addFiles('p',[large,image]);
    await Promise.all([largeEntered.promise,smallEntered.promise]);
    const selected=draft.snapshot().drafts.p.files!;
    const largeDraft=selected.find(item=>item.file_name==='large.bin')!,imageDraft=selected.find(item=>item.file_name==='small.png')!;

    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.find(item=>item.id===imageDraft.id)?.state).toBe('verified'));
    expect(draft.snapshot().drafts.p.files?.find(item=>item.id===largeDraft.id)?.state).toBe('preparing');
    expect(f.client.capture).not.toHaveBeenCalled();

    largeGate.resolve();await adding;
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.find(item=>item.id===largeDraft.id)?.state).toBe('verified'));
    draft.dispose();
  });
  it('cancels both queued and active preparation without staging removed files',async()=>{
    const f=fixture(),gates=[deferred<void>(),deferred<void>()],entered=[deferred<void>(),deferred<void>()];
    const keys=Array.from({length:3},(_,index)=>JSON.stringify(['device-a','p',`id-${index*2+1}`]));
    const works=new Map<string,import('@/beta/attachment-progress').FileSourceWork|undefined>();
    f.store.put=vi.fn(async(key:string,blob:Blob,work?:import('@/beta/attachment-progress').FileSourceWork)=>{
      const index=keys.indexOf(key);works.set(key,work);
      if(index<2){entered[index].resolve();await gates[index].promise;}
      if(work?.cancelled())throw{code:'selection_removed',message:'removed'};
      f.store.blobs.set(key,blob.slice());work?.progress('copying',blob.size,blob.size);
    });
    const draft=f.create(),adding=draft.addFiles('p',[file('first.bin'),file('second.bin'),file('queued.png')]);
    await Promise.all(entered.map(item=>item.promise));
    const selected=draft.snapshot().drafts.p.files!,first=selected[0],queued=selected[2];
    expect(draft.snapshot().fileProgress[queued.id]).toMatchObject({phase:'queued',queue:{kind:'queued',stage:'preparation',position:1}});

    draft.removeFile('p',first.id);draft.removeFile('p',queued.id);
    expect(works.get(keys[0])?.signal?.aborted).toBe(true);
    gates[0].resolve();gates[1].resolve();await adding;
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.[0].state).toBe('verified'));
    expect(f.store.put.mock.calls.map(([key])=>key)).not.toContain(keys[2]);
    expect(f.api.begin.mock.calls.map(([command])=>command.stage_id)).toEqual(['id-4']);
    expect(draft.snapshot().fileProgress[queued.id]).toBeUndefined();
    expect(f.client.capture).not.toHaveBeenCalled();
    draft.dispose();
  });
  it('shows upload queue position and cancels queued and active uploads before Capture',async()=>{
    const f=fixture(),gates=[deferred<void>(),deferred<void>()],entered=[deferred<void>(),deferred<void>()];
    const blockedStages=new Map([['id-2',0],['id-4',1]]),write=f.api.write.getMockImplementation()!;
    f.api.write.mockImplementation(async(profile,id,offset,bytes)=>{
      const slot=blockedStages.get(id);
      if(slot!==undefined&&offset===0){entered[slot].resolve();await gates[slot].promise;}
      return write(profile,id,offset,bytes);
    });
    const draft=f.create(),adding=draft.addFiles('p',[file('first.png'),file('second.png'),file('queued.png')]);
    await Promise.all(entered.map(item=>item.promise));await adding;
    const selected=draft.snapshot().drafts.p.files!,first=selected[0],queued=selected[2];
    expect(draft.snapshot().fileProgress[queued.id]).toMatchObject({phase:'queued',queue:{kind:'queued',stage:'upload',position:1}});

    draft.removeFile('p',first.id);draft.removeFile('p',queued.id);
    gates[0].resolve();gates[1].resolve();
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.[0].state).toBe('verified'));
    expect(f.api.write.mock.calls.some(([,id])=>id==='id-6')).toBe(false);
    expect(f.client.capture).not.toHaveBeenCalled();
    expect(draft.snapshot().fileProgress[queued.id]).toBeUndefined();
    draft.dispose();
  });
  it('retries a failed attachment on the same source and stage identity before one capture',async()=>{
    const f=fixture(),firstKey=JSON.stringify(['device-a','p','id-1']),stageId='id-2';
    const draft=f.create(async()=>{});let sourceFailed=false,stageFailed=false;
    f.store.put.mockImplementation(async(key,blob)=>{
      if(key===firstKey&&!sourceFailed){sourceFailed=true;throw{code:'source_store_unavailable',message:'transient local failure'};}
      f.store.blobs.set(key,blob.slice());
    });
    const write=f.api.write.getMockImplementation()!;
    f.api.write.mockImplementation(async(profile,id,offset,bytes)=>{
      if(id===stageId&&!stageFailed){stageFailed=true;throw{code:'network_error',message:'transient stage failure'};}
      return write(profile,id,offset,bytes);
    });
    await draft.addFiles('p',[file('retry-first.png'),file('next.png')]);
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.every(item=>item.state==='verified')).toBe(true));
    expect(f.store.put.mock.calls.filter(([key])=>key===firstKey)).toHaveLength(2);
    expect(f.api.begin.mock.calls.filter(([command])=>command.stage_id===stageId)).toHaveLength(2);
    expect(f.api.write.mock.calls.filter(([,id])=>id===stageId)).toHaveLength(2);
    expect(f.client.capture).not.toHaveBeenCalled();

    draft.setDraft('p','synthetic batch');await draft.submit('p');
    expect(f.client.capture).toHaveBeenCalledTimes(1);
    expect(f.client.capture.mock.calls[0][0].originals).toHaveLength(2);
    draft.dispose();
  });
  it('never captures a batch when one concurrent attachment permanently fails',async()=>{
    const f=fixture(),write=f.api.write.getMockImplementation()!;
    f.api.write.mockImplementation(async(profile,id,offset,bytes)=>{
      if(id==='id-2')throw{code:'invalid_request',message:'permanent synthetic rejection'};
      return write(profile,id,offset,bytes);
    });
    const draft=f.create();draft.setDraft('p','one atomic capture');
    await draft.addFiles('p',[file('rejected.bin'),file('ready.png')]);
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.map(item=>item.state).sort()).toEqual(['failed','verified']));

    await draft.submit('p');
    expect(f.client.capture).not.toHaveBeenCalled();
    expect(draft.snapshot().pending.at(-1)).toMatchObject({state:'failed',command:{text:'one atomic capture',originals:[expect.any(Object),expect.any(Object)]}});
    expect(draft.snapshot().drafts.p.files).toHaveLength(2);
    draft.dispose();
  });
  it('keeps the Capture single and waits for all concurrent upload workers',async()=>{
    const f=fixture(),largeGate=deferred<void>(),largeEntered=deferred<void>(),write=f.api.write.getMockImplementation()!,largeStage='id-2';
    f.api.write.mockImplementation(async(profile,id,offset,bytes)=>{
      if(id===largeStage&&offset===0){largeEntered.resolve();await largeGate.promise;}
      return write(profile,id,offset,bytes);
    });
    const draft=f.create();draft.setDraft('p','one batch');
    await draft.addFiles('p',[file('large.bin',[new Uint8Array(1024*1024)])]);
    await largeEntered.promise;
    await draft.addFiles('p',[new File([new Uint8Array([1,2,3])],'image.png',{type:'image/png'})]);
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.find(item=>item.file_name==='image.png')?.state).toBe('verified'));
    expect(draft.snapshot().drafts.p.files?.find(item=>item.file_name==='large.bin')?.state).toBe('uploading');
    const submitting=draft.submit('p');
    expect(f.client.capture).not.toHaveBeenCalled();
    largeGate.resolve();await submitting;
    expect(f.client.capture).toHaveBeenCalledTimes(1);
    expect(f.client.capture.mock.calls[0][0].originals).toHaveLength(2);
    draft.dispose();
  });
  it('cancels an unsubmitted pre-send when new text arrives and restores its files into the editable draft',async()=>{
    const f=fixture(),gate=deferred<void>(),entered=deferred<void>(),write=f.api.write.getMockImplementation()!;
    f.api.write.mockImplementation(async(profile,id,offset,bytes)=>{
      if(offset===0){entered.resolve();await gate.promise;}
      return write(profile,id,offset,bytes);
    });
    const draft=f.create();draft.setDraft('p','original queued text');
    await draft.addFiles('p',[file('queued.bin',[new Uint8Array(1024*1024)])]);
    await entered.promise;
    const firstSend=draft.submit('p');
    const original=draft.snapshot().pending[0];
    expect(original.capture_attempted).toBe(false);
    expect(f.client.capture).not.toHaveBeenCalled();

    expect(draft.setDraft('p','new input')).toBe(true);

    expect(draft.snapshot().pending).toEqual([]);
    expect(draft.snapshot().drafts.p.text).toBe('original queued text\n\nnew input');
    expect(draft.snapshot().drafts.p.files?.map(item=>item.file_name)).toEqual(['queued.bin']);
    gate.resolve();
    await expect(firstSend).resolves.toBeNull();
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.[0].state).toBe('verified'));
    expect(f.client.capture).not.toHaveBeenCalled();

    await draft.submit('p');
    expect(f.client.capture).toHaveBeenCalledTimes(1);
    expect(f.client.capture.mock.calls[0][0].text).toBe('original queued text\n\nnew input');
    expect(f.client.capture.mock.calls[0][0].originals).toHaveLength(1);
    draft.dispose();
  });
  it('retries a transient 72-image plus HTML batch with the same source and stage identities before one capture',async()=>{
    const f=fixture();
    f.store.put.mockImplementationOnce(async()=>{throw{code:'source_store_unavailable',message:'synthetic transient local copy error'};});
    f.api.write.mockRejectedValueOnce({code:'network_error',message:'synthetic stage connection reset'});
    const sizes=Array.from({length:72},(_,index)=>61_880+(index<42?1:0));
    const images=sizes.map((size,index)=>{
      const bytes=new Uint8Array(size);bytes.fill(index);
      return new File([bytes],`${String(index).padStart(2,'0')}-synthetic.webp`,{type:'image/webp'});
    });
    const htmlBytes=new Uint8Array(17*1024).fill(60),html=new File([htmlBytes],'synthetic-index.html',{type:'text/html'});
    const draft=f.create();

    await draft.addFiles('p',[...images,html]);
    const stagedBeforeSubmit=draft.snapshot().drafts.p.files!;
    expect(stagedBeforeSubmit).toHaveLength(73);
    expect(stagedBeforeSubmit[72].file_name).toBe('synthetic-index.html');
    const receipt=await draft.submit('p');

    expect(receipt).not.toBeNull();
    expect(f.client.capture).toHaveBeenCalledTimes(1);
    const command=f.client.capture.mock.calls[0][0];
    expect(command.originals).toHaveLength(73);
    expect(command.originals?.at(-1)).toMatchObject({file_name:'synthetic-index.html',byte_length:17*1024,media_type:'text/html'});
    expect(f.api.verify).toHaveBeenCalledTimes(73);
    expect(f.api.write).toHaveBeenCalledTimes(74);
    expect(f.store.put).toHaveBeenCalledTimes(74);
    const sourceKeys=f.store.put.mock.calls.map(([key])=>key),stageIds=f.api.begin.mock.calls.map(([command])=>command.stage_id);
    expect(new Set(sourceKeys).size).toBe(73);
    expect(new Set(stageIds).size).toBe(73);
    expect(sourceKeys.filter(key=>key===JSON.stringify(['device-a','p','id-1']))).toHaveLength(2);
    expect(stageIds.length).toBeGreaterThan(new Set(stageIds).size);
    expect(draft.snapshot().drafts.p.files).toEqual([]);
  });
  it('retains the selected File handle so an exhausted local-copy retry does not require reselect',async()=>{
    const f=fixture(),delays:number[]=[],draft=f.create(async milliseconds=>{delays.push(milliseconds);}),sameFile=file('same-selection.webp',['same bytes']);
    f.store.put.mockImplementation(async()=>{throw{code:'source_store_unavailable',message:'synthetic transient local copy error'};});

    const [id]=await draft.addFiles('p',[sameFile]);

    expect(draft.snapshot().drafts.p.files?.[0]).toMatchObject({id,state:'failed',file_name:'same-selection.webp'});
    expect(f.store.put).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([250,500,1000]);
    expect(draft.hasRetainedFileSource('p',id)).toBe(true);
    f.store.put.mockImplementation(async(key,source)=>{f.store.blobs.set(key,source.slice());});
    await draft.resumeFile('p',id);
    await vi.waitFor(()=>expect(draft.snapshot().drafts.p.files?.[0].state).toBe('verified'));
    expect(f.store.put.mock.calls[4][0]).toBe(f.store.put.mock.calls[0][0]);
    expect(draft.snapshot().drafts.p.files?.[0].id).toBe(id);
    expect(draft.hasRetainedFileSource('p',id)).toBe(false);
  });
  it('freezes A/B after the send enters the service, then keeps next-revision text and C separate',async()=>{
    const f=fixture(),captureGate=deferred<void>(),captureEntered=deferred<void>(),capture=f.client.capture.getMockImplementation()!;
    f.client.capture.mockImplementation(async command=>{captureEntered.resolve();await captureGate.promise;return capture(command);});
    const draft=f.create();draft.setDraft('p','same text');await draft.addFiles('p',[file('A'),file('B')]);
    const selected=draft.snapshot().drafts.p.files!;const sending=draft.submit('p');
    await captureEntered.promise;
    const original=draft.snapshot().pending[0].command;
    expect(draft.snapshot().pending[0].capture_attempted).toBe(true);
    draft.removeFile('p',selected[0].id);await draft.addFiles('p',[file('C')]);
    expect(draft.setDraft('p','same text')).toBe(false);
    const nextRevision=draft.snapshot().drafts.p.revision;
    captureGate.resolve();await sending;
    expect(f.client.capture).toHaveBeenCalledTimes(1);
    expect(f.client.capture.mock.calls[0][0]).toEqual(original);
    expect(original.originals?.map(item=>item.file_name)).toEqual(['A','B']);
    expect(draft.snapshot().drafts.p.text).toBe('same text');
    expect(draft.snapshot().drafts.p.files!.map(item=>item.file_name)).toEqual(['C']);
    expect(draft.snapshot().drafts.p.revision).toBe(nextRevision);
    const persisted=JSON.parse(f.storage.getItem('exomind:beta:drafts:device-a')!);
    expect(persisted.drafts.p.files.map((item:{file_name:string})=>item.file_name)).toEqual(['C']);
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
    const f=fixture();f.api.write.mockRejectedValueOnce({code:'invalid_request',message:'permanent synthetic request rejection'});
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
