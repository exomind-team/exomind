import { BetaApiError } from '../api-error';
import { betaUuid } from '../initialization';
import { nativeOverlayPort } from './native-port';
import { overlayScopeKey,type OverlayAction,type OverlayRead,type OverlayRequest,type OverlayResponse,type OverlayView } from './protocol';

export interface OverlayPort {attach():Promise<string>;read():Promise<OverlayRead>;submit(request:OverlayRequest):Promise<void>}
export interface OverlaySessionState {ready:boolean;view:OverlayView|null;error:string|null;pending:readonly OverlayRequest[]}
const inactive=()=>new BetaApiError('overlay_scope_changed','浮窗上下文已变化，旧请求未转到新档案');
/** Presentation transport only. No BetaClient, domain controller or journal is
 * created here. Unknown requests retain exactly their first identity/body. */
export class OverlaySession {
  private state:OverlaySessionState={ready:false,view:null,error:null,pending:[]};
  private stopped=false;private seq=0;private timer:ReturnType<typeof setTimeout>|undefined;
  private readonly listeners=new Set<()=>void>();private responses=new Map<string,OverlayResponse>();
  private submitQueue:Promise<void>=Promise.resolve();
  private constructor(private readonly port:OverlayPort,private readonly generation:string){}
  static async open(port:OverlayPort=nativeOverlayPort()):Promise<OverlaySession>{const generation=await port.attach(),session=new OverlaySession(port,generation);await session.poll();return session;}
  snapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(next:OverlaySessionState){this.state=next;for(const listener of this.listeners)listener();}
  private async poll(){
    try{const read=await this.port.read();if(this.stopped)return;if(read.overlay_generation!==this.generation)throw inactive();
      if(read.view&&this.state.view&&overlayScopeKey(read.view.scope)!==overlayScopeKey(this.state.view.scope))this.seq=0;
      this.responses=new Map(read.responses.map(item=>[item.request_id,item.response]));
      this.emit({...this.state,ready:read.ready,view:read.view??this.state.view,error:read.ready?null:'主窗口尚未就绪，浮窗暂不可操作'});
    }catch(error){if(!this.stopped)this.emit({...this.state,ready:false,error:error instanceof Error?error.message:'浮窗桥暂不可用'});}
    finally{if(!this.stopped)this.timer=setTimeout(()=>void this.poll(),250);}
  }
  close(){if(this.stopped)return;this.stopped=true;clearTimeout(this.timer);this.emit({...this.state,ready:false,error:'浮窗已关闭'});this.listeners.clear();}
  send(action:OverlayAction,view:OverlayView=this.state.view!,prepared?:(request:OverlayRequest)=>void):Promise<OverlayResponse>{
    if(this.stopped||!this.state.ready||!view?.remote)return Promise.reject(inactive());
    if(this.state.pending.length>=16)return Promise.reject(new BetaApiError('overlay_busy','浮窗操作待确认，请先查证'));
    const request:OverlayRequest=Object.freeze({request_id:betaUuid(),seq:++this.seq,overlay_generation:this.generation,scope:Object.freeze({...view.scope}),expected_revision:view.remote.revision,action:Object.freeze({...action})});
    prepared?.(request);this.emit({...this.state,pending:[...this.state.pending,request]});return this.perform(request);
  }
  retry(requestId:string):Promise<OverlayResponse>{const request=this.state.pending.find(item=>item.request_id===requestId);return request?this.perform(request):Promise.reject(new BetaApiError('missing_submission','找不到原浮窗请求'));}
  private async perform(request:OverlayRequest):Promise<OverlayResponse>{
    if(this.stopped)throw inactive();
    const submitted=this.submitQueue.then(()=>{if(this.stopped)throw inactive();return this.port.submit(request);});this.submitQueue=submitted.catch(()=>{});await submitted;
    const response=await new Promise<OverlayResponse>((resolve,reject)=>{
      let remove=()=>{};const finish=(error?:unknown,value?:OverlayResponse)=>{clearTimeout(timeout);remove();if(error)reject(error);else resolve(value!);};
      const timeout=setTimeout(()=>finish(new BetaApiError('overlay_result_unknown','浮窗操作结果未确认，请保留输入并查证原请求')),10_000);
      const check=()=>{
        if(this.stopped){finish(inactive());return;}
        if(this.state.view&&overlayScopeKey(this.state.view.scope)!==overlayScopeKey(request.scope)){finish(inactive());return;}
        const response=this.responses.get(request.request_id);
        if(response){if(overlayScopeKey(response.view.scope)!==overlayScopeKey(request.scope)){finish(inactive());return;}finish(undefined,response);return;}
      };
      remove=this.subscribe(check);check();
    });
    this.emit({...this.state,pending:this.state.pending.filter(item=>item.request_id!==request.request_id)});return response;
  }
}
