import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { BetaApiError } from './api-error';
import { hashFileSource, IndexedDbFileSourceStore, type FileSource, type FileSourceStore, type RangeFileSource } from './file-source-store';
import { ORIGINAL_CHUNK_BYTES } from './original-types';
import type { FileSourceWork } from './attachment-progress';
import type { NativeAttachmentFile, NativeAttachmentSources, SharedHandoffAttachmentFile } from './native-attachment-types';
import type { BetaBeginStage } from './original-types';
import { validateStage } from './original-client';
import { runNativeAttachment } from './native-attachments';
import { betaUuid } from './initialization';
type NativeCall = <T>(name:string,args:Record<string,unknown>)=>Promise<T>;
type NativeListen = <T>(event:string,handler:(event:{payload:T})=>void)=>Promise<()=>void>;
interface ShareImportProgress { request_id:string;handoff_id:string;item_id:string;phase:'verifying'|'copying'|'ready';completed:number|null;total:number }
const MAX_NATIVE_SOURCE_BYTES=4*1024*1024*1024; // Native private-source/1 policy; Host independently enforces it.
const MAX_BASE64_SOURCE_CHUNK_BYTES=Math.ceil(ORIGINAL_CHUNK_BYTES/3)*4;
interface Info { key:string; byte_length:number; sha256:string; next_offset:number; generation:number; state:'copying'|'frozen'|'ready'|'hash_mismatch'|'released' }
const invalid=()=>new BetaApiError('invalid_native_source','本机原件暂存响应不一致，尚未提交记录');
export function encodeBase64SourceChunk(bytes:Uint8Array):string{
  if(bytes.length<1||bytes.length>ORIGINAL_CHUNK_BYTES)throw new BetaApiError('invalid_chunk','原件分块大小无效');
  if(typeof globalThis.btoa!=='function')throw new BetaApiError('unsupported_binary_encoding','当前 WebView 不支持安全的 Base64 原件传输');
  const parts:string[]=[];
  for(let offset=0;offset<bytes.length;offset+=8192){
    const end=Math.min(bytes.length,offset+8192);
    const characters=new Array<string>(end-offset);
    for(let index=offset;index<end;index++)characters[index-offset]=String.fromCharCode(bytes[index]);
    parts.push(characters.join(''));
  }
  const encoded=globalThis.btoa(parts.join(''));
  if(encoded.length>MAX_BASE64_SOURCE_CHUNK_BYTES)throw new BetaApiError('payload_too_large','Base64 原件分块超出 IPC 限制');
  return encoded;
}
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
export class NativeFileSourceStore implements NativeAttachmentSources {
  private closed=false;
  constructor(private readonly call:NativeCall=invoke,private readonly binaryWrite?: (key:string,offset:number,bytes:Uint8Array)=>Promise<unknown>,private readonly listenEvent:NativeListen=listen as unknown as NativeListen){}
  private active(){if(this.closed)throw new BetaApiError('inactive_session','原件暂存窗口已关闭');}
  private async rpc<T>(name:string,args:Record<string,unknown>):Promise<T>{this.active();try{const value=await this.call<T>(name,args);this.active();return value;}catch(error){if(error instanceof BetaApiError)throw error;if(error&&typeof error==='object'&&'code'in error&&'message'in error&&typeof error.code==='string'&&typeof error.message==='string')throw new BetaApiError(error.code,error.message);throw new BetaApiError('local_source_unavailable','本机原件暂存未确认；不会改用浏览器缓存，请保留源文件后重试');}}
  async put(key:string,source:Blob,work?:FileSourceWork):Promise<void>{
    const active=()=>{this.active();if(work?.cancelled())throw new BetaApiError('selection_removed','附件准备已取消');};
    active();if(!Number.isSafeInteger(source.size)||source.size<0||source.size>MAX_NATIVE_SOURCE_BYTES)throw new BetaApiError('payload_too_large','本机单个原件暂存上限为 4 GiB，请保留源文件');const sha256=await hashFileSource(source,()=>this.closed||!!work?.cancelled(),completed=>work?.progress('hashing',completed,source.size));active();const command={key,byte_length:source.size,sha256};let current=info(await this.rpc('beta_begin_local_source',{command}),key);
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
    work?.progress('copying',current.next_offset,source.size);
    while(current.state==='copying'&&current.next_offset<source.size){active();const offset=current.next_offset,length=Math.min(ORIGINAL_CHUNK_BYTES,source.size-offset),bytes=new Uint8Array(await source.slice(offset,offset+length).arrayBuffer());active();if(bytes.length!==length)throw new BetaApiError('source_incomplete','选择的原件未完整读取，请保留源文件');const next=bind(await(this.binaryWrite?this.binaryWrite(key,offset,bytes):this.rpc('beta_write_local_source_chunk',{key,offset,bytes:Array.from(bytes)})));if(next.next_offset!==offset+length)throw invalid();current=next;work?.progress('copying',current.next_offset,source.size);}
    active();if(current.state!=='ready'){work?.progress('verifying_source',null,source.size);current=bind(await this.rpc('beta_finish_local_source',{key}));}
    if(current.state!=='ready')throw invalid();
  }
  async get(key:string):Promise<FileSource|null>{
    const value=await this.rpc<unknown>('beta_local_source_status',{key});if(value===null)return null;const current=info(value,key);if(current.state==='released')return null;
    if(current.state!=='ready')throw new BetaApiError(current.state==='hash_mismatch'?'local_source_hash_mismatch':'source_incomplete','本机原件副本尚未完整确认，旧偏移已保留；请重新选择原文件继续复制');
    return this.rangeSource(current);
  }
  async importFile(key:string,file:NativeAttachmentFile,work:FileSourceWork):Promise<void>{
    this.active();if(work.cancelled())throw new BetaApiError('selection_removed','附件准备已取消');
    const result=info(await runNativeAttachment('beta_import_attachment_path',{key,path:file.path,expectedSize:file.size},work,this.rpc.bind(this)),key);
    if(result.state!=='ready'||result.byte_length!==file.size)throw invalid();
  }
  async importSharedHandoff(key:string,file:SharedHandoffAttachmentFile,work:FileSourceWork):Promise<void>{
    this.active();if(work.cancelled())throw new BetaApiError('selection_removed','附件准备已取消');
    if(!file.handoffId||!file.itemId||!file.profileId||!Number.isSafeInteger(file.size)||file.size<0||file.size>MAX_NATIVE_SOURCE_BYTES)throw new BetaApiError('invalid_share_handoff','系统分享附件身份或大小无效，原分享仍保留');
    const requestId=betaUuid();let stopProgress:(()=>void)|undefined,cancellation:Promise<unknown>|undefined;
    try{
      stopProgress=await this.listenEvent<ShareImportProgress>('beta-share-handoff-import-progress',event=>{
        const progress=event?.payload;
        if(!progress||progress.request_id!==requestId||progress.handoff_id!==file.handoffId||progress.item_id!==file.itemId||work.cancelled()
          ||!Number.isSafeInteger(progress.total)||progress.total<0||progress.total!==file.size
          ||progress.completed!==null&&(!Number.isSafeInteger(progress.completed)||progress.completed<0||progress.completed>progress.total)
          ||!['verifying','copying','ready'].includes(progress.phase))return;
        const phase=progress.phase==='copying'?'copying':'verifying_source';
        work.progress(phase,progress.completed,progress.total);
      });
    }catch{
      // Progress is observational. A listener failure must not lose the
      // original share; the bounded Native copy may still proceed.
      work.progress('copying',null,file.size);
    }
    const cancel=()=>{cancellation=this.call('beta_cancel_attachment_work',{requestId}).catch(()=>false);};
    work.signal?.addEventListener('abort',cancel,{once:true});
    try{
      if(work.cancelled()){
        cancel();
        await cancellation;
        throw new BetaApiError('selection_removed','附件准备已取消；系统分享原件仍保留');
      }
      const result=info(await this.rpc('beta_import_share_handoff_item',{
        handoff_id:file.handoffId,item_id:file.itemId,profile_id:file.profileId,source_key:key,expected_size:file.size,request_id:requestId,
      }),key);
      if(work.cancelled())throw new BetaApiError('selection_removed','附件准备已取消；系统分享原件仍保留');
      if(result.state!=='ready'||result.byte_length!==file.size)throw invalid();
    }finally{
      work.signal?.removeEventListener('abort',cancel);
      stopProgress?.();
      await cancellation;
    }
  }
  async verifySource(key:string,work:FileSourceWork):Promise<{size:number;sha256:string}>{
    this.active();if(work.cancelled())throw new BetaApiError('selection_removed','附件准备已取消');
    work.progress('verifying_source',null,0);
    const result=info(await this.rpc('beta_finish_local_source',{key}),key);if(result.state!=='ready')throw invalid();
    return{size:result.byte_length,sha256:result.sha256};
  }
  async stageLocalSource(key:string,command:BetaBeginStage,work:FileSourceWork){
    this.active();if(work.cancelled())throw new BetaApiError('selection_removed','附件准备已取消');
    const result=await runNativeAttachment<{stage:unknown;cleanup_confirmed:boolean}>('beta_stage_local_attachment',{key,command},work,this.rpc.bind(this));
    if(typeof result?.cleanup_confirmed!=='boolean')throw invalid();
    return{stage:validateStage(result.stage,command.profile_id,command.stage_id,command),cleanupConfirmed:result.cleanup_confirmed};
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
export function productionFileSources():FileSourceStore{
  if(!isTauri())return new IndexedDbFileSourceStore();
  const android=typeof navigator!=='undefined'&&/android/i.test(navigator.userAgent);
  const binaryWrite=android
    ? (key:string,offset:number,bytes:Uint8Array)=>invoke('beta_write_local_source_base64',{key,offset,bytesBase64:encodeBase64SourceChunk(bytes)})
    : (key:string,offset:number,bytes:Uint8Array)=>invoke('beta_write_local_source_binary',bytes,{headers:{'x-exomind-source-key':key,'x-exomind-source-offset':String(offset)}});
  return new NativeFileSourceStore(invoke,binaryWrite);
}
