import { invoke, isTauri } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';
import { hashFileSource, IndexedDbFileSourceStore, type FileSource, type FileSourceStore, type RangeFileSource } from './file-source-store';
import { ORIGINAL_CHUNK_BYTES } from './original-types';
type NativeCall = <T>(name:string,args:Record<string,unknown>)=>Promise<T>;
const MAX_NATIVE_SOURCE_BYTES=4*1024*1024*1024; // Native private-source/1 policy; Host independently enforces it.
interface Info { key:string; byte_length:number; sha256:string; next_offset:number; generation:number; state:'copying'|'frozen'|'ready'|'hash_mismatch'|'released' }
const invalid=()=>new BetaApiError('invalid_native_source','本机原件暂存响应不一致，尚未提交记录');
function info(value:unknown,key:string):Info{
  if(!value||typeof value!=='object')throw invalid();const row=value as Info;
  if(row.key!==key||!Number.isSafeInteger(row.byte_length)||row.byte_length<0||row.byte_length>MAX_NATIVE_SOURCE_BYTES||!Number.isSafeInteger(row.next_offset)||row.next_offset<0||row.next_offset>row.byte_length||!Number.isSafeInteger(row.generation)||row.generation<1||!/^[a-f0-9]{64}$/.test(row.sha256)||!['copying','frozen','ready','hash_mismatch','released'].includes(row.state)||(['frozen','ready','hash_mismatch'].includes(row.state)&&row.next_offset!==row.byte_length)||(row.state==='released'&&row.next_offset!==0)||(row.state==='copying'&&row.next_offset!==row.byte_length&&row.next_offset%ORIGINAL_CHUNK_BYTES!==0))throw invalid();return Object.freeze({...row});
}
class NativeSource implements RangeFileSource {
  readonly size:number;
  readonly sha256:string;
  constructor(readonly descriptor:Info,private readonly reader:(offset:number,length:number)=>Promise<Uint8Array>){this.size=descriptor.byte_length;this.sha256=descriptor.sha256;}
  read(offset:number,length:number){return this.reader(offset,length);}
}
/** Native private bytes never degrade to IDB. get returns a bounded reader,
 * not a whole-file Blob assembled from native ranges. */
export class NativeFileSourceStore implements FileSourceStore {
  private closed=false;
  constructor(private readonly call:NativeCall=invoke){}
  private active(){if(this.closed)throw new BetaApiError('inactive_session','原件暂存窗口已关闭');}
  private async rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{this.active();try{const value=await this.call<T>(name,args);this.active();return value;}catch(error){if(error instanceof BetaApiError)throw error;if(error&&typeof error==='object'&&'code'in error&&'message'in error&&typeof error.code==='string'&&typeof error.message==='string')throw new BetaApiError(error.code,error.message);throw new BetaApiError('local_source_unavailable','本机原件暂存未确认；不会改用浏览器缓存，请保留源文件后重试');}}
  async put(key:string,source:Blob):Promise<void>{
    this.active();if(!Number.isSafeInteger(source.size)||source.size<0||source.size>MAX_NATIVE_SOURCE_BYTES)throw new BetaApiError('payload_too_large','本机单个原件暂存上限为 4 GiB，请保留源文件');const sha256=await hashFileSource(source,()=>this.closed);this.active();const command={key,byte_length:source.size,sha256};let current=info(await this.rpc('beta_begin_local_source',{command}),key);
    const bind=(next:unknown)=>{const value=info(next,key);if(value.byte_length!==source.size||value.sha256!==sha256)throw invalid();return value;};current=bind(current);
    let rebuild=current.state==='hash_mismatch';
    if(current.state==='ready'){
      try{
        const verified=bind(await this.rpc('beta_finish_local_source',{key}));
        if(verified.state!=='ready'||verified.generation!==current.generation)throw new BetaApiError('local_source_conflict','原件副本在校验时已变化；未删除新副本，请重试');
        current=verified;
      }catch(error){
        if(!(error instanceof BetaApiError)||!['local_source_hash_mismatch','local_source_corrupt'].includes(error.code))throw error;
        const observed=bind(await this.rpc('beta_local_source_status',{key}));
        if(observed.generation!==current.generation||!['ready','hash_mismatch'].includes(observed.state))throw new BetaApiError('local_source_conflict','原件副本在校验时已变化；未删除新副本，请重试');
        if(error.code==='local_source_corrupt'&&observed.state==='ready'){
          // Corrupt also covers catalog/binding faults. A readable, healthy
          // copy is preserved even if its verifier failed for another reason.
          // Probe only bounded ranges; schema/permission/stop failures must not
          // turn into a request to initialize a replacement database.
          let contentDamaged=false;
          try{await hashFileSource(this.rangeSource(observed),()=>this.closed);}
          catch(contentError){if(contentError instanceof BetaApiError&&['local_source_corrupt','source_corrupt'].includes(contentError.code))contentDamaged=true;else throw contentError;}
          if(!contentDamaged)throw error;
        }
        rebuild=true;
      }
    }
    if(rebuild){
      // Only an explicitly supplied, binding-matched Blob may rebuild proven
      // bad content. Keep the original generation; never delete a newer one.
      const previousGeneration=current.generation,result=await this.rpc<unknown>('beta_remove_local_source',{key,generation:previousGeneration});if(result!==null&&result!==undefined)throw invalid();
      current=bind(await this.rpc('beta_begin_local_source',{command}));if(current.generation<=previousGeneration||current.state==='released'||current.state==='hash_mismatch')throw invalid();
    }
    while(current.state==='copying'&&current.next_offset<source.size){this.active();const offset=current.next_offset,length=Math.min(ORIGINAL_CHUNK_BYTES,source.size-offset),bytes=new Uint8Array(await source.slice(offset,offset+length).arrayBuffer());this.active();if(bytes.length!==length)throw new BetaApiError('source_incomplete','选择的原件未完整读取，请保留源文件');const next=bind(await this.rpc('beta_write_local_source_chunk',{key,offset,bytes:Array.from(bytes)}));if(next.next_offset!==offset+length)throw invalid();current=next;}
    if(current.state!=='ready')current=bind(await this.rpc('beta_finish_local_source',{key}));
    if(current.state!=='ready')throw invalid();
  }
  async get(key:string):Promise<FileSource|null>{
    const value=await this.rpc<unknown>('beta_local_source_status',{key});if(value===null)return null;const current=info(value,key);if(current.state==='released')return null;
    if(current.state!=='ready')throw new BetaApiError(current.state==='hash_mismatch'?'local_source_hash_mismatch':'source_incomplete','本机原件副本尚未完整确认，旧偏移已保留；请重新选择原文件继续复制');
    return this.rangeSource(current);
  }
  private rangeSource(current:Info):NativeSource{
    return new NativeSource(current,async(offset,length)=>{
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>ORIGINAL_CHUNK_BYTES||!Number.isSafeInteger(offset+length)||offset+length>current.byte_length)throw invalid();
      const bytes=await this.rpc<unknown>('beta_read_local_source_range',{key:current.key,offset,length});if(!Array.isArray(bytes)||bytes.length!==length||!bytes.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255))throw invalid();return Uint8Array.from(bytes);
    });
  }
  async resume(key:string):Promise<void>{
    const value=await this.rpc<unknown>('beta_local_source_status',{key});if(value===null)return;const current=info(value,key);
    // A process can stop after the last byte commit but before the verification
    // acknowledgement. Resume that accepted private copy without a new File.
    if(current.state==='frozen'||current.state==='copying'&&current.next_offset===current.byte_length){const sealed=info(await this.rpc('beta_finish_local_source',{key}),key);if(sealed.state!=='ready'||sealed.byte_length!==current.byte_length||sealed.sha256!==current.sha256)throw invalid();}
  }
  async remove(key:string,expected?:FileSource):Promise<void>{
    // Never re-read the latest generation here: cleanup can arrive after a
    // user explicitly starts a newer copy of the same immutable source key.
    if(!(expected instanceof NativeSource)||expected.descriptor.key!==key)throw new BetaApiError('source_cleanup_deferred','原件已暂存；未持有该代副本，清理已延后');
    const result=await this.rpc<unknown>('beta_remove_local_source',{key,generation:expected.descriptor.generation});if(result!==null&&result!==undefined)throw invalid();
  }
  close(){this.closed=true;}
}
export function productionFileSources():FileSourceStore{return isTauri()?new NativeFileSourceStore():new IndexedDbFileSourceStore();}
