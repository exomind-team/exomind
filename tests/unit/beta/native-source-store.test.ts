// @vitest-environment node
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {NativeFileSourceStore,productionFileSources} from '@/beta/native-source-store';
import {hashFileSource,readFileSource} from '@/beta/file-source-store';
import {BetaDraftController} from '@/beta/drafts';
import type {SharedHandoffAttachmentFile} from '@/beta/native-attachment-types';
import {deferred,fakeClient,memoryStorage} from './fixtures';
const platform=vi.hoisted(()=>({native:false,invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',async(original)=>({...await original<typeof import('@tauri-apps/api/core')>(),isTauri:()=>platform.native,invoke:platform.invoke}));
afterEach(()=>{vi.unstubAllGlobals();platform.native=false;platform.invoke.mockReset();});
const key=JSON.stringify(['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003']);
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const ready=(bytes:Uint8Array,generation=7)=>({key,byte_length:bytes.length,sha256:digest(bytes),next_offset:bytes.length,generation,state:'ready'});
describe('bounded Native source storage',()=>{
  it('waits for a real ready acknowledgement and sends only bounded chunks',async()=>{
    const bytes=new Uint8Array(256*1024+17);bytes[0]=0;bytes[1]=255;const gate=deferred<unknown>();const lengths:number[]=[];
    const call=vi.fn(async(name:string,args:Record<string,unknown>)=>{if(name==='beta_begin_local_source')return{...ready(bytes),next_offset:0,state:'copying'};if(name==='beta_write_local_source_chunk'){const part=args.bytes as number[];lengths.push(part.length);return{...ready(bytes),next_offset:Number(args.offset)+part.length,state:'copying'};}if(name==='beta_finish_local_source')return gate.promise;throw Error('unexpected call');});
    const store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);let completed=false;const pending=store.put(key,new Blob([bytes])).then(()=>completed=true);
    await vi.waitFor(()=>expect(call).toHaveBeenCalledWith('beta_finish_local_source',{key}));expect(completed).toBe(false);expect(lengths).toEqual([256*1024,17]);gate.resolve(ready(bytes));await pending;expect(completed).toBe(true);
  });
  it('uses bounded JSON base64 chunks for Android Tauri instead of Raw IPC',async()=>{
    platform.native=true;vi.stubGlobal('navigator',{userAgent:'Mozilla/5.0 (Linux; Android 15; Tauri)'});
    const bytes=new Uint8Array(256*1024+17);for(let index=0;index<bytes.length;index++)bytes[index]=index%251;
    const stored=new Uint8Array(bytes.length),chunks:Array<{offset:number;encoded:string}>=[];
    platform.invoke.mockImplementation(async(name:string,args?:Record<string,unknown>,options?:unknown)=>{
      if(name==='beta_begin_local_source')return{...ready(bytes),state:'copying',next_offset:0};
      if(name==='beta_write_local_source_base64'){
        const offset=Number(args?.offset),encoded=String(args?.bytesBase64),decoded=new Uint8Array(Buffer.from(encoded,'base64'));
        chunks.push({offset,encoded});stored.set(decoded,offset);
        return{...ready(bytes),state:'copying',next_offset:offset+decoded.length};
      }
      if(name==='beta_finish_local_source')return ready(bytes);
      throw new Error(`unexpected Android IPC ${name} ${String(options)}`);
    });
    const store=productionFileSources();await store.put(key,new Blob([bytes]));
    expect(chunks.map(chunk=>chunk.offset)).toEqual([0,256*1024]);
    expect(chunks.every(chunk=>chunk.encoded.length<=Math.ceil(256*1024/3)*4)).toBe(true);
    expect(stored).toEqual(bytes);
    expect(platform.invoke.mock.calls.some(([name])=>name==='beta_write_local_source_binary')).toBe(false);
  });
  it('imports a share handoff by opaque IDs into a Native local source key without exposing a path',async()=>{
    const bytes=new Uint8Array([1,2,3,4]);let onProgress:((event:{payload:unknown})=>void)|undefined;
    const listener=vi.fn(async(_event:string,handler:(event:{payload:unknown})=>void)=>{onProgress=handler;return vi.fn();});
    const call=vi.fn(async(name:string,args:Record<string,unknown>)=>{
      if(name==='beta_import_share_handoff_item'){
        onProgress?.({payload:{request_id:String(args.request_id),handoff_id:'handoff-1',item_id:'item-1',phase:'copying',completed:4,total:4}});
        return ready(bytes);
      }
      throw new Error(`unexpected share import command ${name}`);
    });
    const store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0],undefined,listener as ConstructorParameters<typeof NativeFileSourceStore>[2]);
    const shared:SharedHandoffAttachmentFile={kind:'shared_handoff_file',handoffId:'handoff-1',itemId:'item-1',profileId:'profile-a',name:'shared.png',size:bytes.length,type:'image/png'};
    const work={cancelled:()=>false,progress:vi.fn()};

    await store.importSharedHandoff(key,shared,work);

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe('beta_import_share_handoff_item');
    expect(call.mock.calls[0][1]).toMatchObject({source_key:key,handoff_id:'handoff-1',item_id:'item-1',profile_id:'profile-a',expected_size:4,request_id:expect.any(String)});
    expect(call.mock.calls[0][1]).not.toHaveProperty('path');
    expect(work.progress).toHaveBeenCalledWith('copying',4,4);
  });
  it('cancels the matching Native share import when its draft attachment is removed',async()=>{
    const bytes=new Uint8Array([1,2,3,4]),gate=deferred<unknown>();let requestId='';
    const call=vi.fn(async(name:string,args:Record<string,unknown>)=>{
      if(name==='beta_import_share_handoff_item'){requestId=String(args.request_id);return gate.promise;}
      if(name==='beta_cancel_attachment_work')return true;
      throw new Error(`unexpected share import command ${name}`);
    });
    const listener=vi.fn(async()=>vi.fn()),store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0],undefined,listener as ConstructorParameters<typeof NativeFileSourceStore>[2]);
    const shared:SharedHandoffAttachmentFile={kind:'shared_handoff_file',handoffId:'handoff-1',itemId:'item-1',profileId:'profile-a',name:'shared.png',size:bytes.length,type:'image/png'};
    const abort=new AbortController(),work={signal:abort.signal,cancelled:()=>abort.signal.aborted,progress:vi.fn()};
    const pending=store.importSharedHandoff(key,shared,work);
    await vi.waitFor(()=>expect(call).toHaveBeenCalledWith('beta_import_share_handoff_item',expect.objectContaining({request_id:expect.any(String)})));
    abort.abort();
    await vi.waitFor(()=>expect(call).toHaveBeenCalledWith('beta_cancel_attachment_work',{requestId}));
    gate.resolve(ready(bytes));
    await expect(pending).rejects.toMatchObject({code:'selection_removed'});
  });
  it('returns a range reader and hashes a 96 MiB source without any whole-file request',async()=>{
    const size=96*1024*1024,lengths:number[]=[],expected=createHash('sha256');const block=new Uint8Array(256*1024);for(let offset=0;offset<size;offset+=block.length)expected.update(block);
    const sha=await hashFileSource({size,read:async(_offset,length)=>{lengths.push(length);return new Uint8Array(length);}});expect(sha).toBe(expected.digest('hex'));expect(lengths.length).toBe(384);expect(Math.max(...lengths)).toBe(256*1024);
    const bytes=new Uint8Array([0,255,137]);const call=vi.fn(async(name:string)=>name==='beta_local_source_status'?ready(bytes):Array.from(bytes));const store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);const source=await store.get(key);expect(source).not.toBeInstanceOf(Blob);expect(source&&await readFileSource(source,0,3)).toEqual(bytes);
  });
  it('rejects malformed byte arrays, unsafe u64 fields and changed full-source content',async()=>{
    const bytes=new Uint8Array([1,2]);const call=vi.fn(async(name:string)=>name==='beta_local_source_status'?ready(bytes):[1,256]);const store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);const source=await store.get(key);await expect(readFileSource(source!,0,2)).rejects.toMatchObject({code:'invalid_native_source'});
    call.mockImplementation(async()=>({...ready(bytes),generation:Number.MAX_SAFE_INTEGER+1}));await expect(store.get(key)).rejects.toMatchObject({code:'invalid_native_source'});
    await expect(hashFileSource({size:2,sha256:digest(bytes),read:async()=>new Uint8Array([3,4])})).rejects.toMatchObject({code:'source_corrupt'});
  });
  it('uses the consumed reader generation for cleanup and never fetches a newer generation',async()=>{
    const bytes=new Uint8Array([1]);const call=vi.fn(async(name:string)=>name==='beta_local_source_status'?ready(bytes,7):null);const store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);const source=await store.get(key);await store.remove(key,source!);expect(call).toHaveBeenLastCalledWith('beta_remove_local_source',{key,generation:7});expect(call.mock.calls.filter(([name])=>name==='beta_local_source_status')).toHaveLength(1);await expect(store.remove(key)).rejects.toMatchObject({code:'source_cleanup_deferred'});expect(call).toHaveBeenCalledTimes(2);
  });
  it('never falls back to IDB on Native failure and preserves the whole failed A/B selection',async()=>{
    platform.native=true;const open=vi.fn(()=>{throw Error('IDB fallback prohibited');});vi.stubGlobal('indexedDB',{open});platform.invoke.mockRejectedValue({code:'local_source_unavailable',message:'synthetic Native failure'});const store=productionFileSources();expect(store).toBeInstanceOf(NativeFileSourceStore);await expect(store.get(key)).rejects.toMatchObject({code:'local_source_unavailable'});expect(open).not.toHaveBeenCalled();
    const client={...fakeClient(),originals:{begin:vi.fn(),status:vi.fn(),write:vi.fn(),verify:vi.fn(),readStage:vi.fn(),readOriginal:vi.fn()}};const owner=new BetaDraftController(client,'device',memoryStorage());await owner.addFiles('profile',[new File(['A'],'A.bin'),new File(['B'],'B.bin')]);expect(owner.snapshot().drafts.profile.files).toHaveLength(2);expect(owner.snapshot().drafts.profile.files?.every(file=>file.state==='failed')).toBe(true);await expect(owner.submit('profile')).rejects.toMatchObject({code:'original_preparing'});expect(client.capture).not.toHaveBeenCalled();expect(client.originals.begin).not.toHaveBeenCalled();owner.dispose();
  });
  it('does not dispatch another Native operation after a late response to a closed store',async()=>{
    const bytes=new Uint8Array([1]),gate=deferred<unknown>();const call=vi.fn(async()=>gate.promise);const store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);const pending=store.get(key);store.close();gate.resolve(ready(bytes));await expect(pending).rejects.toMatchObject({code:'inactive_session'});expect(call).toHaveBeenCalledTimes(1);
  });
  it('resumes complete private bytes after interrupted verification without any new source put',async()=>{
    const bytes=new Uint8Array([1,2]);let state='frozen';const call=vi.fn(async(name:string)=>{if(name==='beta_finish_local_source'){state='ready';return ready(bytes);}if(name==='beta_local_source_status')return{...ready(bytes),state};return Array.from(bytes);});const store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);await store.resume(key);const source=await store.get(key);expect(await hashFileSource(source!)).toBe(digest(bytes));expect(call.mock.calls.some(([name])=>name==='beta_begin_local_source'||name==='beta_write_local_source_chunk')).toBe(false);
  });
});

describe('explicit source replacement',()=>{
  function damaged(initial:'hash_mismatch'|'ready'){
    const bytes=new Uint8Array(256*1024+17).map((_,index)=>index%256),sha256=digest(bytes);let stored=new Uint8Array(bytes.length).fill(137),state:string=initial,generation=7,next_offset=bytes.length;
    const status=()=>({key,byte_length:bytes.length,sha256,next_offset,generation,state});
    const call=vi.fn(async(name:string,args:Record<string,unknown>)=>{
      if(name==='beta_begin_local_source'){
        const command=args.command as {key:string;byte_length:number;sha256:string};if(command.key!==key||command.byte_length!==bytes.length||command.sha256!==sha256)throw{code:'local_source_conflict',message:'immutable source identity'};
        if(state==='released'){state='copying';next_offset=0;generation++;stored=new Uint8Array(bytes.length);}return status();
      }
      if(name==='beta_remove_local_source'){if(args.generation!==generation)throw{code:'local_source_conflict',message:'newer generation retained'};state='released';next_offset=0;generation++;return null;}
      if(name==='beta_write_local_source_chunk'){const part=args.bytes as number[];if(state!=='copying'||args.offset!==next_offset||part.length>256*1024)throw Error('copy boundary');stored.set(part,next_offset);next_offset+=part.length;generation++;return status();}
      if(name==='beta_finish_local_source'){if(next_offset!==bytes.length)throw Error('incomplete');if(state==='ready'&&digest(stored)!==sha256)throw{code:'local_source_corrupt',message:'damaged chunk'};if(digest(stored)!==sha256){state='hash_mismatch';throw{code:'local_source_hash_mismatch',message:'wrong bytes retained'};}state='ready';generation++;return status();}
      if(name==='beta_local_source_status')return status();
      if(name==='beta_read_local_source_range'){if(state==='ready'&&digest(stored)!==sha256)throw{code:'local_source_corrupt',message:'damaged chunk'};return Array.from(stored.subarray(Number(args.offset),Number(args.offset)+Number(args.length)));}
      throw Error(`unexpected command ${name}`);
    });
    return{bytes,sha256,call,status,storedDigest:()=>digest(stored)};
  }
  it.each(['hash_mismatch','ready'] as const)('explicit correct Blob repairs a damaged %s source under its same immutable key',async initial=>{
    const backend=damaged(initial),store=new NativeFileSourceStore(backend.call as ConstructorParameters<typeof NativeFileSourceStore>[0]);await store.put(key,new Blob([backend.bytes]));
    expect(backend.call).toHaveBeenCalledWith('beta_remove_local_source',{key,generation:7});expect(backend.status().state).toBe('ready');expect(backend.status().generation).toBeGreaterThan(7);expect(backend.storedDigest()).toBe(backend.sha256);
    if(initial==='ready')expect(backend.call.mock.calls.slice(0,2).map(([name])=>name)).toEqual(['beta_begin_local_source','beta_finish_local_source']);
    const writes=backend.call.mock.calls.filter(([name])=>name==='beta_write_local_source_chunk');expect(writes.map(([,args])=>(args.bytes as number[]).length)).toEqual([256*1024,17]);const source=await store.get(key);expect(await hashFileSource(source!)).toBe(backend.sha256);
  });
  it.each(['hash_mismatch','ready'] as const)('wrong same-length Blob performs zero deletion of the existing %s source',async initial=>{
    const backend=damaged(initial),store=new NativeFileSourceStore(backend.call as ConstructorParameters<typeof NativeFileSourceStore>[0]),before={...backend.status(),stored:backend.storedDigest()},wrong=backend.bytes.map(byte=>byte^255);await expect(store.put(key,new Blob([wrong]))).rejects.toMatchObject({code:'local_source_conflict'});
    expect(backend.call.mock.calls.some(([name])=>name==='beta_finish_local_source'||name==='beta_remove_local_source'||name==='beta_write_local_source_chunk')).toBe(false);expect({...backend.status(),stored:backend.storedDigest()}).toEqual(before);
  });
  it('keeps a normal Copying prefix and does not clear it for an explicit continuation',async()=>{
    const bytes=new Uint8Array(256*1024+17);const call=vi.fn(async(name:string,args:Record<string,unknown>)=>{if(name==='beta_begin_local_source')return{...ready(bytes),state:'copying',next_offset:256*1024};if(name==='beta_write_local_source_chunk')return{...ready(bytes),state:'copying'};if(name==='beta_finish_local_source')return ready(bytes);throw Error(`unexpected ${name}`);});const store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);await store.put(key,new Blob([bytes]));expect(call).toHaveBeenCalledWith('beta_write_local_source_chunk',{key,offset:256*1024,bytes:Array.from(bytes.subarray(256*1024))});expect(call.mock.calls.some(([name])=>name==='beta_remove_local_source')).toBe(false);
  });
  it('stops on a stale replacement CAS instead of fetching and deleting a newer copy',async()=>{
    const bytes=new Uint8Array([1,2]);const call=vi.fn(async(name:string)=>{if(name==='beta_begin_local_source'||name==='beta_local_source_status')return ready(bytes,7);if(name==='beta_finish_local_source'||name==='beta_read_local_source_range')throw{code:'local_source_corrupt',message:'bad old chunk'};if(name==='beta_remove_local_source')throw{code:'local_source_conflict',message:'newer copy retained'};throw Error('unexpected dispatch');});const store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);await expect(store.put(key,new Blob([bytes]))).rejects.toMatchObject({code:'local_source_conflict'});expect(call).toHaveBeenLastCalledWith('beta_remove_local_source',{key,generation:7});expect(call.mock.calls.filter(([name])=>name==='beta_begin_local_source')).toHaveLength(1);
  });
  function healthy(verificationError?:{code:string;message:string}){
    const bytes=new Uint8Array([0,255,137,42]);let retained=true,begins=0;const call=vi.fn(async(name:string,args:Record<string,unknown>)=>{
      if(name==='beta_begin_local_source'){if(++begins>1)throw{code:'local_source_unavailable',message:'synthetic failure before replacement copy'};return ready(bytes);}
      if(name==='beta_finish_local_source'){if(verificationError)throw verificationError;return ready(bytes);}
      if(name==='beta_local_source_status')return ready(bytes);
      if(name==='beta_read_local_source_range'){if(!retained)throw{code:'local_source_incomplete',message:'copy was deleted'};return Array.from(bytes.subarray(Number(args.offset),Number(args.offset)+Number(args.length)));}
      if(name==='beta_remove_local_source'){retained=false;return null;}
      throw Error(`unexpected ${name}`);
    });return{bytes,call,retained:()=>retained};
  }
  it('revalidates and reuses a healthy Ready generation without deletion or recopy',async()=>{
    const backend=healthy(),store=new NativeFileSourceStore(backend.call as ConstructorParameters<typeof NativeFileSourceStore>[0]),old=await store.get(key);await store.put(key,new Blob([backend.bytes]));expect(backend.call).toHaveBeenCalledWith('beta_finish_local_source',{key});expect(backend.call.mock.calls.some(([name])=>name==='beta_remove_local_source'||name==='beta_write_local_source_chunk')).toBe(false);expect(backend.retained()).toBe(true);expect(await hashFileSource(old!)).toBe(digest(backend.bytes));
  });
  it.each(['synthetic_unknown','stopped','forbidden','local_source_unavailable'])('verification error %s leaves the healthy Ready bytes intact',async code=>{
    const backend=healthy({code,message:'verification refused'}),store=new NativeFileSourceStore(backend.call as ConstructorParameters<typeof NativeFileSourceStore>[0]),old=await store.get(key);await expect(store.put(key,new Blob([backend.bytes]))).rejects.toMatchObject({code});expect(backend.call.mock.calls.some(([name])=>name==='beta_remove_local_source'||name==='beta_write_local_source_chunk')).toBe(false);expect(backend.retained()).toBe(true);expect(await hashFileSource(old!)).toBe(digest(backend.bytes));
  });
  it('does not erase healthy bytes when a Corrupt verification failure is outside their content',async()=>{
    const backend=healthy({code:'local_source_corrupt',message:'binding requires recovery'}),store=new NativeFileSourceStore(backend.call as ConstructorParameters<typeof NativeFileSourceStore>[0]);await expect(store.put(key,new Blob([backend.bytes]))).rejects.toMatchObject({code:'local_source_corrupt'});expect(backend.call.mock.calls.some(([name])=>name==='beta_remove_local_source')).toBe(false);expect(backend.retained()).toBe(true);
  });
  it('does not recreate a broken catalog when Ready verification and status require recovery',async()=>{
    const bytes=new Uint8Array([1]),call=vi.fn(async(name:string)=>{if(name==='beta_begin_local_source')return ready(bytes);if(name==='beta_finish_local_source'||name==='beta_local_source_status')throw{code:'local_source_corrupt',message:'catalog requires recovery'};throw Error('destructive command must not run');}),store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);await expect(store.put(key,new Blob([bytes]))).rejects.toMatchObject({code:'local_source_corrupt'});expect(call.mock.calls.some(([name])=>name==='beta_remove_local_source')).toBe(false);expect(call.mock.calls.filter(([name])=>name==='beta_begin_local_source')).toHaveLength(1);
  });
  it('preserves removal recovery errors and never begins a replacement around a broken catalog',async()=>{
    const bytes=new Uint8Array([1]),call=vi.fn(async(name:string)=>{if(name==='beta_begin_local_source'||name==='beta_local_source_status')return ready(bytes);if(name==='beta_finish_local_source'||name==='beta_read_local_source_range')throw{code:'local_source_corrupt',message:'damaged old chunk'};if(name==='beta_remove_local_source')throw{code:'local_source_corrupt',message:'remove requires recovery'};throw Error('unexpected destructive retry');}),store=new NativeFileSourceStore(call as ConstructorParameters<typeof NativeFileSourceStore>[0]);await expect(store.put(key,new Blob([bytes]))).rejects.toMatchObject({code:'local_source_corrupt',message:'remove requires recovery'});expect(call.mock.calls.filter(([name])=>name==='beta_begin_local_source')).toHaveLength(1);expect(call.mock.calls.filter(([name])=>name==='beta_remove_local_source')).toHaveLength(1);
  });
});
