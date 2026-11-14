import { BetaApiError,type BetaClient,type BetaReceipt } from '../client';
import type { BetaDraftController } from '../drafts';
import type { BetaTimeblockController } from '../timeblocks-controller';
import { canonicalOverlayRequest,overlayScopeKey,type MainOverlayPort,type OverlayBinding,type OverlayResponse,type OverlayScope,type OverlayTicket,type OverlayView } from './protocol';

const failure=(code:string,message:string):never=>{throw new BetaApiError(code,message);};
const message=(error:unknown)=>error&&typeof error==='object'&&'message'in error?String(error.message):'浮窗操作未确认，请保留输入并查证';
const code=(error:unknown)=>error&&typeof error==='object'&&'code'in error?String(error.code):'overlay_unavailable';
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}

/** References the controllers owned by DeviceWorkspace's Web Lock. It neither
 * opens a journal nor creates another client/controller. Native-issued tickets
 * are the only execution input; ordinary web events are never authority. */
export class MainOverlayOwner {
  private active=true;
  private readonly requests=new Map<string,{body:string;result:Promise<OverlayResponse>}>();
  constructor(private readonly options:{scope:OverlayScope;client:BetaClient;capture:BetaDraftController;focus:BetaTimeblockController;validateTicket:(ticket:OverlayTicket)=>Promise<void>;onCommitted?:()=>void;dark?:()=>boolean}){}
  dispose(){this.active=false;}
  snapshot():OverlayView {
    const {scope,capture,focus}=this.options,c=capture.snapshot(),f=focus.snapshot(),draft=c.drafts[scope.profile_id];
    const feedback=Object.fromEntries(Object.entries(f.feedback).filter(([id,value])=>value.text.trim()||id===f.remote?.active?.block_id||f.remote?.pending_feedback.includes(id)));
    return{scope,theme:this.options.dark?.()?'dark':'light',remote:f.remote,clock:focus.displayClock(),capture:{text:draft?.text??'',revision:draft?.revision??0,file_count:draft?.files?.length??0,state:c.persistenceState,error:c.persistenceError},
      feedback,focus_state:f.persistenceState,focus_error:f.cacheError??f.error,focus_busy:f.loading||f.pending.some(item=>item.state!=='rejected'),
      focus_pending:f.pending.map(item=>({command_id:item.command.command_id,state:item.state,message:item.message})),
      capture_pending:c.pending.filter(item=>item.command.profile_id===scope.profile_id&&item.state!=='committed').map(item=>({command_id:item.command.command_id,state:item.state,message:item.message}))};
  }
  private reject(error:unknown):OverlayResponse{return{ok:false,code:code(error),message:message(error),view:this.snapshot()};}
  execute(ticket:OverlayTicket):Promise<OverlayResponse> {
    const body=canonicalOverlayRequest(ticket.request),prior=this.requests.get(ticket.ticket_id);
    if(prior)return prior.body===body?prior.result:Promise.resolve(this.reject(new BetaApiError('overlay_request_conflict','同一浮窗请求不能更改内容')));
    const immutable=freeze(structuredClone(ticket));const result=this.perform(immutable).catch(error=>this.reject(error));this.requests.set(ticket.ticket_id,{body,result});return result;
  }
  /** Remove only Native-acknowledged results, never an in-flight/unknown ticket. */
  acknowledged(ticketId:string){this.requests.delete(ticketId);}
  private current(scope:OverlayScope){if(!this.active||overlayScopeKey(scope)!==overlayScopeKey(this.options.scope))failure('overlay_scope_changed','主窗口档案或草稿所有者已变化，请重新读取');}
  private async perform(ticket:OverlayTicket):Promise<OverlayResponse>{
    const {request}=ticket;
    const {scope,client,capture,focus}=this.options;this.current(request.scope);
    const identity=await client.status();this.current(request.scope);
    if(!identity.running||identity.device_id!==scope.device_id||identity.runtime_id!==scope.runtime_id)failure('overlay_scope_changed','本机服务身份已变化，旧浮窗请求未执行');
    await this.options.validateTicket(ticket);this.current(request.scope);
    const action=request.action;let receipt:BetaReceipt|null=null;
    const draftRevision=()=>capture.snapshot().drafts[scope.profile_id]?.revision??0;
    const checkCapture=(expected:number)=>{if(draftRevision()!==expected)failure('overlay_draft_conflict','主窗口记录草稿已变化，已保留浮窗输入，请重新确认');};
    const checkFeedback=(block:string,expected:number)=>{
      const current=focus.snapshot();
      if(current.remote?.active?.block_id!==block&&!current.remote?.pending_feedback.includes(block)&&!Object.prototype.hasOwnProperty.call(current.feedback,block))failure('overlay_block_changed','找不到此档案中可反馈的时间块');
      if((current.feedback[block]?.revision??0)!==expected)failure('overlay_draft_conflict','此时间块反馈草稿已变化，请重新确认');
    };
    const checkRevision=()=>{if(focus.snapshot().remote?.revision!==request.expected_revision)failure('overlay_revision_conflict','时间块状态已变化，请刷新后重新确认');};
    switch(action.kind){
      case'refresh':await focus.refresh();break;
      case'capture_edit':checkCapture(action.draft_revision);capture.setDraft(scope.profile_id,action.text);await capture.flush();break;
      case'capture':checkCapture(action.draft_revision);receipt=await capture.submit(scope.profile_id);break;
      case'feedback_edit':checkFeedback(action.block_id,action.draft_revision);focus.setFeedbackDraft(action.block_id,action.text);await focus.flush();break;
      case'submit_feedback':case'append_feedback':
        checkRevision();checkFeedback(action.block_id,action.draft_revision);
        receipt=action.kind==='submit_feedback'?await focus.submitFeedback(action.block_id,action.skipped):await focus.appendFeedback(action.block_id);break;
      case'pause':case'resume':case'end_action':
        checkRevision();if(focus.snapshot().remote?.active?.block_id!==action.block_id)failure('overlay_block_changed','当前时间块已变化，未将旧动作应用到新块');
        receipt=await focus.control(action.kind,action.block_id);break;
      case'retry_capture':
        if(!capture.snapshot().pending.some(item=>item.command.profile_id===scope.profile_id&&item.command.command_id===action.command_id))failure('missing_submission','找不到当前档案的待确认记录');
        receipt=await capture.retry(action.command_id);break;
      case'retry_timeblock':
        if(!focus.snapshot().pending.some(item=>item.command.command_id===action.command_id))failure('missing_submission','找不到当前档案的待确认时间块操作');
        receipt=await focus.retry(action.command_id);break;
    }
    if(receipt&&action.kind!=='capture'&&action.kind!=='retry_capture')await focus.refresh();
    this.current(request.scope);
    if(receipt)this.options.onCommitted?.();
    // A null mutation receipt is explicitly unknown, never a success label.
    if(!receipt&&['capture','pause','resume','end_action','submit_feedback','append_feedback','retry_capture','retry_timeblock'].includes(action.kind))failure('overlay_result_unknown','操作结果待确认，原命令已保留，请查证后重试');
    return{ok:true,view:this.snapshot(),receipt};
  }
}

/** One bounded Native polling loop. Pending Core calls are not awaited here,
 * so the single Main writer can still accept later draft edits. */
export async function connectMainOverlay(options:{port:MainOverlayPort;binding:OverlayBinding;client:BetaClient;capture:BetaDraftController;focus:BetaTimeblockController;onCommitted?:()=>void;dark?:()=>boolean;onReady?:()=>void;onError?:(error:unknown)=>void}){
  const scope=await options.port.register(options.binding),owner=new MainOverlayOwner({...options,scope,validateTicket:ticket=>options.port.validate(scope,ticket.ticket_id)});
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  const replies=new Map<string,OverlayResponse>();const busy=new Set<string>();
  async function poll(){
    if(stopped)return;
    try{
      await options.port.publish(scope,owner.snapshot());if(stopped)return;
      const tickets=await options.port.take(scope);if(stopped)return;
      // A response can be stored in Native even if its IPC ACK was lost.
      // Absence from the complete pending-ticket list is enough to release
      // this transient copy; Native's sequence tombstone prevents reexecution.
      const pendingIds=new Set(tickets.map(ticket=>ticket.ticket_id));
      for(const id of replies.keys())if(!pendingIds.has(id)){replies.delete(id);owner.acknowledged(id);}
      options.onReady?.();
      for(const ticket of tickets){
        if(replies.has(ticket.ticket_id)){await options.port.respond(scope,ticket.ticket_id,replies.get(ticket.ticket_id)!);replies.delete(ticket.ticket_id);owner.acknowledged(ticket.ticket_id);continue;}
        if(busy.has(ticket.ticket_id))continue;busy.add(ticket.ticket_id);
        void owner.execute(ticket).then(response=>{if(!stopped)replies.set(ticket.ticket_id,response);}).finally(()=>busy.delete(ticket.ticket_id));
      }
    }catch(error){if(!stopped)options.onError?.(error);}
    finally{if(!stopped)timer=setTimeout(()=>void poll(),250);}
  }
  void poll();
  return{scope,close(){if(stopped)return;stopped=true;clearTimeout(timer);owner.dispose();void options.port.revoke(scope).catch(()=>{});}};
}
