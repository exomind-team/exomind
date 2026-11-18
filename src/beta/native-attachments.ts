import { Channel, invoke } from '@tauri-apps/api/core';
import type { FileSourceWork, AttachmentPhase } from './attachment-progress';
import type { NativeAttachmentFile } from './native-attachment-types';
import { BetaApiError } from './api-error';
import { betaUuid } from './initialization';

export function validateNativeFiles(value:unknown):NativeAttachmentFile[] {
  if(!Array.isArray(value)||value.length>128)throw new BetaApiError('invalid_file_selection','系统文件选择结果无效');
  return value.map(file=>{
    if(!file||typeof file!=='object'||typeof file.path!=='string'||!file.path||typeof file.name!=='string'||!file.name||!Number.isSafeInteger(file.size)||file.size<0||file.size>4*1024*1024*1024||typeof file.type!=='string')throw new BetaApiError('invalid_file_selection','系统文件描述无效，请重新选择');
    return {kind:'native_file',path:file.path,name:file.name,size:file.size,type:file.type};
  });
}
export async function describeNativeFiles(paths:string[]):Promise<NativeAttachmentFile[]> { return validateNativeFiles(await invoke('beta_describe_attachment_paths',{paths})); }
export async function pickNativeFiles(multiple:boolean):Promise<NativeAttachmentFile[]> { return validateNativeFiles(await invoke('beta_pick_attachment_files',{multiple})); }

export function nativeProgress(work:FileSourceWork):Channel<unknown> {
  const channel=new Channel<unknown>();
  channel.onmessage=value=>{
    if(work.cancelled()||!value||typeof value!=='object')return;
    const raw=value as {phase:AttachmentPhase;completed:number|null;total:number};
    if(!['queued','hashing','copying','verifying_source','reading_source','staging','verifying_stage'].includes(raw.phase)||!Number.isSafeInteger(raw.total)||raw.total<0||raw.completed!==null&&(!Number.isSafeInteger(raw.completed)||raw.completed<0||raw.completed>raw.total))return;
    work.progress(raw.phase,raw.completed,raw.total);
  };
  return channel;
}
export async function runNativeAttachment<T>(command:string,args:Record<string,unknown>,work:FileSourceWork,call:<R>(name:string,args:Record<string,unknown>)=>Promise<R>):Promise<T>{
  if(work.cancelled())throw new BetaApiError('selection_removed','附件准备已取消');
  const requestId=betaUuid();let cancellation:Promise<unknown>|undefined;
  const cancel=()=>{cancellation=call('beta_cancel_attachment_work',{requestId}).catch(()=>false);};
  work.signal?.addEventListener('abort',cancel,{once:true});
  try{return await call<T>(command,{...args,requestId,onProgress:nativeProgress(work)});}
  finally{work.signal?.removeEventListener('abort',cancel);await cancellation;}
}
