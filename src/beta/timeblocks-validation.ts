import { BetaApiError } from './api-error';
import { validateOriginal } from './original-client';
import type { BetaEvent, BetaQuery, BetaStatus } from './client';
import type {
  BetaActiveBlock, BetaBlockSpec, BetaDeadline, BetaDeadlineEnvelope, BetaIntervalPage, BetaIntervalQuery,
  BetaTimeblockAction, BetaTimeblockCommand, BetaTimeblockNode, BetaTimeblockNodePage, BetaTimeblockSnapshot,
  BetaTimelinePage, BetaTimer,
} from './timeblocks-types';

const invalid = (message = '时间块响应无效', code = 'invalid_timeblock_response'): never => { throw new BetaApiError(code, message); };
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key)) || keys.some(key => !(key in item))) return invalid();
  return item;
}
function integer(value: unknown, min = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < min) return invalid(); return Number(value);
}
function text(value: unknown): string { if (typeof value !== 'string') return invalid(); return value; }
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function uuid(value: unknown): string {
  const id = text(value);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) || id === '00000000-0000-0000-0000-000000000000') return invalid();
  return id;
}
function digest(value: unknown): string { const result = text(value); if (!/^[a-f0-9]{64}$/.test(result)) return invalid(); return result; }
function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return invalid(); const values = value.map(uuid);
  if (new Set(values).size !== values.length) return invalid(); return values;
}
function mode(value: unknown): 'soft' | 'hard' { if (value !== 'soft' && value !== 'hard') return invalid(); return value; }
function timer(value: unknown): BetaTimer {
  if ((value as { mode?: unknown } | null)?.mode === 'count_up') { object(value, ['mode']); return { mode: 'count_up' }; }
  const item = object(value, ['mode','duration_ms','end_mode']);
  if (item.mode !== 'count_down') return invalid();
  return { mode: 'count_down', duration_ms: integer(item.duration_ms, 1), end_mode: mode(item.end_mode) };
}
function block(value: unknown): BetaBlockSpec {
  const item = object(value, ['block_id','name','note','timer']);
  return { block_id: uuid(item.block_id), name: text(item.name), note: text(item.note), timer: timer(item.timer) };
}
export function validateTimeblockAction(value: unknown): BetaTimeblockAction {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (kind === 'start') {
    const item = object(value, ['kind','block_id','name','note','timer']);
    return { kind, ...block({ block_id:item.block_id,name:item.name,note:item.note,timer:item.timer }) };
  }
  if (kind === 'pause' || kind === 'resume' || kind === 'end_action') { const item = object(value, ['kind','block_id']); return { kind, block_id:uuid(item.block_id) }; }
  if (kind === 'rotate') { const item = object(value, ['kind','from_block_id','next']); return { kind, from_block_id:uuid(item.from_block_id), next:block(item.next) }; }
  if (kind === 'submit_feedback') {
    const item = object(value, ['kind','block_id','feedback']);
    if ((item.feedback as { kind?: unknown } | null)?.kind === 'skipped') { object(item.feedback, ['kind']); return { kind,block_id:uuid(item.block_id),feedback:{kind:'skipped'} }; }
    const feedback = object(item.feedback, ['kind','text']); if (feedback.kind !== 'text') return invalid();
    return { kind, block_id:uuid(item.block_id),feedback:{kind:'text',text:text(feedback.text)} };
  }
  if (kind === 'append_feedback') { const item=object(value,['kind','block_id','text']); return {kind,block_id:uuid(item.block_id),text:text(item.text)}; }
  return invalid('服务返回了未知时间块操作');
}
export function validateTimeblockCommand(value: unknown): BetaTimeblockCommand {
  const item=object(value,['command_id','event_id','profile_id','expected_revision','action']);
  return {command_id:uuid(item.command_id),event_id:uuid(item.event_id),profile_id:uuid(item.profile_id),expected_revision:digest(item.expected_revision),action:validateTimeblockAction(item.action)};
}
function deadline(value: unknown): BetaDeadline {
  const item=object(value,['deadline_id','generation','owner_device_id','owner_generation','due_at_ms','remaining_ms','end_mode','eligible']);
  return {deadline_id:uuid(item.deadline_id),generation:integer(item.generation,1),owner_device_id:uuid(item.owner_device_id),owner_generation:integer(item.owner_generation,1),due_at_ms:integer(item.due_at_ms),remaining_ms:integer(item.remaining_ms),end_mode:mode(item.end_mode),eligible:boolean(item.eligible)};
}
export function validateTimeblockSnapshot(value: unknown, profileId: string, deviceId?: string): BetaTimeblockSnapshot {
  const item=object(value,['profile_id','revision','heads','active','pending_feedback','clock']);
  if (item.profile_id !== profileId) return invalid('时间块响应不属于当前档案');
  const clock=object(item.clock,['server_now_ms','epoch_changed','wall_clock_moved_back']);
  let active:BetaActiveBlock|null=null;
  if(item.active!==null){
    const raw=object(item.active,['block_id','name','note','timer','phase','work_ms','deadline_reached','deadline']);
    if(!['running','paused','feedback_pending','completed'].includes(text(raw.phase)))return invalid();
    active={...block({block_id:raw.block_id,name:raw.name,note:raw.note,timer:raw.timer}),phase:raw.phase as BetaActiveBlock['phase'],work_ms:integer(raw.work_ms),deadline_reached:boolean(raw.deadline_reached),deadline:raw.deadline===null?null:deadline(raw.deadline)};
    if(active.deadline&&(active.timer.mode!=='count_down'||active.deadline.end_mode!==active.timer.end_mode
      ||(active.deadline.eligible&&(active.phase!=='running'||(deviceId&&active.deadline.owner_device_id!==deviceId)))))return invalid('时间块到点资格与当前服务不一致');
  }
  return {profile_id:uuid(item.profile_id),revision:digest(item.revision),heads:ids(item.heads),active,pending_feedback:ids(item.pending_feedback),clock:{server_now_ms:integer(clock.server_now_ms),epoch_changed:boolean(clock.epoch_changed),wall_clock_moved_back:boolean(clock.wall_clock_moved_back)}};
}
export function validateTimeblockNode(value: unknown, profileId: string): BetaTimeblockNode {
  const item=object(value,['event_id','profile_id','device_id','source','parents','occurred_at_ms','effective_at_ms','clock','payload','digest','local_seq']);
  if(item.profile_id!==profileId)return invalid('时间块节点跨档案');
  const source=object(item.source,['kind','author_id','owner_generation']);
  if(source.kind!=='human'&&source.kind!=='scheduler')return invalid();
  const clock=object(item.clock,['epoch_id','elapsed_ms']);
  const raw=item.payload as {kind?:unknown}|null;
  let payload:BetaTimeblockNode['payload'];
  if(raw?.kind==='action'){
    const body=object(raw,['kind','action']);if(source.kind!=='human')return invalid();payload={kind:'action',action:validateTimeblockAction(body.action)};
  }else{
    const body=object(raw,['kind','block_id','deadline_id','generation','end_mode','due_wall_ms','due_elapsed_ms','clock_epoch']);
    if(body.kind!=='deadline_reached'||source.kind!=='scheduler')return invalid('未知时间块节点类型');
    payload={kind:'deadline_reached',block_id:uuid(body.block_id),deadline_id:uuid(body.deadline_id),generation:integer(body.generation,1),end_mode:mode(body.end_mode),due_wall_ms:integer(body.due_wall_ms),due_elapsed_ms:integer(body.due_elapsed_ms),clock_epoch:uuid(body.clock_epoch)};
  }
  const parents=ids(item.parents);const event_id=uuid(item.event_id);if(parents.includes(event_id))return invalid();
  if(source.kind==='human'&&source.owner_generation!==null)return invalid();
  return {event_id,profile_id:uuid(item.profile_id),device_id:uuid(item.device_id),source:{kind:source.kind,author_id:uuid(source.author_id),owner_generation:source.owner_generation===null?null:integer(source.owner_generation,1)},parents,occurred_at_ms:integer(item.occurred_at_ms),effective_at_ms:integer(item.effective_at_ms),clock:{epoch_id:uuid(clock.epoch_id),elapsed_ms:integer(clock.elapsed_ms)},payload,digest:digest(item.digest),local_seq:integer(item.local_seq,1)};
}
export function validateCaptureRecord(value: unknown, profileId: string): BetaEvent {
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
  const raw=value as Record<string,unknown>;const keys=['event_id','profile_id','device_id','author_id','author_kind','occurred_at_ms','text','tags','digest','local_seq'];
  const item=object(value,raw.originals===undefined?keys:[...keys,'originals']);
  if(item.profile_id!==profileId||!['human','agent_note'].includes(text(item.author_kind))||!Array.isArray(item.tags)||!item.tags.every(tag=>typeof tag==='string'))return invalid();
  let originals;
  if(item.originals!==undefined){if(!Array.isArray(item.originals))return invalid();originals=item.originals.map(validateOriginal);}
  return {event_id:uuid(item.event_id),profile_id:uuid(item.profile_id),device_id:uuid(item.device_id),author_id:uuid(item.author_id),author_kind:item.author_kind as BetaEvent['author_kind'],occurred_at_ms:integer(item.occurred_at_ms),text:text(item.text),tags:item.tags as string[],digest:digest(item.digest),local_seq:integer(item.local_seq,1),...(originals?{originals}:{})};
}
export function validateEventQuery(query:BetaQuery):void{
  if(query.limit!==undefined&&(integer(query.limit,1)>100))return invalid('分页数量无效');
  if(query.before!==undefined)integer(query.before,1);if(query.through!==undefined)integer(query.through);
  if(query.search!==undefined)text(query.search);
}
function page<T>(value:unknown,query:BetaQuery,parse:(raw:unknown)=>T,sequence:(item:T)=>number):{items:T[];highwater:number;next_before:number|null}{
  validateEventQuery(query);const raw=object(value,['items','highwater','next_before']);const highwater=integer(raw.highwater);
  if(!Array.isArray(raw.items)||raw.items.length>(query.limit??100)||(query.through!==undefined&&query.through!==highwater))return invalid();
  let previous=query.before??Number.MAX_SAFE_INTEGER;const items:T[]=[];
  for(const value of raw.items){const item=parse(value);const seq=sequence(item);if(seq>=previous||seq>highwater)return invalid();previous=seq;items.push(item);}
  const next=raw.next_before===null?null:integer(raw.next_before,1);
  if(next!==null&&(!items.length||next!==previous))return invalid();return {items,highwater,next_before:next};
}
export function validateNodePage(value:unknown,profileId:string,query:BetaQuery):BetaTimeblockNodePage{return page(value,query,raw=>validateTimeblockNode(raw,profileId),item=>item.local_seq);}
export function validateTimelinePage(value:unknown,profileId:string,query:BetaQuery):BetaTimelinePage{
  try{return page(value,query,raw=>{const item=object(raw,['kind','record']);if(item.kind==='capture')return {kind:'capture' as const,record:validateCaptureRecord(item.record,profileId)};if(item.kind==='timeblock')return {kind:'timeblock' as const,record:validateTimeblockNode(item.record,profileId)};return invalid();},item=>item.record.local_seq);}
  catch{return invalid('混合时间线响应或分页不一致','invalid_timeline');}
}
export function validateIntervalQuery(query:BetaIntervalQuery):void{
  integer(query.from_ms);integer(query.to_ms);if(query.to_ms<=query.from_ms)return invalid('时间区间无效');
  if(query.through!==undefined)digest(query.through);if(query.limit!==undefined&&integer(query.limit,1)>100)return invalid('区间分页数量无效');
}
export function validateIntervalPage(value:unknown,query:BetaIntervalQuery):BetaIntervalPage{
  validateIntervalQuery(query);const raw=object(value,['items','revision','next_from_ms','complete']);const revision=digest(raw.revision);
  if(query.through!==undefined&&query.through!==revision)return invalid();
  if(!Array.isArray(raw.items)||raw.items.length>(query.limit??100))return invalid();let boundary=query.from_ms;
  const items=raw.items.map(value=>{const item=object(value,['from_ms','to_ms','kind','block_id','source_event_ids']);const from=integer(item.from_ms),to=integer(item.to_ms);if(from<boundary||to<=from||to>query.to_ms||!['running','paused','feedback','gap'].includes(text(item.kind)))return invalid();boundary=to;return {from_ms:from,to_ms:to,kind:item.kind as BetaIntervalPage['items'][number]['kind'],block_id:item.block_id===null?null:uuid(item.block_id),source_event_ids:ids(item.source_event_ids)};});
  const complete=boolean(raw.complete),next=raw.next_from_ms===null?null:integer(raw.next_from_ms);
  if((complete&&next!==null)||(!complete&&(next===null||!items.length||next!==boundary||next<=query.from_ms||next>=query.to_ms)))return invalid();
  return {items,revision,next_from_ms:next,complete};
}
export function validateDeadlineEnvelope(value:unknown,expected:{status:BetaStatus;snapshot:BetaTimeblockSnapshot}):BetaDeadlineEnvelope{
  const raw=object(value,['runtime_id','device_id','profile_id','projection_revision','block_id','deadline']);
  const result:BetaDeadlineEnvelope={runtime_id:uuid(raw.runtime_id),device_id:uuid(raw.device_id),profile_id:uuid(raw.profile_id),projection_revision:digest(raw.projection_revision),block_id:raw.block_id===null?null:uuid(raw.block_id),deadline:raw.deadline===null?null:deadline(raw.deadline)};
  const active=expected.snapshot.active;
  const a=result.deadline,b=active?.deadline??null;
  // Remaining time is a fresh sample, not identity. A later envelope may have
  // fewer remaining milliseconds while revision/generation are unchanged.
  const sameDeadline=a===null?b===null:!!b&&a.deadline_id===b.deadline_id&&a.generation===b.generation
    &&a.owner_device_id===b.owner_device_id&&a.owner_generation===b.owner_generation&&a.due_at_ms===b.due_at_ms&&a.end_mode===b.end_mode&&a.eligible===b.eligible;
  if(result.runtime_id!==expected.status.runtime_id||result.device_id!==expected.status.device_id||result.profile_id!==expected.snapshot.profile_id||result.projection_revision!==expected.snapshot.revision||result.block_id!==(active?.block_id??null)
    ||!sameDeadline)return invalid('到点提示已过期，请刷新当前时间块','stale_deadline');
  return result;
}
