import { invoke } from '@tauri-apps/api/core';
import { BetaApiError,validateReceipt } from '../client';
import { validateTimeblockSnapshot } from '../timeblocks-validation';
import type { MainOverlayPort,OverlayBinding,OverlayRead,OverlayRequest,OverlayResponse,OverlayScope,OverlayTicket,OverlayView } from './protocol';

export type OverlayInvoke=<T>(command:string,args?:Record<string,unknown>)=>Promise<T>;
const invalid=():never=>{throw new BetaApiError('invalid_overlay_response','浮窗桥响应无效，已停止操作');};
function object(value:unknown,required:string[],optional:string[]=[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid();const raw=value as Record<string,unknown>;
  if(required.some(key=>!(key in raw))||Object.keys(raw).some(key=>!required.includes(key)&&!optional.includes(key)))return invalid();return raw;
}
function text(value:unknown):string{if(typeof value!=='string')return invalid();return value;}
function id(value:unknown):string{const result=text(value);if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result)||/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(result))return invalid();return result;}
function integer(value:unknown):number{if(!Number.isSafeInteger(value)||Number(value)<0)return invalid();return Number(value);}
function flag(value:unknown):boolean{if(typeof value!=='boolean')return invalid();return value;}
function state(value:unknown):'idle'|'pending'|'failed'{if(value!=='idle'&&value!=='pending'&&value!=='failed')return invalid();return value;}
function nullableText(value:unknown):string|null{return value===null?null:text(value);}
export function validateOverlayScope(value:unknown):OverlayScope {
  const raw=object(value,['device_id','runtime_id','profile_id','ui_owner_generation']);return{device_id:id(raw.device_id),runtime_id:id(raw.runtime_id),profile_id:id(raw.profile_id),ui_owner_generation:id(raw.ui_owner_generation)};
}
export function validateOverlayView(value:unknown):OverlayView{
  const raw=object(value,['scope','theme','remote','clock','capture','feedback','focus_state','focus_error','focus_busy','focus_pending','capture_pending']),scope=validateOverlayScope(raw.scope);
  if(raw.theme!=='light'&&raw.theme!=='dark')return invalid();
  const capture=object(raw.capture,['text','revision','file_count','state','error']);
  let clock:OverlayView['clock']=null;
  if(raw.clock!==null){const c=object(raw.clock,['text','warning','stale'],['endTimeText']);clock={text:text(c.text),warning:flag(c.warning),stale:flag(c.stale),...(c.endTimeText===undefined?{}:{endTimeText:text(c.endTimeText)})};}
  const remote=raw.remote===null?null:validateTimeblockSnapshot(raw.remote,scope.profile_id,scope.device_id);if((clock===null)!==(remote===null))return invalid();
  if(!raw.feedback||typeof raw.feedback!=='object'||Array.isArray(raw.feedback))return invalid();
  const feedback:OverlayView['feedback']={};for(const [key,value]of Object.entries(raw.feedback)){id(key);const draft=object(value,['text','revision']);feedback[key]={text:text(draft.text),revision:integer(draft.revision)};}
  function pending(value:unknown,kinds:string[]){if(!Array.isArray(value)||value.length>64)return invalid();return value.map(item=>{const p=object(item,['command_id','state'],['message']);if(!kinds.includes(text(p.state)))return invalid();return{command_id:id(p.command_id),state:text(p.state),...(p.message===undefined?{}:{message:text(p.message)})};});}
  return{scope,theme:raw.theme,remote,clock,capture:{text:text(capture.text),revision:integer(capture.revision),file_count:integer(capture.file_count),state:state(capture.state),error:nullableText(capture.error)},feedback,
    focus_state:state(raw.focus_state),focus_error:nullableText(raw.focus_error),focus_busy:flag(raw.focus_busy),focus_pending:pending(raw.focus_pending,['pending','unknown','rejected']),capture_pending:pending(raw.capture_pending,['pending','unknown','failed'])};
}
export function validateOverlayResponse(value:unknown):OverlayResponse{
  if((value as {ok?:unknown})?.ok===true){const raw=object(value,['ok','view','receipt']),view=validateOverlayView(raw.view),receipt=raw.receipt===null?null:validateReceipt(raw.receipt);if(receipt&&receipt.profile_id!==view.scope.profile_id)return invalid();return{ok:true,view,receipt};}
  const raw=object(value,['ok','code','message','view']);if(raw.ok!==false)return invalid();return{ok:false,code:text(raw.code),message:text(raw.message),view:validateOverlayView(raw.view)};
}
export function validateOverlayRead(value:unknown):OverlayRead{
  const raw=object(value,['overlay_generation','ready','view','responses']);if(!Array.isArray(raw.responses)||raw.responses.length>64)return invalid();
  const ready=flag(raw.ready),view=raw.view===null?null:validateOverlayView(raw.view);if(ready!==(view!==null))return invalid();
  return{overlay_generation:id(raw.overlay_generation),ready,view,responses:raw.responses.map(item=>{const r=object(item,['request_id','response']);return{request_id:id(r.request_id),response:validateOverlayResponse(r.response)};})};
}
async function call<T>(invoker:OverlayInvoke,command:string,args?:Record<string,unknown>):Promise<T>{
  try{return await invoker<T>(command,args);}catch(error){if(error instanceof BetaApiError)throw error;if(error&&typeof error==='object'&&'code'in error&&'message'in error&&typeof error.code==='string'&&typeof error.message==='string')throw new BetaApiError(error.code,error.message);throw new BetaApiError('overlay_unavailable','浮窗桥未确认，请保留输入并重试');}
}
function validateTicket(value:unknown):OverlayTicket{
  const raw=object(value,['ticket_id','request']),r=object(raw.request,['request_id','seq','overlay_generation','scope','expected_revision','action']);
  const seq=integer(r.seq),revision=text(r.expected_revision);if(seq===0||!/^[a-f0-9]{64}$/.test(revision))return invalid();
  const kind=(r.action as {kind?:unknown})?.kind;
  const fields:Record<string,string[]>={refresh:[],pause:['block_id'],resume:['block_id'],end_action:['block_id'],capture_edit:['draft_revision','text'],capture:['draft_revision'],feedback_edit:['block_id','draft_revision','text'],submit_feedback:['block_id','draft_revision','skipped'],append_feedback:['block_id','draft_revision'],retry_capture:['command_id'],retry_timeblock:['command_id']};
  if(typeof kind!=='string'||!Object.prototype.hasOwnProperty.call(fields,kind))return invalid();const a=object(r.action,['kind',...fields[kind]]);
  if('block_id'in a)id(a.block_id);if('command_id'in a)id(a.command_id);if('draft_revision'in a)integer(a.draft_revision);if('text'in a)text(a.text);if('skipped'in a)flag(a.skipped);
  return{ticket_id:id(raw.ticket_id),request:{request_id:id(r.request_id),seq,overlay_generation:id(r.overlay_generation),scope:validateOverlayScope(r.scope),expected_revision:revision,action:a as unknown as OverlayRequest['action']}};
}
export function nativeMainOverlayPort(invoker:OverlayInvoke=invoke):MainOverlayPort {
  const main=<T>(operation:Record<string,unknown>)=>call<T>(invoker,'beta_overlay_main',{operation});
  return{async register(binding:OverlayBinding){return validateOverlayScope(await main({kind:'register',binding}));},async publish(scope,view){await main({kind:'publish',scope,view});},async take(scope){const tickets=await main<unknown>({kind:'take',scope});if(!Array.isArray(tickets)||tickets.length>64)return invalid();return tickets.map(validateTicket);},async validate(scope,ticket_id){await main({kind:'validate',scope,ticket_id});},async respond(scope,ticket_id,response){await main({kind:'respond',scope,ticket_id,response});},async revoke(scope){await main({kind:'revoke',scope});}};
}
export const nativeOverlayWindow=(operation:{kind:'show'|'hide'|'return_main'|'remember_position'}|{kind:'resize';width:number;height:number},invoker:OverlayInvoke=invoke)=>call<void>(invoker,'beta_overlay_window',{operation});
export function nativeOverlayPort(invoker:OverlayInvoke=invoke){return{
  async attach(){return id(await call(invoker,'beta_overlay_attach'));},
  async read(){return validateOverlayRead(await call(invoker,'beta_overlay_read'));},
  async submit(request:OverlayRequest){await call(invoker,'beta_overlay_request',{request});},
};}
