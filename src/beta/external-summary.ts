import { BetaApiError } from './api-error';
import { summaryUuid } from './summary-validation';
import type { BetaOriginal } from './original-types';
import type { SummarySourceRef } from './summary-types';

export interface ExternalSummarySnapshot {
  observed_through:number;sources:SummarySourceRef[];input_encoded_bytes:number;
  materials:BetaOriginal[];
  coverage:{scope:'explicit_sources';source_delivery:'not_attested';remote_visibility:'unknown';unread_original_ids:string[]};
  digest:string;
}
export interface ExternalSummaryRecord {
  event_id:string;profile_id:string;device_id:string;producer_agent_id:string;
  occurred_at_ms:number;snapshot:ExternalSummarySnapshot;narrative:string;
  evidence:string[];digest:string;local_seq:number;
}
const invalid=():never=>{throw new BetaApiError('invalid_external_summary','外部回顾及其来源尚未可靠确认');};
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const result=value as Record<string,unknown>;if(Object.keys(result).length!==keys.length||keys.some(key=>!Object.prototype.hasOwnProperty.call(result,key)))return invalid();return result;}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)return invalid();return Number(value);}
function text(value:unknown,max:number):string{if(typeof value!=='string'||new TextEncoder().encode(value).length>max)return invalid();return value;}
function hash(value:unknown):string{const result=text(value,64);if(!/^[a-f0-9]{64}$/.test(result))return invalid();return result;}
function array<T>(value:unknown,max:number,parse:(item:unknown)=>T):T[]{if(!Array.isArray(value)||value.length>max)return invalid();return value.map(parse);}
function ids(value:unknown,max:number,min=0):string[]{const result=array(value,max,summaryUuid);if(result.length<min||new Set(result).size!==result.length)return invalid();return result;}
function source(value:unknown):SummarySourceRef{const raw=object(value,['event_id','kind','digest']);if(raw.kind!=='capture'&&raw.kind!=='timeblock/1')return invalid();return{event_id:summaryUuid(raw.event_id),kind:raw.kind,digest:hash(raw.digest)};}
function original(value:unknown):BetaOriginal{const raw=object(value,['original_id','sha256','byte_length','file_name','media_type']);return{original_id:summaryUuid(raw.original_id),sha256:hash(raw.sha256),byte_length:integer(raw.byte_length),file_name:text(raw.file_name,4096),media_type:text(raw.media_type,512)};}
function snapshot(value:unknown):ExternalSummarySnapshot{
  const raw=object(value,['observed_through','sources','input_encoded_bytes','materials','coverage','digest']);
  const sources=array(raw.sources,1000,source),materials=array(raw.materials,256,original),coverage=object(raw.coverage,['scope','source_delivery','remote_visibility','unread_original_ids']);
  const unread=ids(coverage.unread_original_ids,256),materialIds=new Set(materials.map(item=>item.original_id));
  if(!sources.length||new Set(sources.map(item=>item.event_id)).size!==sources.length||materialIds.size!==materials.length||unread.length!==materials.length||unread.some(id=>!materialIds.has(id))||coverage.scope!=='explicit_sources'||coverage.source_delivery!=='not_attested'||coverage.remote_visibility!=='unknown')return invalid();
  return{observed_through:integer(raw.observed_through,1),sources,input_encoded_bytes:integer(raw.input_encoded_bytes,1,192*1024),materials,coverage:{scope:'explicit_sources',source_delivery:'not_attested',remote_visibility:'unknown',unread_original_ids:unread},digest:hash(raw.digest)};
}
export function validateExternalSummaryRecord(value:unknown,profileId:string):ExternalSummaryRecord{
  const raw=object(value,['event_id','profile_id','device_id','producer_agent_id','occurred_at_ms','snapshot','narrative','evidence','digest','local_seq']);
  if(summaryUuid(raw.profile_id)!==profileId)return invalid();const frozen=snapshot(raw.snapshot),evidence=ids(raw.evidence,1000,1),narrative=text(raw.narrative,128*1024);
  if(!narrative.trim()||evidence.some(id=>!frozen.sources.some(source=>source.event_id===id)))return invalid();
  return{event_id:summaryUuid(raw.event_id),profile_id:profileId,device_id:summaryUuid(raw.device_id),producer_agent_id:summaryUuid(raw.producer_agent_id),occurred_at_ms:integer(raw.occurred_at_ms),snapshot:frozen,narrative,evidence,digest:hash(raw.digest),local_seq:integer(raw.local_seq,1)};
}
