import { betaUuid } from './initialization';
import { validateSummaryControlCommand,validateSummaryReceipt,validateSummaryRequestCommand,validateSummarySelection } from './summary-validation';
import { sameSummaryArtifact,summaryFailure,summaryTaskFence } from './summary-ui';
import type { BetaReceipt } from './client';
import type { SummaryArtifactKind,SummaryArtifactRecord,SummaryArtifactView,SummaryClient,SummaryControlCommand,SummaryRequestCommand,SummarySelection,SummaryTaskView } from './summary-types';
import { SummaryIntentJournal,type SummarySavedIntent } from './summary-intent-journal';
import type { LocalIntentJournal } from './local-intent-journal';

export type SummaryControlKind='cancel'|'retry'|'resume'|'update'|'takeover';
export interface SummaryControlIntent {command:SummaryControlCommand;kind:SummaryControlKind;phase:'sending'|'unknown'|'rejected'|'committed';message:string;recoveryOnly?:boolean}
export interface SummaryCreationIntent {command:SummaryRequestCommand;phase:'sending'|'unknown'|'rejected'|'committed';message:string;receipt:BetaReceipt|null}
export interface SummaryDetail {taskId:string;task:SummaryTaskView|null;artifacts:SummaryArtifactView[];nextBefore:number|null;selected:SummaryArtifactView|null;loading:boolean;qualificationPending:boolean;error:string|null}
export interface SummaryTasksState {tasks:SummaryTaskView[];nextAfter:string|null;listLoaded:boolean;loading:boolean;error:string|null;detail:SummaryDetail|null;intents:SummaryControlIntent[];requests:SummaryCreationIntent[];persistence:'loading'|'ready'|'failed'}
type ReceiptReader=(profileId:string,commandId:string)=>Promise<BetaReceipt|null>;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
const terminalRejection=new Set(['summary_conflict','summary_forbidden','forbidden','unauthorized','invalid_summary_request','summary_blocked']);

/** UI observation/control only. Stable commands survive uncertain replies in
 * this controller; no model execution, automatic takeover or automatic retry. */
export class SummaryTasksController {
  private state:SummaryTasksState={tasks:[],nextAfter:null,listLoaded:false,loading:false,error:null,detail:null,intents:[],requests:[],persistence:'loading'};
  private closed=false;private generation=0;private detailGeneration=0;private listFlight=false;private detailFlight=false;
  private readonly listeners=new Set<()=>void>();private readonly origins=new Map<string,{before:number|null;limit:number}>();
  private readonly sending=new Set<string>();
  private readonly recoveryReads=new Set<string>();
  private dispatchGeneration=0;
  private journal:SummaryIntentJournal|null=null;private initialization:Promise<void>;
  constructor(private readonly api:SummaryClient,readonly deviceId:string,readonly profileId:string,private readonly receipts:ReceiptReader,private readonly makeUuid:()=>string=betaUuid,private readonly changed:()=>void=()=>{},private readonly suppliedJournal?:LocalIntentJournal){this.initialization=this.restore();}
  ready=()=>this.initialization;
  private async restore():Promise<void>{
    try{const journal=await SummaryIntentJournal.open(this.deviceId,this.profileId,this.suppliedJournal);if(this.closed){await journal.close();return;}this.journal=journal;
      const intents:SummaryControlIntent[]=[],requests:SummaryCreationIntent[]=[];
      for(const item of journal.entries()){const phase=item.phase==='prepared'?'unknown':item.phase;if(item.operation==='control')intents.push({kind:item.kind,command:item.command,phase,message:phase==='committed'?'本机回执已保存，等待核对最新任务。':'恢复了原操作；不会自动重发，请先查证。'});else requests.push({command:item.command,phase,receipt:item.receipt,message:phase==='committed'?'创建请求已在本机保存；不代表模型已执行或回顾已生成。':'恢复了原创建请求；不会自动重发，请先查证。'});}
      this.emit({...this.state,persistence:'ready',intents,requests,error:null});
      // Read-only reconciliation. A missing receipt never authorizes a new UUID.
      void (async()=>{for(const intent of intents.slice(0,4)){if(this.closed)return;await this.check(intent);}for(const request of requests.slice(0,Math.max(0,4-intents.length))){if(this.closed)return;await this.checkRequest(request);}})();
    }catch{if(!this.closed)this.emit({...this.state,persistence:'failed',error:'本机回顾意图尚未可靠读取，原缓存保留；新的生成与控制尚未启用，请重新读取。'});}
  }
  async reopenJournal():Promise<void>{if(this.closed||this.state.persistence==='loading'||this.sending.size)return;if(this.journal){await this.journal.close();this.journal=null;}this.emit({...this.state,persistence:'loading'});this.initialization=this.restore();await this.initialization;}
  private async persist(item:SummarySavedIntent):Promise<void>{if(!this.journal||this.state.persistence!=='ready')throw Error('Journal not ready');try{await this.journal.put(item);}catch{if(!this.closed)this.emit({...this.state,persistence:'failed',error:'本机意图保存尚未确认；未发送新请求，原命令保留。请重新读取后查证或重试。'});throw Error('Journal unconfirmed');}}
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
  private setIntent(intent:SummaryControlIntent){this.emit({...this.state,intents:[...this.state.intents.filter(item=>item.command.command_id!==intent.command.command_id),intent]});}
  async act(kind:SummaryControlKind,task:SummaryTaskView):Promise<void>{
    if(this.closed)return;if(this.state.persistence==='loading')await this.initialization;if(this.closed||this.state.persistence!=='ready')return;if(this.state.intents.some(item=>item.command.task_id===task.task_id))return;
    if(task.profile_id!==this.profileId||kind!=='takeover'&&task.owner_device_id!==this.deviceId||task.conflicts.length||task.control_heads.length>128||task.owner_generation>=Number.MAX_SAFE_INTEGER){this.emit({...this.state,error:task.control_heads.length>128?'控制分支超过 128，需处理后再操作；不会截断提交。':'此任务归属或控制需要处理；不会自动接管远端任务。'});return;}
    if(kind==='retry'&&task.state!=='failed'||kind==='resume'&&task.state!=='cancelled'||kind==='cancel'&&['succeeded','cancelled'].includes(task.state)||kind==='update'&&(task.state==='cancelled'||!task.coverage_changed)||kind==='takeover'&&(task.owner_device_id===this.deviceId||['succeeded','cancelled'].includes(task.state))){this.emit({...this.state,error:'此操作不适用于当前显示状态，请刷新后重试。'});return;}
    try{
      const action=kind==='cancel'?{kind:'cancel' as const}:kind==='update'?{kind:'queue_update' as const,run_id:this.makeUuid(),selection:structuredClone(task.selection),supersedes_artifact_id:task.latest_artifact_id}:{kind:'take_over_for_self' as const,run_id:this.makeUuid(),resume_cancelled:kind==='resume'};
      const command=freeze(validateSummaryControlCommand({command_id:this.makeUuid(),event_id:this.makeUuid(),profile_id:this.profileId,task_id:task.task_id,expected_owner_generation:task.owner_generation,expected_owner_control_event_id:task.owner_control_event_id,expected_control_heads:[...task.control_heads],action}));
      const intent:SummaryControlIntent={command,kind,phase:'sending',message:'正在确认本机操作…'};this.setIntent(intent);await this.send(intent,true);
    }catch{this.emit({...this.state,error:'控制请求尚未创建，请保留当前结果后重试。'});}
  }
  private async committed(intent:SummaryControlIntent,receipt:BetaReceipt,generation:number){validateSummaryReceipt(receipt,intent.command);if(!this.live(generation))return;
    if(intent.recoveryOnly){this.setIntent({...intent,phase:'committed',message:'仅取消请求已获本机服务回执；确认缓存不可用，仅在此窗口保留。以下以服务回读状态为准，不保证上游停止计费。'});const task=await this.api.task(this.profileId,intent.command.task_id);if(!this.live(generation))return;this.updateTask(task);const detail=this.state.detail;this.emit({...this.state,detail:detail&&detail.taskId===task.task_id?{...detail,task,qualificationPending:true}:detail});this.changed();return;}
    await this.persist({operation:'control',kind:intent.kind,command:intent.command,phase:'committed',receipt});if(!this.live(generation))return;
    this.setIntent({...intent,phase:'committed',message:'操作已在本机保存，正在读取最新状态；不代表上游请求已停止计费。'});await this.refreshSelected();if(!this.live(generation))return;
    try{const task=await this.api.task(this.profileId,intent.command.task_id);if(!this.live(generation))return;this.updateTask(task);const previous=this.state.detail;const detail=previous&&previous.taskId===task.task_id?{...previous,task,qualificationPending:previous.qualificationPending||!!previous.selected&&(!previous.task||summaryTaskFence(previous.task)!==summaryTaskFence(task))}:previous;
      await this.journal!.remove(intent.command.command_id);if(!this.live(generation))return;this.emit({...this.state,detail,intents:this.state.intents.filter(item=>item.command.command_id!==intent.command.command_id)});this.changed();
    }catch{if(this.live(generation))this.setIntent({...intent,phase:'committed',message:'本机回执已确认，最新状态或清理未完成；请查证刷新，不重发新命令。'});}}
  private async send(intent:SummaryControlIntent,first:boolean){
    const id=intent.command.command_id;if(this.closed||this.sending.has(id))return;const generation=this.generation,dispatch=this.dispatchGeneration;this.sending.add(id);this.setIntent({...intent,phase:'sending',message:'正在确认原请求…'});
    try{if(intent.recoveryOnly){if(intent.kind!=='cancel'||intent.command.action.kind!=='cancel')throw Error('Cancellation only');}else await this.persist({operation:'control',kind:intent.kind,command:intent.command,phase:'prepared',receipt:null});if(!this.live(generation))return;if(dispatch!==this.dispatchGeneration){this.setIntent({...intent,phase:'unknown',message:'档案切换已阻止发送；原命令保留，请查证后明确重试。'});return;}const receipt=await this.api.control(intent.command);if(this.live(generation))await this.committed(intent,receipt,generation);}
    catch(error){if(!this.live(generation))return;let receipt:BetaReceipt|null=null;try{receipt=await this.receipts(this.profileId,id);if(receipt)validateSummaryReceipt(receipt,intent.command);}catch{receipt=null;}if(!this.live(generation))return;if(receipt&&(this.state.persistence==='ready'||intent.recoveryOnly)){try{await this.committed(intent,receipt,generation);return;}catch{}}
      const code=error&&typeof error==='object'&&'code'in error?error.code:'',phase=first&&typeof code==='string'&&terminalRejection.has(code)?'rejected':'unknown';this.setIntent({...intent,phase,message:(intent.recoveryOnly?'仅取消的本机确认缓存不可用，本窗口保留同一请求供查证；关闭后不自动重发。':'')+summaryFailure(error)});if(!intent.recoveryOnly&&this.state.persistence==='ready')try{await this.persist({operation:'control',kind:intent.kind,command:intent.command,phase,receipt:null});}catch{}
    }
    finally{this.sending.delete(id);}
  }
  async check(intent:SummaryControlIntent):Promise<void>{const id=intent.command.command_id;if(this.closed||this.sending.has(id))return;const generation=this.generation;this.sending.add(id);this.setIntent({...intent,phase:'sending',message:'正在查证原操作回执…'});try{const receipt=await this.receipts(this.profileId,id);if(!this.live(generation))return;if(receipt){await this.committed(intent,receipt,generation);return;}this.setIntent({...intent,message:'尚未查到本机回执；原命令仍保留，请重试同一请求。'});}catch(error){if(this.live(generation))this.setIntent({...intent,message:summaryFailure(error)});}finally{this.sending.delete(id);}}
  async retryIntent(intent:SummaryControlIntent):Promise<void>{if(intent.phase==='committed'){await this.check(intent);return;}if(this.state.persistence!=='ready'&&!intent.recoveryOnly)return;await this.send(intent,false);}
  async cancelWithoutJournal(taskId:string):Promise<void>{
    if(this.closed||this.state.persistence!=='failed'||this.recoveryReads.has(taskId)||this.state.intents.some(item=>item.command.task_id===taskId&&item.recoveryOnly))return;const generation=this.generation,dispatch=this.dispatchGeneration;this.recoveryReads.add(taskId);
    try{const task=await this.api.task(this.profileId,taskId);if(!this.live(generation)||dispatch!==this.dispatchGeneration)return;if(task.profile_id!==this.profileId||task.task_id!==taskId)throw Error('Scope');this.updateTask(task);const detail=this.state.detail;this.emit({...this.state,detail:detail&&detail.taskId===taskId?{...detail,task,qualificationPending:true}:detail});if(task.state==='cancelled'){this.emit({...this.state,error:'服务回读确认此任务当前已取消；未发送新命令。'});return;}if(task.state==='succeeded'||task.owner_device_id!==this.deviceId||task.control_heads.length>128||task.conflicts.length||task.owner_generation>=Number.MAX_SAFE_INTEGER)throw Error('Not eligible');
      const command=freeze(validateSummaryControlCommand({command_id:this.makeUuid(),event_id:this.makeUuid(),profile_id:this.profileId,task_id:taskId,expected_owner_generation:task.owner_generation,expected_owner_control_event_id:task.owner_control_event_id,expected_control_heads:[...task.control_heads],action:{kind:'cancel'}}));const intent:SummaryControlIntent={command,kind:'cancel',recoveryOnly:true,phase:'sending',message:'本机确认缓存不可用，仅向服务请求取消；不保证上游停止计费。'};this.setIntent(intent);await this.send(intent,true);
    }catch{if(this.live(generation))this.emit({...this.state,error:'尚未确认可取消的当前任务状态；未宣称已取消，请重新读取后重试。'});}finally{this.recoveryReads.delete(taskId);}
  }
  dismissRecoveryCancellation(intent:SummaryControlIntent):void{if(!intent.recoveryOnly||intent.phase!=='rejected')return;this.emit({...this.state,intents:this.state.intents.filter(item=>item.command.command_id!==intent.command.command_id)});void this.refreshSelected();}
  async dismissRejected(intent:SummaryControlIntent):Promise<void>{if(intent.phase!=='rejected'||this.state.persistence!=='ready')return;try{await this.journal!.remove(intent.command.command_id);if(this.closed)return;this.emit({...this.state,intents:this.state.intents.filter(item=>item.command.command_id!==intent.command.command_id)});void this.refreshSelected();}catch{this.emit({...this.state,persistence:'failed',error:'被拒请求的本机清理未确认；原意图保留。'});}}
  private setRequest(intent:SummaryCreationIntent):void{this.emit({...this.state,requests:[...this.state.requests.filter(item=>item.command.command_id!==intent.command.command_id),intent]});}
  async create(artifactKind:Extract<SummaryArtifactKind,'compressed_block'|'compressed_message'>,selection:SummarySelection):Promise<void>{
    if(this.state.persistence==='loading')await this.initialization;if(this.closed||this.state.persistence!=='ready'||this.state.requests.length)return;
    try{const selected=validateSummarySelection(selection);if(selected.selected_original_ids.length)throw Error('Explicit original selection is not supported here');
      const command=freeze(validateSummaryRequestCommand({command_id:this.makeUuid(),event_id:this.makeUuid(),profile_id:this.profileId,purpose:'manual_compress_v1',artifact_kind:artifactKind,selection:selected}));
      const request:SummaryCreationIntent={command,phase:'sending',message:'正在可靠保存固定创建意图，尚未确认提交…',receipt:null};this.setRequest(request);await this.sendRequest(request,true);
    }catch{this.emit({...this.state,error:'压缩请求尚未创建，请检查已确认范围；未声明生成成功。'});}
  }
  private async requestCommitted(request:SummaryCreationIntent,receipt:BetaReceipt,generation:number):Promise<void>{
    validateSummaryReceipt(receipt,request.command);if(!this.live(generation))return;
    await this.persist({operation:'request',kind:'create',command:request.command,phase:'committed',receipt});if(!this.live(generation))return;
    this.setRequest({...request,phase:'committed',receipt,message:'创建请求已在本机保存；不代表模型已执行、结果已生成或所有设备已收到。请刷新任务列表查看真实状态。'});this.changed();await this.loadTasks();
  }
  private async sendRequest(request:SummaryCreationIntent,first:boolean):Promise<void>{
    const id=request.command.command_id;if(this.closed||this.sending.has(id)||this.state.persistence!=='ready')return;const generation=this.generation,dispatch=this.dispatchGeneration;this.sending.add(id);this.setRequest({...request,phase:'sending',message:'正在保存并确认原创建请求…'});
    try{await this.persist({operation:'request',kind:'create',command:request.command,phase:'prepared',receipt:null});if(!this.live(generation))return;if(dispatch!==this.dispatchGeneration){this.setRequest({...request,phase:'unknown',message:'档案切换已阻止发送；原创建请求已保存，恢复后仅查证。'});return;}const receipt=await this.api.request(request.command);if(this.live(generation))await this.requestCommitted(request,receipt,generation);}
    catch(error){if(!this.live(generation))return;let receipt:BetaReceipt|null=null;try{receipt=await this.receipts(this.profileId,id);if(receipt)validateSummaryReceipt(receipt,request.command);}catch{receipt=null;}if(!this.live(generation))return;
      if(receipt&&this.state.persistence==='ready')try{await this.requestCommitted(request,receipt,generation);return;}catch{}
      const code=error&&typeof error==='object'&&'code'in error?error.code:'',phase=first&&typeof code==='string'&&terminalRejection.has(code)?'rejected':'unknown';this.setRequest({...request,phase,receipt:null,message:summaryFailure(error)});if(this.state.persistence==='ready')try{await this.persist({operation:'request',kind:'create',command:request.command,phase,receipt:null});}catch{}
    }finally{this.sending.delete(id);}
  }
  async checkRequest(request:SummaryCreationIntent):Promise<void>{
    const id=request.command.command_id;if(this.closed||this.sending.has(id))return;const generation=this.generation;this.sending.add(id);this.setRequest({...request,phase:'sending',message:'正在只读查证原创建回执…'});
    try{const receipt=await this.receipts(this.profileId,id);if(!this.live(generation))return;if(receipt&&this.state.persistence==='ready'){await this.requestCommitted(request,receipt,generation);return;}
      this.setRequest({...request,message:receipt?'服务器回执已读取，本机意图尚未可靠保存；请恢复缓存后再次查证，不创建新请求。':'尚未查到原创建回执；不会自动重发，可明确重试同一请求。'});
    }catch(error){if(this.live(generation))this.setRequest({...request,message:summaryFailure(error)});}finally{this.sending.delete(id);}
  }
  async retryRequest(request:SummaryCreationIntent):Promise<void>{if(request.phase==='committed'){await this.checkRequest(request);return;}await this.sendRequest(request,false);}
  async dismissRequest(request:SummaryCreationIntent):Promise<void>{if(!['committed','rejected'].includes(request.phase)||this.state.persistence!=='ready')return;try{await this.journal!.remove(request.command.command_id);if(!this.closed)this.emit({...this.state,requests:this.state.requests.filter(item=>item.command.command_id!==request.command.command_id)});}catch{this.emit({...this.state,persistence:'failed',error:'创建回执的本机确认清理未完成，原请求保留。'});}}
  async flush():Promise<void>{await this.initialization;if(this.journal)try{await this.journal.flush();}catch{this.emit({...this.state,persistence:'failed',error:'本机回顾意图未确认保存，原请求保留；未发送新的生成请求。'});}}
  fenceDispatch():void{++this.dispatchGeneration;}
  async close():Promise<void>{this.dispose();await this.initialization;await this.journal?.close();}
  dispose():void{this.closed=true;++this.generation;++this.detailGeneration;this.listeners.clear();this.origins.clear();}
}
