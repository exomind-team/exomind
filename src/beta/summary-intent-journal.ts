import { BetaApiError } from './api-error';
import { openDurableIntentStorage,type DurableIntentStorage,type LocalIntentJournal } from './local-intent-journal';
import { productionIntentStorage } from './native-intent-journal';
import { summaryUuid,validateSummaryControlCommand,validateSummaryReceipt,validateSummaryRequestCommand } from './summary-validation';
import type { BetaReceipt } from './client';
import type { SummaryControlCommand,SummaryRequestCommand } from './summary-types';

export type SummaryIntentKind='cancel'|'retry'|'resume'|'update'|'takeover'|'create';
export type SummarySavedIntent={operation:'control';kind:Exclude<SummaryIntentKind,'create'>;command:SummaryControlCommand;phase:'prepared'|'unknown'|'rejected'|'committed';receipt:BetaReceipt|null}|{operation:'request';kind:'create';command:SummaryRequestCommand;phase:'prepared'|'unknown'|'rejected'|'committed';receipt:BetaReceipt|null};
const MAX_ENTRIES=64,MAX_BYTES=1024*1024;
const invalid=():never=>{throw new BetaApiError('summary_intent_corrupt','本机回顾意图无法识别，原缓存保留；已停止新的付费请求，请重新读取或恢复本机资料');};
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const item=value as Record<string,unknown>;if(Object.keys(item).length!==keys.length||keys.some(key=>!Object.prototype.hasOwnProperty.call(item,key)))return invalid();return item;}
export function summaryIntentKey(deviceId:string,profileId:string):string{return'exomind:beta:summaries:'+JSON.stringify([summaryUuid(deviceId),summaryUuid(profileId)]);}
function frozen<T>(value:T):T{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))frozen(child);}return value;}
export function decodeSummaryIntents(raw:string,deviceId:string,profileId:string):SummarySavedIntent[]{
  if(new TextEncoder().encode(raw).length>MAX_BYTES)return invalid();const value=object(JSON.parse(raw),['version','device_id','profile_id','intents']);
  if(value.version!==1||value.device_id!==deviceId||value.profile_id!==profileId||!Array.isArray(value.intents)||value.intents.length>MAX_ENTRIES)return invalid();
  const commands=new Set<string>(),events=new Set<string>();return value.intents.map(entry=>{
    const item=object(entry,['operation','kind','command','phase','receipt']);if(!['prepared','unknown','rejected','committed'].includes(String(item.phase)))return invalid();
    const operation=item.operation;if(operation!=='request'&&operation!=='control')return invalid();
    const command=operation==='request'?validateSummaryRequestCommand(item.command):validateSummaryControlCommand(item.command);
    if(command.profile_id!==profileId||commands.has(command.command_id)||events.has(command.event_id))return invalid();commands.add(command.command_id);events.add(command.event_id);
    if(operation==='request'?(item.kind!=='create'||'task_id'in command):!['cancel','retry','resume','update','takeover'].includes(String(item.kind)))return invalid();
    if(operation==='control'){
      const action=(command as SummaryControlCommand).action;
      if(item.kind==='cancel'?action.kind!=='cancel':item.kind==='update'?action.kind!=='queue_update':action.kind!=='take_over_for_self'||action.resume_cancelled!==(item.kind==='resume'))return invalid();
    }
    const receipt=item.receipt===null?null:validateSummaryReceipt(item.receipt,command);if((item.phase==='committed')!==!!receipt)return invalid();
    return frozen({operation,kind:item.kind,command,phase:item.phase,receipt} as SummarySavedIntent);
  });
}

/** Separate from Record/feedback drafts. No secret, endpoint, model config,
 * source body, weak localStorage fallback or automatic RPC replay. */
export class SummaryIntentJournal {
  private operation:Promise<void>=Promise.resolve();private closed=false;
  private constructor(private readonly storage:DurableIntentStorage,private readonly key:string,readonly deviceId:string,readonly profileId:string,private values:SummarySavedIntent[]){}
  static async open(deviceId:string,profileId:string,journal?:LocalIntentJournal):Promise<SummaryIntentJournal>{
    const key=summaryIntentKey(deviceId,profileId),primary=journal??productionIntentStorage().journal;
    const storage=await openDurableIntentStorage({key,journal:primary,validate:raw=>{decodeSummaryIntents(raw,deviceId,profileId);}});
    try{const raw=storage.getItem(key);return new SummaryIntentJournal(storage,key,deviceId,profileId,raw===null?[]:decodeSummaryIntents(raw,deviceId,profileId));}catch(error){storage.close();throw error;}
  }
  entries():readonly SummarySavedIntent[]{return this.values;}
  private change(update:(entries:SummarySavedIntent[])=>SummarySavedIntent[]):Promise<void>{
    const run=async()=>{if(this.closed)throw new BetaApiError('inactive_session','回顾窗口已关闭，未发出请求');const next=update(this.values),raw=JSON.stringify({version:1,device_id:this.deviceId,profile_id:this.profileId,intents:next});const checked=decodeSummaryIntents(raw,this.deviceId,this.profileId);this.values=checked;this.storage.setItem(this.key,raw);await this.storage.commit();};
    const operation=this.operation.then(run,run);this.operation=operation.catch(()=>{});return operation;
  }
  put(entry:SummarySavedIntent):Promise<void>{return this.change(entries=>{const old=entries.find(item=>item.command.command_id===entry.command.command_id);if(old&&(old.operation!==entry.operation||old.kind!==entry.kind||JSON.stringify(old.command)!==JSON.stringify(entry.command)))return invalid();const next=entries.filter(item=>item.command.command_id!==entry.command.command_id);next.push(entry);return next;});}
  remove(commandId:string):Promise<void>{return this.change(entries=>entries.filter(item=>item.command.command_id!==commandId));}
  async flush():Promise<void>{await this.operation;await this.storage.commit();}
  async close():Promise<void>{this.closed=true;await this.operation;this.storage.close();}
}
