import { invoke, isTauri } from '@tauri-apps/api/core';
import { BetaApiError } from './api-error';
import { ExistingBrowserIntentJournal, type LocalIntentJournal, type IntentPredecessor } from './local-intent-journal';

type NativeIntentInvoke=<T>(command:string,args:Record<string,unknown>)=>Promise<T>;
function nativeFailure(error:unknown):never{
  if(error instanceof BetaApiError)throw error;
  if(error&&typeof error==='object'&&'code'in error&&'message'in error&&typeof error.code==='string'&&typeof error.message==='string')throw new BetaApiError(error.code,error.message);
  throw new BetaApiError('native_intent_unavailable','本机私有草稿缓存不可用；不会改用浏览器缓存，请保留窗口并重试');
}
/** This is metadata only: no Core event, HTTP request, owner credential or
 * browser fallback. Host acknowledges its own SQLite transaction before return. */
export class NativeIntentJournal implements LocalIntentJournal {
  constructor(private readonly call:NativeIntentInvoke=invoke){}
  async read(key:string):Promise<string|null>{
    let raw:unknown;try{raw=await this.call('beta_read_local_intent',{key});}catch(error){return nativeFailure(error);}
    if(raw!==null&&typeof raw!=='string')throw new BetaApiError('invalid_native_intent','本机草稿读取响应无效，已停止恢复');
    return raw;
  }
  async write(key:string,raw:string):Promise<void>{
    let acknowledgement:unknown;try{acknowledgement=await this.call('beta_write_local_intent',{key,raw});}catch(error){return nativeFailure(error);}
    if(acknowledgement!==null&&acknowledgement!==undefined)throw new BetaApiError('invalid_native_intent','本机草稿写入未得到有效确认，尚未发送');
  }
}
let primary:NativeIntentJournal|undefined;
let predecessor:ExistingBrowserIntentJournal|undefined;
export function nativeIntentStorage(){
  primary??=new NativeIntentJournal();predecessor??=new ExistingBrowserIntentJournal();
  return{journal:primary,predecessor};
}
export function productionIntentStorage():{journal?:LocalIntentJournal;predecessor?:IntentPredecessor}{return isTauri()?nativeIntentStorage():{};}
