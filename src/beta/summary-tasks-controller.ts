import { betaUuid } from './initialization';
import { validateSummaryControlCommand,validateSummaryReceipt } from './summary-validation';
import { sameSummaryArtifact,summaryFailure,summaryTaskFence } from './summary-ui';
import type { BetaReceipt } from './client';
import type { SummaryArtifactRecord,SummaryArtifactView,SummaryClient,SummaryControlCommand,SummaryTaskView } from './summary-types';

export type SummaryControlKind='cancel'|'retry'|'resume'|'update'|'takeover';
export interface SummaryControlIntent {command:SummaryControlCommand;kind:SummaryControlKind;phase:'sending'|'unknown'|'rejected'|'committed';message:string}
export interface SummaryDetail {taskId:string;task:SummaryTaskView|null;artifacts:SummaryArtifactView[];nextBefore:number|null;selected:SummaryArtifactView|null;loading:boolean;qualificationPending:boolean;error:string|null}
export interface SummaryTasksState {tasks:SummaryTaskView[];nextAfter:string|null;listLoaded:boolean;loading:boolean;error:string|null;detail:SummaryDetail|null;intents:SummaryControlIntent[]}
type ReceiptReader=(profileId:string,commandId:string)=>Promise<BetaReceipt|null>;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
const terminalRejection=new Set(['summary_conflict','summary_forbidden','forbidden','unauthorized','invalid_summary_request','summary_blocked']);

/** UI observation/control only. Stable commands survive uncertain replies in
 * this controller; no model execution, automatic takeover or automatic retry. */
export class SummaryTasksController {
  private state:SummaryTasksState={tasks:[],nextAfter:null,listLoaded:false,loading:false,error:null,detail:null,intents:[]};
  private closed=false;private generation=0;private detailGeneration=0;private listFlight=false;private detailFlight=false;
  private readonly listeners=new Set<()=>void>();private readonly origins=new Map<string,{before:number|null;limit:number}>();
  private readonly sending=new Set<string>();
  constructor(private readonly api:SummaryClient,readonly deviceId:string,readonly profileId:string,private readonly receipts:ReceiptReader,private readonly makeUuid:()=>string=betaUuid,private readonly changed:()=>void=()=>{}){}
  snapshot=()=>this.state;subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(next:SummaryTasksState){if(this.closed)return;this.state=next;for(const listener of this.listeners)listener();}
  private live(generation:number){return!this.closed&&generation===this.generation;}
  private updateTask(task:SummaryTaskView){if(task.profile_id!==this.profileId)throw Error('Wrong profile');this.emit({...this.state,tasks:this.state.tasks.map(item=>item.task_id===task.task_id?task:item)});}
  async loadTasks(more=false):Promise<void>{
    if(this.closed||this.listFlight||more&&!this.state.nextAfter)return;const generation=this.generation,after=more?this.state.nextAfter:null;this.listFlight=true;this.emit({...this.state,loading:true,error:null});
    try{const page=await this.api.tasks(this.profileId,after,25);if(!this.live(generation))return;const values=new Map((more?this.state.tasks:[]).map(task=>[task.task_id,task]));for(const task of page.items){if(task.profile_id!==this.profileId)throw Error('Wrong scope');values.set(task.task_id,task);}this.emit({...this.state,tasks:[...values.values()].sort((a,b)=>a.task_id<b.task_id?-1:a.task_id>b.task_id?1:0),nextAfter:page.next_after,listLoaded:true,loading:false,error:null});}
    catch(error){if(this.live(generation))this.emit({...this.state,loading:false,error:summaryFailure(error)});}finally{this.listFlight=false;}
  }
  private remember(items:SummaryArtifactView[],before:number|null,limit:number,highwater:number){for(const item of items)this.origins.set(item.event_id,{before:before??(highwater<Number.MAX_SAFE_INTEGER?highwater+1:null),limit});}
  async selectTask(taskId:string,preferred?:SummaryArtifactRecord):Promise<void>{
    if(this.closed)return;const generation=this.generation,detailGeneration=++this.detailGeneration;this.detailFlight=true;
    this.emit({...this.state,detail:{taskId,task:this.state.tasks.find(task=>task.task_id===taskId)??null,artifacts:[],nextBefore:null,selected:null,loading:true,qualificationPending:true,error:null}});
    try{
      const [task,page]=await Promise.all([this.api.task(this.profileId,taskId),this.api.artifacts(this.profileId,taskId,null,25)]);
      if(!this.live(generation)||detailGeneration!==this.detailGeneration)return;if(page.items.some(item=>item.profile_id!==this.profileId||item.task_id!==taskId))throw Error('Wrong artifact scope');this.remember(page.items,null,25,page.highwater);
      let selected=preferred?page.items.find(item=>item.event_id===preferred.event_id)??null:page.items.find(item=>item.event_id===task.latest_artifact_id)??page.items[0]??null;
      if(preferred&&!selected){const before=preferred.local_seq<Number.MAX_SAFE_INTEGER?preferred.local_seq+1:null;const exact=await this.api.artifacts(this.profileId,taskId,before,1);if(!this.live(generation)||detailGeneration!==this.detailGeneration)return;selected=exact.items.find(item=>item.event_id===preferred.event_id)??null;this.remember(exact.items,before,1,exact.highwater);}
      if(task.profile_id!==this.profileId||task.task_id!==taskId||selected&&(selected.profile_id!==this.profileId||selected.task_id!==taskId)||preferred&&selected&&!sameSummaryArtifact(preferred,selected))throw Error('Unbound artifact');
      const pending=!!preferred&&!selected||!!selected&&selected.current!==(task.latest_artifact_id===selected.event_id);
      this.updateTask(task);this.emit({...this.state,detail:{taskId,task,artifacts:page.items,nextBefore:page.next_before,selected,loading:false,qualificationPending:pending,error:pending?'此版本当前资格尚未定位或已变化，正文仍保留；请刷新或继续读取版本。':null}});
    }catch(error){if(this.live(generation)&&detailGeneration===this.detailGeneration)this.emit({...this.state,detail:{...this.state.detail!,loading:false,qualificationPending:true,error:summaryFailure(error)}});}finally{if(detailGeneration===this.detailGeneration)this.detailFlight=false;}
  }
  async refreshSelected():Promise<void>{
    const detail=this.state.detail;if(this.closed||!detail||this.detailFlight)return;const generation=this.generation,index=this.detailGeneration,selected=detail.selected,origin=selected?this.origins.get(selected.event_id):null;this.detailFlight=true;
    this.emit({...this.state,detail:{...detail,loading:true,qualificationPending:!!selected,error:null}});
    try{
      const task=await this.api.task(this.profileId,detail.taskId);if(!this.live(generation)||index!==this.detailGeneration)return;
      let current=selected,artifacts=this.state.detail!.artifacts,next=this.state.detail!.nextBefore,pending=false;
      if(selected&&origin){const page=await this.api.artifacts(this.profileId,detail.taskId,origin.before,origin.limit);if(!this.live(generation)||index!==this.detailGeneration)return;const found=page.items.find(item=>item.event_id===selected.event_id);if(found&&!sameSummaryArtifact(selected,found))throw Error('Immutable result changed');current=found??selected;pending=!found||found.current!==(task.latest_artifact_id===found.event_id);}
      else if(!selected&&task.latest_artifact_id){const page=await this.api.artifacts(this.profileId,detail.taskId,null,25);if(!this.live(generation)||index!==this.detailGeneration)return;this.remember(page.items,null,25,page.highwater);artifacts=page.items;next=page.next_before;current=page.items.find(item=>item.event_id===task.latest_artifact_id)??null;pending=!current;}
      else if(selected)pending=true;
      const before=detail.task?.latest_artifact_id;this.updateTask(task);this.emit({...this.state,detail:{taskId:detail.taskId,task,artifacts,nextBefore:next,selected:current,loading:false,qualificationPending:pending,error:pending?'当前版本资格尚未确认；保留原结果供查证。':null}});if(before!==task.latest_artifact_id)this.changed();
    }catch(error){if(this.live(generation)&&index===this.detailGeneration)this.emit({...this.state,detail:{...this.state.detail!,loading:false,qualificationPending:!!selected,error:summaryFailure(error)}});}finally{if(index===this.detailGeneration)this.detailFlight=false;}
  }
  async moreArtifacts():Promise<void>{
    const detail=this.state.detail;if(this.closed||!detail||detail.nextBefore===null||this.detailFlight)return;const generation=this.generation,index=this.detailGeneration,before=detail.nextBefore;this.detailFlight=true;this.emit({...this.state,detail:{...detail,loading:true,error:null}});
    try{const page=await this.api.artifacts(this.profileId,detail.taskId,before,25);if(!this.live(generation)||index!==this.detailGeneration)return;this.remember(page.items,before,25,page.highwater);const values=new Map(this.state.detail!.artifacts.map(item=>[item.event_id,item]));for(const item of page.items)values.set(item.event_id,item);this.emit({...this.state,detail:{...this.state.detail!,artifacts:[...values.values()],nextBefore:page.next_before,loading:false}});}
    catch(error){if(this.live(generation)&&index===this.detailGeneration)this.emit({...this.state,detail:{...this.state.detail!,loading:false,error:summaryFailure(error)}});}finally{if(index===this.detailGeneration)this.detailFlight=false;}
  }
  selectArtifact(eventId:string):void{const detail=this.state.detail;if(!detail)return;const artifact=detail.artifacts.find(item=>item.event_id===eventId)??(detail.selected?.event_id===eventId?detail.selected:null);if(!artifact){this.emit({...this.state,detail:{...detail,error:'此版本不在已读取列表中，请继续读取版本后选择。'}});return;}++this.detailGeneration;this.detailFlight=false;this.emit({...this.state,detail:{...detail,selected:artifact,qualificationPending:true,error:null}});void this.refreshSelected();}
  async openArtifact(eventId:string):Promise<void>{
    const detail=this.state.detail;if(this.closed||!detail)return;if(detail.artifacts.some(item=>item.event_id===eventId)){this.selectArtifact(eventId);return;}if(this.detailFlight)return;
    const generation=this.generation,index=this.detailGeneration;this.detailFlight=true;this.emit({...this.state,detail:{...detail,loading:true,error:null}});
    try{const page=await this.api.artifacts(this.profileId,detail.taskId,null,25);if(!this.live(generation)||index!==this.detailGeneration)return;if(page.items.some(item=>item.profile_id!==this.profileId||item.task_id!==detail.taskId))throw Error('Wrong scope');this.remember(page.items,null,25,page.highwater);
      const values=new Map(this.state.detail!.artifacts.map(item=>[item.event_id,item]));for(const item of page.items){const old=values.get(item.event_id);if(old&&!sameSummaryArtifact(old,item))throw Error('Immutable artifact changed');values.set(item.event_id,item);}const selected=page.items.find(item=>item.event_id===eventId);
      const task=this.state.detail!.task;const pending=!selected||!task||selected.current!==(task.latest_artifact_id===selected.event_id);
      this.emit({...this.state,detail:{...this.state.detail!,artifacts:[...values.values()],nextBefore:page.next_before,selected:selected??this.state.detail!.selected,loading:false,qualificationPending:pending,error:!selected?'此版本尚未在已读取页中定位，请继续读取版本后选择。':pending?'版本资格已变化，请刷新所选任务。':null}});
    }catch(error){if(this.live(generation)&&index===this.detailGeneration)this.emit({...this.state,detail:{...this.state.detail!,loading:false,error:summaryFailure(error)}});}finally{if(index===this.detailGeneration)this.detailFlight=false;}
  }
  private setIntent(intent:SummaryControlIntent){this.emit({...this.state,intents:[...this.state.intents.filter(item=>item.command.task_id!==intent.command.task_id),intent]});}
  async act(kind:SummaryControlKind,task:SummaryTaskView):Promise<void>{
    if(this.closed)return;if(this.state.intents.some(item=>item.command.task_id===task.task_id))return;
    if(task.profile_id!==this.profileId||kind!=='takeover'&&task.owner_device_id!==this.deviceId||task.conflicts.length||task.control_heads.length>128||task.owner_generation>=Number.MAX_SAFE_INTEGER){this.emit({...this.state,error:task.control_heads.length>128?'控制分支超过 128，需处理后再操作；不会截断提交。':'此任务归属或控制需要处理；不会自动接管远端任务。'});return;}
    if(kind==='retry'&&task.state!=='failed'||kind==='resume'&&task.state!=='cancelled'||kind==='cancel'&&['succeeded','cancelled'].includes(task.state)||kind==='update'&&(task.state==='cancelled'||!task.coverage_changed)||kind==='takeover'&&(task.owner_device_id===this.deviceId||['succeeded','cancelled'].includes(task.state))){this.emit({...this.state,error:'此操作不适用于当前显示状态，请刷新后重试。'});return;}
    try{
      const action=kind==='cancel'?{kind:'cancel' as const}:kind==='update'?{kind:'queue_update' as const,run_id:this.makeUuid(),selection:structuredClone(task.selection),supersedes_artifact_id:task.latest_artifact_id}:{kind:'take_over_for_self' as const,run_id:this.makeUuid(),resume_cancelled:kind==='resume'};
      const command=freeze(validateSummaryControlCommand({command_id:this.makeUuid(),event_id:this.makeUuid(),profile_id:this.profileId,task_id:task.task_id,expected_owner_generation:task.owner_generation,expected_owner_control_event_id:task.owner_control_event_id,expected_control_heads:[...task.control_heads],action}));
      const intent:SummaryControlIntent={command,kind,phase:'sending',message:'正在确认本机操作…'};this.setIntent(intent);await this.send(intent,true);
    }catch{this.emit({...this.state,error:'控制请求尚未创建，请保留当前结果后重试。'});}
  }
  private async committed(intent:SummaryControlIntent,receipt:BetaReceipt,generation:number){validateSummaryReceipt(receipt,intent.command);if(!this.live(generation))return;this.setIntent({...intent,phase:'committed',message:'操作已在本机保存，正在读取最新状态；不代表上游请求已停止计费。'});await this.refreshSelected();if(!this.live(generation))return;try{const task=await this.api.task(this.profileId,intent.command.task_id);if(!this.live(generation))return;this.updateTask(task);const previous=this.state.detail;const detail=previous&&previous.taskId===task.task_id?{...previous,task,qualificationPending:previous.qualificationPending||!!previous.selected&&(!previous.task||summaryTaskFence(previous.task)!==summaryTaskFence(task))}:previous;this.emit({...this.state,detail,intents:this.state.intents.filter(item=>item.command!==intent.command)});this.changed();}catch{if(this.live(generation))this.setIntent({...intent,phase:'committed',message:'本机回执已确认，最新状态未读回；请查证刷新，不重发新命令。'});}}
  private async send(intent:SummaryControlIntent,first:boolean){
    const id=intent.command.command_id;if(this.closed||this.sending.has(id))return;const generation=this.generation;this.sending.add(id);this.setIntent({...intent,phase:'sending',message:'正在确认原请求…'});
    try{const receipt=await this.api.control(intent.command);if(this.live(generation))await this.committed(intent,receipt,generation);}
    catch(error){if(!this.live(generation))return;let receipt:BetaReceipt|null=null;try{receipt=await this.receipts(this.profileId,id);if(receipt)validateSummaryReceipt(receipt,intent.command);}catch{receipt=null;}if(!this.live(generation))return;if(receipt){await this.committed(intent,receipt,generation);return;}const code=error&&typeof error==='object'&&'code'in error?error.code:'';this.setIntent({...intent,phase:first&&typeof code==='string'&&terminalRejection.has(code)?'rejected':'unknown',message:summaryFailure(error)});}
    finally{this.sending.delete(id);}
  }
  async check(intent:SummaryControlIntent):Promise<void>{const id=intent.command.command_id;if(this.closed||this.sending.has(id))return;const generation=this.generation;this.sending.add(id);this.setIntent({...intent,phase:'sending',message:'正在查证原操作回执…'});try{const receipt=await this.receipts(this.profileId,id);if(!this.live(generation))return;if(receipt){await this.committed(intent,receipt,generation);return;}this.setIntent({...intent,message:'尚未查到本机回执；原命令仍保留，请重试同一请求。'});}catch(error){if(this.live(generation))this.setIntent({...intent,message:summaryFailure(error)});}finally{this.sending.delete(id);}}
  async retryIntent(intent:SummaryControlIntent):Promise<void>{if(intent.phase==='committed'){await this.check(intent);return;}await this.send(intent,false);}
  dismissRejected(intent:SummaryControlIntent):void{if(intent.phase!=='rejected')return;this.emit({...this.state,intents:this.state.intents.filter(item=>item.command!==intent.command)});void this.refreshSelected();}
  dispose():void{this.closed=true;++this.generation;++this.detailGeneration;this.listeners.clear();this.origins.clear();}
}
