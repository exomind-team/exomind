import { BetaApiError } from '../api-error';
import { overlayScopeKey,type OverlayView } from './protocol';
import type { OverlaySession } from './session';

export type OverlayDraftTarget={kind:'capture'}|{kind:'feedback';block_id:string};
export interface OverlayDraftState {text:string;dirty:boolean;saving:boolean;error:string|null}
/** Holds only unacknowledged display input. The sole durable writer is Main.
 * CAS failure/scope change keeps this text visible instead of overwriting it. */
export class OverlayDraftBuffer {
  private state:OverlayDraftState;private revision:number;private operation:Promise<void>|undefined;
  private pending:{id:string;text:string}|undefined;private readonly listeners=new Set<()=>void>();
  private stopped=false;private scopeKey:string;
  constructor(private readonly session:OverlaySession,private view:OverlayView,private readonly target:OverlayDraftTarget){const value=this.field(view);this.scopeKey=overlayScopeKey(view.scope);this.revision=value.revision;this.state={text:value.text,dirty:false,saving:false,error:null};}
  private field(view:OverlayView){return this.target.kind==='capture'?view.capture:view.feedback[this.target.block_id]??{text:'',revision:0};}
  snapshot=()=>this.state;
  submission(){return{view:this.view,revision:this.revision};}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(next:OverlayDraftState){this.state=next;for(const listener of this.listeners)listener();}
  sync(view:OverlayView){
    this.view=view;
    if(this.state.dirty||this.state.saving){if(overlayScopeKey(view.scope)!==this.scopeKey)this.emit({...this.state,error:'档案已变化，未确认输入保留在此窗；请复制后回主窗核对'});return;}
    const next=this.field(view);this.scopeKey=overlayScopeKey(view.scope);this.revision=next.revision;
    if(this.state.text!==next.text||this.state.error)this.emit({...this.state,text:next.text,error:null});
  }
  edit(text:string){if(this.stopped)return;this.emit({...this.state,text,dirty:true});if(!this.state.error)void this.flush().catch(()=>{});}
  useMainDraft(){if(this.state.saving)return;this.pending=undefined;this.scopeKey=overlayScopeKey(this.view.scope);const field=this.field(this.view);this.revision=field.revision;this.emit({text:field.text,dirty:false,saving:false,error:null});}
  retry(){this.emit({...this.state,error:null});return this.flush();}
  flush():Promise<void>{
    if(this.operation)return this.operation;
    if(this.state.error)return Promise.reject(new BetaApiError('overlay_draft_conflict',this.state.error));
    const operation=this.drain();this.operation=operation;void operation.finally(()=>{if(this.operation===operation)this.operation=undefined;if(this.state.dirty&&!this.state.error&&!this.stopped)void this.flush().catch(()=>{});}).catch(()=>{});return operation;
  }
  private async drain(){
    while(this.state.dirty&&!this.stopped){
      const sent=this.pending?.text??this.state.text;
      if(overlayScopeKey(this.view.scope)!==this.scopeKey){this.emit({...this.state,error:'档案已变化，未确认输入保留在此窗；请复制后回主窗核对'});throw new BetaApiError('overlay_scope_changed',this.state.error!);}
      this.emit({...this.state,saving:true});
      try{
        const response=this.pending?await this.session.retry(this.pending.id):await this.session.send(this.target.kind==='capture'?{kind:'capture_edit',text:sent,draft_revision:this.revision}:{kind:'feedback_edit',block_id:this.target.block_id,text:sent,draft_revision:this.revision},this.view,request=>{this.pending={id:request.request_id,text:sent};});
        if(this.stopped||overlayScopeKey(this.view.scope)!==this.scopeKey)throw new BetaApiError('overlay_scope_changed','档案已变化，旧暂存回包未清除本窗输入');
        this.pending=undefined;if(!response.ok)throw new BetaApiError(response.code,response.message);
        const field=this.field(response.view);if(field.text!==sent)throw new BetaApiError('overlay_draft_conflict','主窗口草稿已变化，已保留本窗输入，请核对');
        this.view=response.view;this.revision=field.revision;
        this.emit({...this.state,saving:false,dirty:this.state.text!==sent,error:null});
      }catch(error){this.emit({...this.state,saving:false,error:error instanceof Error?error.message:'本机暂存未确认，请保留窗口并重试'});throw error;}
    }
  }
  close(){this.stopped=true;this.listeners.clear();}
}
