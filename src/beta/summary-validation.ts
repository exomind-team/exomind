import { BetaApiError } from './api-error';
import type { BetaReceipt } from './client';
import type { BetaOriginal } from './original-types';
import type { SummaryMaterialConsent } from './summary-types';
import { MAX_SUMMARY_ATTEMPTS,MAX_SUMMARY_CONFLICTS,MAX_SUMMARY_CONTROL_HEADS,MAX_SUMMARY_INPUT_ENCODED_BYTES,MAX_SUMMARY_PAGE_SIZE,MAX_SUMMARY_SAFE_COUNTER,MAX_SUMMARY_SOURCES,type SummaryArtifactKind,type SummaryArtifactPage,type SummaryArtifactRecord,type SummaryArtifactView,type SummaryAttemptView,type SummaryControlAction,type SummaryControlCommand,type SummaryCoverage,type SummaryMaterial,type SummaryModelMetadata,type SummaryOriginHead,type SummaryOutput,type SummaryRequestCommand,type SummaryRunView,type SummarySelection,type SummaryServiceStatus,type SummarySourceRef,type SummarySourceSnapshot,type SummaryState,type SummaryTaskPage,type SummaryTaskView } from './summary-types';

const encoder=new TextEncoder();
function invalid():never{throw new BetaApiError('invalid_summary_response','回顾数据与请求范围尚未确认，请刷新后重试');}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const raw=value as Record<string,unknown>;
  if(Object.keys(raw).some(key=>!keys.includes(key))||keys.some(key=>!Object.prototype.hasOwnProperty.call(raw,key)))return invalid();return raw;
}
function text(value:unknown,max:number,min=0):string{
  if(typeof value!=='string'||value.length>max)return invalid();
  // Native strings are valid UTF-8. Reject lone JSON surrogate escapes instead
  // of silently replacing their bytes when checking a Rust byte-length bound.
  for(let index=0;index<value.length;index++){const code=value.charCodeAt(index);if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))return invalid();}else if(code>=0xdc00&&code<=0xdfff)return invalid();}
  const bytes=encoder.encode(value).length;if(bytes<min||bytes>max)return invalid();return value;
}
export function summaryUuid(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)||value==='00000000-0000-0000-0000-000000000000')return invalid();return value;}
export function validateSummaryMaterialConsent(value:unknown):SummaryMaterialConsent{
  const raw=object(value,['provider_config_revision','max_original_bytes']);
  return{provider_config_revision:summaryUuid(raw.provider_config_revision),max_original_bytes:integer(raw.max_original_bytes,1,256*1024)};
}
function hash(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return invalid();return value;}
function integer(value:unknown,min=0,max=MAX_SUMMARY_SAFE_COUNTER):number{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)return invalid();return Number(value);}
function boolean(value:unknown):boolean{if(typeof value!=='boolean')return invalid();return value;}
function nullable<T>(value:unknown,parse:(value:unknown)=>T):T|null{return value===null?null:parse(value);}
function array<T>(value:unknown,max:number,parse:(value:unknown)=>T):T[]{if(!Array.isArray(value)||value.length>max)return invalid();return value.map(parse);}
function ids(value:unknown,max:number,min=0):string[]{const result=array(value,max,summaryUuid);if(result.length<min||new Set(result).size!==result.length)return invalid();return result;}
function choice<T extends string>(value:unknown,values:readonly T[]):T{if(!values.includes(value as T))return invalid();return value as T;}
function state(value:unknown):SummaryState{return choice(value,['waiting_configuration','queued','running','retry_wait','succeeded','failed','cancelled']);}
function kind(value:unknown):SummaryArtifactKind{return choice(value,['review','compressed_block','compressed_message','external_summary']);}
function reason(value:unknown):string|null{return nullable(value,value=>text(value,64));}
function sameSet(a:readonly string[],b:readonly string[]):boolean{return a.length===b.length&&a.every(value=>b.includes(value));}
function sameSelection(a:SummarySelection,b:SummarySelection):boolean{return a.from_ms===b.from_ms&&a.to_ms===b.to_ms&&sameSet(a.block_ids,b.block_ids)&&sameSet(a.selected_original_ids,b.selected_original_ids);}
function input<T>(parse:()=>T):T{try{return parse();}catch{throw new BetaApiError('invalid_summary_request','回顾请求参数无效，未提交');}}

export function validateSummarySelection(value:unknown):SummarySelection{
  const raw=object(value,['block_ids','from_ms','to_ms','selected_original_ids']);const from=integer(raw.from_ms),to=integer(raw.to_ms);if(to<from)return invalid();
  return{block_ids:ids(raw.block_ids,100,1),from_ms:from,to_ms:to,selected_original_ids:ids(raw.selected_original_ids,256)};
}
function source(value:unknown):SummarySourceRef{const raw=object(value,['event_id','kind','digest']);return{event_id:summaryUuid(raw.event_id),kind:choice(raw.kind,['capture','timeblock/1','correction/1']),digest:hash(raw.digest)};}
function original(value:unknown):BetaOriginal{
  const raw=object(value,['original_id','sha256','byte_length','file_name','media_type']);const name=text(raw.file_name,1024,1),media=text(raw.media_type,256);
  if(/[\u0000-\u001f\u007f-\u009f/\\]/.test(name)||/[\u0000-\u001f\u007f-\u009f]/.test(media))return invalid();
  return{original_id:summaryUuid(raw.original_id),sha256:hash(raw.sha256),byte_length:integer(raw.byte_length),file_name:name,media_type:media};
}
function material(value:unknown):SummaryMaterial{const raw=object(value,['original','selected','read_state']);return{original:original(raw.original),selected:boolean(raw.selected),read_state:choice(raw.read_state,['not_selected','missing','verified_available','metadata_only','read_failed'])};}
function originHead(value:unknown,profileId:string):SummaryOriginHead{
  const raw=object(value,['origin','cursor']),origin=object(raw.origin,['profile_id','device_id','restoration_epoch']),cursor=object(raw.cursor,['seq','hash']);
  if(origin.profile_id!==profileId)return invalid();return{origin:{profile_id:summaryUuid(origin.profile_id),device_id:summaryUuid(origin.device_id),restoration_epoch:summaryUuid(origin.restoration_epoch)},cursor:{seq:integer(cursor.seq),hash:hash(cursor.hash)}};
}
function coverage(value:unknown):SummaryCoverage{
  const raw=object(value,['page_limit','input_byte_limit','omitted_source_ids','read_failures','missing_parents','metadata_only','unread_originals','remote_visibility']);
  return{page_limit:boolean(raw.page_limit),input_byte_limit:boolean(raw.input_byte_limit),omitted_source_ids:ids(raw.omitted_source_ids,MAX_SUMMARY_SOURCES),read_failures:ids(raw.read_failures,MAX_SUMMARY_SOURCES),missing_parents:ids(raw.missing_parents,128),metadata_only:ids(raw.metadata_only,256),unread_originals:ids(raw.unread_originals,256),remote_visibility:choice(raw.remote_visibility,['unknown','known_gap','frozen_known_heads'])};
}
export function validateSummarySnapshot(value:unknown,profileId:string):SummarySourceSnapshot{
  summaryUuid(profileId);const raw=object(value,['selection','sources','feedback_ids','origin_heads','through','input_encoded_bytes','materials','coverage','digest']);
  const result:SummarySourceSnapshot={selection:validateSummarySelection(raw.selection),sources:array(raw.sources,MAX_SUMMARY_SOURCES,source),feedback_ids:ids(raw.feedback_ids,MAX_SUMMARY_SOURCES),origin_heads:array(raw.origin_heads,256,value=>originHead(value,profileId)),through:integer(raw.through),input_encoded_bytes:integer(raw.input_encoded_bytes,0,MAX_SUMMARY_INPUT_ENCODED_BYTES),materials:array(raw.materials,256,material),coverage:coverage(raw.coverage),digest:hash(raw.digest)};
  const sourceIds=new Set(result.sources.map(value=>value.event_id)),materials=new Set(result.materials.map(value=>value.original.original_id));
  // An exposed frozen run/result snapshot must prove at least one real input.
  // Waiting/unfrozen tasks use snapshot:null instead of an empty proof object.
  if(!result.sources.length||sourceIds.size!==result.sources.length||materials.size!==result.materials.length||new Set(result.origin_heads.map(head=>`${head.origin.device_id}:${head.origin.restoration_epoch}`)).size!==result.origin_heads.length)return invalid();
  if(result.feedback_ids.some(id=>!result.sources.some(value=>value.event_id===id&&value.kind==='timeblock/1')))return invalid();
  if(result.materials.some(value=>value.selected!==result.selection.selected_original_ids.includes(value.original.original_id))||result.selection.selected_original_ids.some(id=>!materials.has(id)))return invalid();
  if(result.coverage.metadata_only.some(id=>!materials.has(id))||result.coverage.unread_originals.some(id=>!materials.has(id)))return invalid();
  if(result.coverage.omitted_source_ids.some(id=>sourceIds.has(id)))return invalid();
  return result;
}
function attempt(value:unknown):SummaryAttemptView{const raw=object(value,['attempt_id','number','state','reason','retry_at_ms']);return{attempt_id:summaryUuid(raw.attempt_id),number:integer(raw.number,1,MAX_SUMMARY_ATTEMPTS),state:state(raw.state),reason:reason(raw.reason),retry_at_ms:nullable(raw.retry_at_ms,value=>integer(value))};}
function run(value:unknown,profileId:string):SummaryRunView{const raw=object(value,['run_id','run_generation','owner_generation','snapshot','attempt']);return{run_id:summaryUuid(raw.run_id),run_generation:integer(raw.run_generation,1),owner_generation:integer(raw.owner_generation,1),snapshot:nullable(raw.snapshot,value=>validateSummarySnapshot(value,profileId)),attempt:nullable(raw.attempt,attempt)};}
export function validateSummaryTask(value:unknown,profileId:string,taskId?:string):SummaryTaskView{
  summaryUuid(profileId);if(taskId!==undefined)summaryUuid(taskId);const raw=object(value,['task_id','profile_id','purpose','artifact_kind','selection','created_at_ms','trigger_key','creator_event_id','owner_device_id','owner_generation','owner_control_event_id','current_run','state','reason','control_heads','conflicts','latest_artifact_id','coverage_changed']);
  if(raw.profile_id!==profileId||taskId!==undefined&&raw.task_id!==taskId)return invalid();
  // Conflicts also contain missing external parents, not just control facts.
  const result:SummaryTaskView={task_id:summaryUuid(raw.task_id),profile_id:profileId,purpose:choice(raw.purpose,['first_review_v1','manual_compress_v1']),artifact_kind:kind(raw.artifact_kind),selection:validateSummarySelection(raw.selection),created_at_ms:integer(raw.created_at_ms),trigger_key:text(raw.trigger_key,256,1),creator_event_id:summaryUuid(raw.creator_event_id),owner_device_id:summaryUuid(raw.owner_device_id),owner_generation:integer(raw.owner_generation,1),owner_control_event_id:summaryUuid(raw.owner_control_event_id),current_run:nullable(raw.current_run,value=>run(value,profileId)),state:state(raw.state),reason:reason(raw.reason),control_heads:ids(raw.control_heads,MAX_SUMMARY_CONTROL_HEADS),conflicts:ids(raw.conflicts,MAX_SUMMARY_CONFLICTS),latest_artifact_id:nullable(raw.latest_artifact_id,summaryUuid),coverage_changed:boolean(raw.coverage_changed)};
  if(result.current_run&&(result.current_run.owner_generation!==result.owner_generation||result.current_run.snapshot&&!sameSelection(result.current_run.snapshot.selection,result.selection)))return invalid();
  // A cancelled task or recovered old-lifecycle failure may retain a running
  // historical attempt. Never coerce it to the task's current state.
  return result;
}
function model(value:unknown):SummaryModelMetadata{const raw=object(value,['provider','model','role_config_digest','request_input_digest','prompt_template','include_suggestions','max_output_tokens','requested_model']);return{provider:text(raw.provider,128,1),model:text(raw.model,256,1),role_config_digest:hash(raw.role_config_digest),request_input_digest:hash(raw.request_input_digest),prompt_template:text(raw.prompt_template,128,1),include_suggestions:boolean(raw.include_suggestions),max_output_tokens:integer(raw.max_output_tokens,1,131072),requested_model:text(raw.requested_model,256,1)};}
function output(value:unknown,snapshot:SummarySourceSnapshot):SummaryOutput{
  const raw=object(value,['narrative','evidence','read_original_ids','model','usage']),usage=object(raw.usage,['input_tokens','output_tokens','provider_request_id']);const narrative=text(raw.narrative,128*1024,1),evidence=ids(raw.evidence,MAX_SUMMARY_SOURCES),read=ids(raw.read_original_ids,256);
  if(!narrative.trim()||!snapshot.sources.length||!evidence.length||evidence.some(id=>!snapshot.sources.some(value=>value.event_id===id)))return invalid();
  if(read.some(id=>!snapshot.materials.some(value=>value.original.original_id===id&&value.selected&&value.read_state==='verified_available')))return invalid();
  return{narrative,evidence,read_original_ids:read,model:model(raw.model),usage:{input_tokens:nullable(usage.input_tokens,value=>integer(value)),output_tokens:nullable(usage.output_tokens,value=>integer(value)),provider_request_id:nullable(usage.provider_request_id,value=>text(value,256))}};
}
const artifactFields=['event_id','profile_id','occurred_at_ms','device_id','author_id','task_id','run_id','attempt_id','artifact_kind','snapshot','output','supersedes_artifact_id'] as const;
function artifactBase(raw:Record<string,unknown>,profileId:string,taskId?:string){
  if(raw.profile_id!==profileId||taskId!==undefined&&raw.task_id!==taskId)return invalid();const snapshot=validateSummarySnapshot(raw.snapshot,profileId);
  const result={event_id:summaryUuid(raw.event_id),profile_id:summaryUuid(raw.profile_id),occurred_at_ms:integer(raw.occurred_at_ms),device_id:summaryUuid(raw.device_id),author_id:summaryUuid(raw.author_id),task_id:summaryUuid(raw.task_id),run_id:summaryUuid(raw.run_id),attempt_id:summaryUuid(raw.attempt_id),artifact_kind:kind(raw.artifact_kind),snapshot,output:output(raw.output,snapshot),supersedes_artifact_id:nullable(raw.supersedes_artifact_id,summaryUuid)};
  if(result.supersedes_artifact_id===result.event_id)return invalid();return result;
}
export function validateSummaryArtifact(value:unknown,profileId:string,taskId:string):SummaryArtifactView{
  summaryUuid(profileId);summaryUuid(taskId);const raw=object(value,[...artifactFields,'current','reason']);return{...artifactBase(raw,profileId,taskId),current:boolean(raw.current),reason:reason(raw.reason)};
}
/** Local UI timeline facts have a positive local_seq. Portable peer records
 * with local_seq=0 are handled by Rust replication, not this UI decoder. */
export function validateSummaryArtifactRecord(value:unknown,profileId:string):SummaryArtifactRecord{
  summaryUuid(profileId);const raw=object(value,[...artifactFields,'owner_generation','owner_control_event_id','digest','local_seq']);return{...artifactBase(raw,profileId),owner_generation:integer(raw.owner_generation,1),owner_control_event_id:summaryUuid(raw.owner_control_event_id),digest:hash(raw.digest),local_seq:integer(raw.local_seq,1)};
}
export function validateSummaryPageLimit(value:unknown):number{return integer(value,1,MAX_SUMMARY_PAGE_SIZE);}
export function validateSummaryTaskPage(value:unknown,profileId:string,after:string|null,limit:number):SummaryTaskPage{
  summaryUuid(profileId);if(after!==null)summaryUuid(after);validateSummaryPageLimit(limit);const raw=object(value,['items','next_after']);const items=array(raw.items,limit,value=>validateSummaryTask(value,profileId));let previous=after??'';
  for(const item of items){if(item.task_id<=previous)return invalid();previous=item.task_id;}
  const next=nullable(raw.next_after,summaryUuid);if(next!==null&&(items.length!==limit||next!==previous))return invalid();return{items,next_after:next};
}
export function validateSummaryArtifactPage(value:unknown,profileId:string,taskId:string,before:number|null,limit:number):SummaryArtifactPage{
  summaryUuid(profileId);summaryUuid(taskId);if(before!==null)integer(before);validateSummaryPageLimit(limit);const raw=object(value,['items','next_before','highwater']),highwater=integer(raw.highwater);
  const items=array(raw.items,limit,value=>validateSummaryArtifact(value,profileId,taskId)),next=nullable(raw.next_before,value=>integer(value,1));
  if(new Set(items.map(item=>item.event_id)).size!==items.length||items.length>0&&(highwater===0||before===0)||next!==null&&(items.length!==limit||next>highwater||before!==null&&next>=before))return invalid();
  // ArtifactView has no local_seq. Do not invent item order/cursors from IDs or
  // occurred_at_ms; the Core provides a descending local-sequence cursor.
  return{items,next_before:next,highwater};
}
function controlAction(value:unknown):SummaryControlAction{
  const action=value as {kind?:unknown}|null;
  if(action?.kind==='cancel'){object(value,['kind']);return{kind:'cancel'};}
  if(action?.kind==='take_over_for_self'){const raw=object(value,['kind','run_id','resume_cancelled']);return{kind:action.kind,run_id:summaryUuid(raw.run_id),resume_cancelled:boolean(raw.resume_cancelled)};}
  if(action?.kind==='resolve_owner'){const raw=object(value,['kind','run_id','owner_device_id','resume_cancelled']);return{kind:action.kind,run_id:summaryUuid(raw.run_id),owner_device_id:summaryUuid(raw.owner_device_id),resume_cancelled:boolean(raw.resume_cancelled)};}
  if(action?.kind==='queue_update'){const raw=object(value,['kind','run_id','selection','supersedes_artifact_id']);return{kind:action.kind,run_id:summaryUuid(raw.run_id),selection:validateSummarySelection(raw.selection),supersedes_artifact_id:nullable(raw.supersedes_artifact_id,summaryUuid)};}
  return invalid();
}
export function validateSummaryRequestCommand(value:unknown):SummaryRequestCommand{return input(()=>{
  const raw=object(value,['command_id','event_id','profile_id','purpose','artifact_kind','selection']);const result:SummaryRequestCommand={command_id:summaryUuid(raw.command_id),event_id:summaryUuid(raw.event_id),profile_id:summaryUuid(raw.profile_id),purpose:choice(raw.purpose,['first_review_v1','manual_compress_v1']),artifact_kind:kind(raw.artifact_kind),selection:validateSummarySelection(raw.selection)};
  if(result.artifact_kind==='external_summary'||result.purpose==='first_review_v1'&&result.selection.block_ids.length!==1)return invalid();return result;
});}
export function validateSummaryControlCommand(value:unknown):SummaryControlCommand{return input(()=>{const raw=object(value,['command_id','event_id','profile_id','task_id','expected_owner_generation','expected_owner_control_event_id','expected_control_heads','action']);return{command_id:summaryUuid(raw.command_id),event_id:summaryUuid(raw.event_id),profile_id:summaryUuid(raw.profile_id),task_id:summaryUuid(raw.task_id),expected_owner_generation:integer(raw.expected_owner_generation,1,MAX_SUMMARY_SAFE_COUNTER-1),expected_owner_control_event_id:summaryUuid(raw.expected_owner_control_event_id),expected_control_heads:ids(raw.expected_control_heads,128),action:controlAction(raw.action)};});}
export function validateSummaryReceipt(value:unknown,command:Pick<SummaryRequestCommand,'command_id'|'event_id'|'profile_id'>):BetaReceipt{
  const raw=object(value,['command_id','event_id','profile_id','local_seq','event_digest','durability','replayed']);const result:BetaReceipt={command_id:summaryUuid(raw.command_id),event_id:summaryUuid(raw.event_id),profile_id:summaryUuid(raw.profile_id),local_seq:integer(raw.local_seq,1),event_digest:hash(raw.event_digest),durability:'local_committed',replayed:boolean(raw.replayed)};
  if(raw.durability!=='local_committed'||result.command_id!==command.command_id||result.event_id!==command.event_id||result.profile_id!==command.profile_id)return invalid();return result;
}
export function validateSummaryServiceStatus(value:unknown):SummaryServiceStatus{
  const raw=object(value,['running','active_profile_id','active_task_id','last_error_code']);const result={running:boolean(raw.running),active_profile_id:nullable(raw.active_profile_id,summaryUuid),active_task_id:nullable(raw.active_task_id,summaryUuid),last_error_code:reason(raw.last_error_code)};
  if((result.active_profile_id===null)!==(result.active_task_id===null))return invalid();return result;
}
