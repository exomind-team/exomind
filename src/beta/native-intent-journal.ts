import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
  private readonly watchers = new Map<string,Set<()=>void>>();
  private listening: Promise<()=>void> | undefined;
  constructor(private readonly call:NativeIntentInvoke=invoke){}
  async read(key:string):Promise<string|null>{
    let raw:unknown;try{raw=await this.call('beta_read_local_intent',{key});}catch(error){return nativeFailure(error);}
    if(raw!==null&&typeof raw!=='string')throw new BetaApiError('invalid_native_intent','本机草稿读取响应无效，已停止恢复');
    return raw;
  }
  async write(key:string,raw:string):Promise<void>{
    // Initialization/migration is allowed only while the key is absent.
    // Live writers supply their exact committed baseline via compareWrite.
    return this.compareWrite(key,null,raw);
  }
  async compareWrite(key:string,expectedRaw:string|null,raw:string):Promise<void>{
    let acknowledgement:unknown;try{acknowledgement=await this.call('beta_compare_local_intent',{key,expectedRaw,raw});}catch(error){return nativeFailure(error);}
    if(acknowledgement!==null&&acknowledgement!==undefined)throw new BetaApiError('invalid_native_intent','本机草稿写入未得到有效确认，尚未发送');
  }
  subscribe(key:string,changed:()=>void):()=>void{
    let watchers=this.watchers.get(key);if(!watchers){watchers=new Set();this.watchers.set(key,watchers);}watchers.add(changed);
    this.listening??=listen<{keys:string[]}>('beta-native-intent-changed',event=>{
      if(Array.isArray(event.payload?.keys))for(const key of event.payload.keys)if(typeof key==='string')this.watchers.get(key)?.forEach(watcher=>watcher());
    });void this.listening.catch(()=>{});
    return()=>{watchers!.delete(changed);if(!watchers!.size)this.watchers.delete(key);};
  }
}
let primary:NativeIntentJournal|undefined;
let predecessor:ExistingBrowserIntentJournal|undefined;
export function nativeIntentStorage(){
  primary??=new NativeIntentJournal();predecessor??=new ExistingBrowserIntentJournal();
  return{journal:primary,predecessor};
}
export function productionIntentStorage():{journal?:LocalIntentJournal;predecessor?:IntentPredecessor}{return isTauri()?nativeIntentStorage():{};}
