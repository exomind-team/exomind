import { BetaApiError } from './api-error';
import { validateReceipt, type BetaClient, type BetaReceipt, type BetaStatus } from './client';
import { betaUuid } from './initialization';
import type { BetaTimeblockAction, BetaTimeblockCommand, BetaTimeblockSnapshot } from './timeblocks-types';
import { validateTimeblockCommand, validateTimeblockSnapshot } from './timeblocks-validation';
import { openDurableIntentStorage, type DurableIntentStorage, type LocalIntentJournal, type IntentPredecessor } from './local-intent-journal';
import { productionIntentStorage } from './native-intent-journal';

export interface BetaStartDraft { name:string; note:string; mode:'countup'|'countdown'; minutes:number; endMode:'soft'|'hard'; revision:number }
export interface BetaFeedbackDraft { text:string; revision:number }
type DraftLink={kind:'start';revision:number}|{kind:'feedback';block_id:string;revision:number};
export interface PendingTimeblock { command:BetaTimeblockCommand; state:'pending'|'unknown'|'rejected'; link?:DraftLink; message?:string; code?:string }
interface Persisted {version:1;draft:BetaStartDraft;feedback:Record<string,BetaFeedbackDraft>;pending:PendingTimeblock[];confirmed:BetaReceipt[]}
export interface BetaTimeblockState extends Persisted {remote:BetaTimeblockSnapshot|null;identity:BetaStatus|null;receivedAt:number;loading:boolean;error:string|null;cacheError:string|null;persistenceState:'idle'|'pending'|'failed'}
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
const durable=(storage:StorageLike):storage is DurableIntentStorage=>'durable'in storage&&storage.durable===true;
const storageKey=(device:string,profile:string)=>`exomind:beta:timeblocks:${JSON.stringify([device,profile])}`;
const message=(error:unknown):string=>error&&typeof error==='object'&&'message'in error&&typeof error.message==='string'?error.message:typeof error==='string'?error:'时间块服务暂时不可用，请查证后重试';
const code=(error:unknown):string=>error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'?error.code:'unavailable';
const initial=():Persisted=>({version:1,draft:{name:'',note:'',mode:'countdown',minutes:25,endMode:'soft',revision:0},feedback:{},pending:[],confirmed:[]});
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function load(raw:string|null,profileId:string):Persisted{
  if(raw===null)return initial();const value=JSON.parse(raw) as Persisted;
  if(value.version!==1||!value.draft||!value.feedback||typeof value.feedback!=='object'||!Array.isArray(value.pending)||!Array.isArray(value.confirmed))throw new Error('Invalid timeblock cache');
  validateDraft(value.draft);
  for(const draft of Object.values(value.feedback))if(!draft||typeof draft.text!=='string'||!Number.isSafeInteger(draft.revision)||draft.revision<0)throw new Error('Invalid feedback cache');
  for(const pending of value.pending){
    const command=validateTimeblockCommand(pending.command);if(command.profile_id!==profileId||!['pending','unknown','rejected'].includes(pending.state))throw new Error('Invalid pending scope');
    pending.command=freeze(command);if(pending.state==='pending')pending.state='unknown';
    if(pending.link&&(!Number.isSafeInteger(pending.link.revision)||pending.link.revision<0||!['start','feedback'].includes(pending.link.kind)))throw new Error('Invalid pending draft revision');
    if(pending.link?.kind==='feedback'&&typeof pending.link.block_id!=='string')throw new Error('Invalid feedback target');
  }
  value.confirmed=value.confirmed.slice(-8).map(item=>{const receipt=validateReceipt(item);if(receipt.profile_id!==profileId)throw new Error('Invalid confirmed scope');return receipt;});
  return value;
}
function validateDraft(draft:BetaStartDraft):void{
  if(typeof draft.name!=='string'||typeof draft.note!=='string'||!['countup','countdown'].includes(draft.mode)||!['soft','hard'].includes(draft.endMode)
    ||!Number.isSafeInteger(draft.minutes)||draft.minutes<1||draft.minutes>720||!Number.isSafeInteger(draft.revision)||draft.revision<0)throw new BetaApiError('invalid_timeblock_draft','时间块草稿或时长无效');
}

/** Owns one device/profile's local intent journal. Timer ticks are pure reads;
 * neither a display timeout nor a closed feedback dialog submits a fact. */
export class BetaTimeblockController {
  readonly storageKey:string;
  private state:BetaTimeblockState;
  private disposed=false;private blocked=false;private readGeneration=0;
  private readonly listeners=new Set<()=>void>();private readonly flights=new Map<string,Promise<BetaReceipt|null>>();
  private readonly uuid:()=>string;private readonly now:()=>number;
  private unsubscribePersistence:(()=>void)|undefined;private closing:Promise<void>|undefined;
  static async open(client:BetaClient,deviceId:string,profileId:string,options:{journal?:LocalIntentJournal;predecessor?:IntentPredecessor;allowLegacyImport?:boolean;legacy?:Pick<Storage,'getItem'>;uuid?:()=>string;monotonicNow?:()=>number}={}):Promise<BetaTimeblockController>{
    const legacy=options.legacy??{getItem:(key:string)=>globalThis.localStorage?.getItem(key)??null};
    const defaults=options.journal?undefined:productionIntentStorage();
    const storage=await openDurableIntentStorage({key:storageKey(deviceId,profileId),journal:options.journal??defaults?.journal,predecessor:options.predecessor??defaults?.predecessor,allowLegacyImport:options.allowLegacyImport,legacy,validate:raw=>{load(raw,profileId);}});
    try{return new BetaTimeblockController(client,deviceId,profileId,storage,options);}catch(error){storage.close();throw error;}
  }
  constructor(private readonly client:BetaClient,private readonly deviceId:string,private readonly profileId:string,private readonly storage:StorageLike,
    options:{uuid?:()=>string;monotonicNow?:()=>number}={}){
    this.storageKey=storageKey(deviceId,profileId);
    this.uuid=options.uuid??betaUuid;this.now=options.monotonicNow??(()=>performance.now());
    let restored=initial();let cacheError:null|string=null;
    try{restored=load(storage.getItem(this.storageKey),profileId);}catch{this.blocked=true;cacheError='时间块草稿缓存无法读取，已保留原缓存并停止提交';}
    this.state={...restored,remote:null,identity:null,receivedAt:0,loading:false,error:null,cacheError,persistenceState:cacheError?'failed':'idle'};
    if(durable(storage))this.unsubscribePersistence=storage.subscribe(()=>{const status=storage.snapshot();this.emit({...this.state,persistenceState:status.state,cacheError:status.error});});
  }
  snapshot=():BetaTimeblockState=>this.state;
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  dispose():void{
    if(!this.disposed){this.disposed=true;++this.readGeneration;this.listeners.clear();this.unsubscribePersistence?.();}
    if(!this.closing){this.closing=(async()=>{try{if(durable(this.storage))await this.storage.commit();}finally{if(durable(this.storage))this.storage.close();}})();void this.closing.catch(()=>{});}
  }
  close():Promise<void>{this.dispose();return this.closing!;}
  async flush():Promise<void>{if(durable(this.storage))await this.storage.commit();}
  private active():void{if(this.disposed)throw new BetaApiError('inactive_session','当前时间块窗口已关闭');}
  private emit(next:BetaTimeblockState):void{if(this.disposed)return;this.state=next;for(const listener of this.listeners)listener();}
  private save(next:BetaTimeblockState,required=false):void{
    this.active();if(this.blocked)throw new BetaApiError('timeblock_cache_unavailable','请先处理无法读取的时间块草稿缓存');
    const {version,draft,feedback,pending,confirmed}=next;
    try{this.storage.setItem(this.storageKey,JSON.stringify({version,draft,feedback,pending,confirmed}));const status=durable(this.storage)?this.storage.snapshot():{state:'idle' as const,error:null};this.emit({...next,cacheError:status.error,persistenceState:status.state});}
    catch{if(required){this.emit({...this.state,persistenceState:'failed',cacheError:'本机草稿暂存失败，此次操作尚未发送'});throw new BetaApiError('timeblock_cache_unavailable','本机草稿暂存失败，此次操作尚未发送');}
      this.emit({...next,persistenceState:'failed',cacheError:'本机草稿暂存失败，请保留此窗口；已确认事实不受影响'});}
  }
  setStartDraft(patch:Partial<Omit<BetaStartDraft,'revision'>>):void{
    this.active();const draft={...this.state.draft,...patch,revision:this.state.draft.revision+1};validateDraft(draft);this.save({...this.state,draft});
  }
  setFeedbackDraft(blockId:string,text:string):void{
    this.active();const previous=this.state.feedback[blockId]??{text:'',revision:0};
    this.save({...this.state,feedback:{...this.state.feedback,[blockId]:{text,revision:previous.revision+1}}});
  }
  async refresh():Promise<void>{
    if(this.disposed)return;const generation=++this.readGeneration;this.emit({...this.state,loading:true,error:null});
    try{
      if(!this.client.timeblocks)throw new BetaApiError('unsupported_timeblocks','当前连接未提供时间块能力');
      const identity=await this.client.status();if(this.disposed||generation!==this.readGeneration)return;
      if(identity.device_id!==this.deviceId)throw new BetaApiError('identity_changed','服务设备身份已变化，旧草稿不会提交到新设备');
      const raw=await this.client.timeblocks.snapshot(this.profileId);if(this.disposed||generation!==this.readGeneration)return;
      const after=await this.client.status();if(this.disposed||generation!==this.readGeneration)return;
      if(after.device_id!==identity.device_id||after.runtime_id!==identity.runtime_id)throw new BetaApiError('runtime_changed','服务已重启，旧时间块读取未应用，请刷新');
      const remote=validateTimeblockSnapshot(raw,this.profileId,this.deviceId);
      this.emit({...this.state,remote,identity,receivedAt:this.now(),loading:false,error:null});
    }catch(error){if(!this.disposed&&generation===this.readGeneration)this.emit({...this.state,loading:false,error:message(error)});}
  }
  displayClock(){return this.state.remote?timeblockClock(this.state.remote,this.now()-this.state.receivedAt):null;}
  private current():BetaTimeblockSnapshot{
    this.active();if(!this.state.remote)throw new BetaApiError('timeblock_not_loaded','请先读取当前时间块');return this.state.remote;
  }
  private originalIntent(kind:BetaTimeblockAction['kind'],link?:DraftLink):PendingTimeblock|undefined{
    return this.state.pending.find(item=>item.state!=='rejected'&&item.command.action.kind===kind&&JSON.stringify(item.link)===JSON.stringify(link));
  }
  private spec(){
    const draft=this.state.draft;const lines=draft.name.trim().split(/\r?\n/);const name=lines.shift()?.trim()??'';
    if(!name)throw new BetaApiError('invalid_timeblock_draft','请填写时间块名称');
    return{block_id:this.uuid(),name,note:[lines.join('\n').trim(),draft.note.trim()].filter(Boolean).join('\n'),timer:draft.mode==='countup'?{mode:'count_up' as const}:{mode:'count_down' as const,duration_ms:draft.minutes*60_000,end_mode:draft.endMode}};
  }
  async start():Promise<BetaReceipt|null>{
    const link:DraftLink={kind:'start',revision:this.state.draft.revision};const previous=this.originalIntent('start',link);if(previous)return this.retry(previous.command.command_id);
    return this.execute({kind:'start',...this.spec()},link);
  }
  async rotate():Promise<BetaReceipt|null>{
    const link:DraftLink={kind:'start',revision:this.state.draft.revision};const previous=this.originalIntent('rotate',link);if(previous)return this.retry(previous.command.command_id);
    const active=this.current().active;if(!active)throw new BetaApiError('timeblock_not_running','当前没有可切换的时间块');
    return this.execute({kind:'rotate',from_block_id:active.block_id,next:this.spec()},link);
  }
  async control(kind:'pause'|'resume'|'end_action',blockId?:string):Promise<BetaReceipt|null>{
    const target=blockId??this.current().active?.block_id;if(!target)throw new BetaApiError('timeblock_not_running','当前没有活动时间块');
    return this.execute({kind,block_id:target});
  }
  async submitFeedback(blockId:string,skipped=false):Promise<BetaReceipt|null>{
    const draft=this.state.feedback[blockId]??{text:'',revision:0};if(!skipped&&!draft.text.trim())throw new BetaApiError('empty_feedback','填写反馈或明确选择跳过');
    return this.execute({kind:'submit_feedback',block_id:blockId,feedback:skipped?{kind:'skipped'}:{kind:'text',text:draft.text}}, {kind:'feedback',block_id:blockId,revision:draft.revision});
  }
  async appendFeedback(blockId:string):Promise<BetaReceipt|null>{
    const draft=this.state.feedback[blockId];if(!draft?.text.trim())throw new BetaApiError('empty_feedback','请填写追加反馈');
    return this.execute({kind:'append_feedback',block_id:blockId,text:draft.text},{kind:'feedback',block_id:blockId,revision:draft.revision});
  }
  async execute(action:BetaTimeblockAction,link?:DraftLink):Promise<BetaReceipt|null>{
    const remote=this.current();const previous=this.originalIntent(action.kind,link);
    if(previous&&JSON.stringify(previous.command.action)===JSON.stringify(action))return this.retry(previous.command.command_id);
    if(this.state.pending.some(item=>item.state!=='rejected'))throw new BetaApiError('timeblock_pending','上一操作结果待确认，请先查证；不会替换旧命令');
    const command=freeze(validateTimeblockCommand({command_id:this.uuid(),event_id:this.uuid(),profile_id:this.profileId,expected_revision:remote.revision,action}));
    const pending:PendingTimeblock={command,state:'pending',link};
    // This is the last synchronous qualification before any mutating RPC.
    this.save({...this.state,pending:[...this.state.pending,pending]},true);++this.readGeneration;
    this.emit({...this.state,loading:false});
    if(durable(this.storage)){
      try{await this.flush();}catch(error){if(!this.disposed)this.update(command.command_id,{state:'unknown',message:message(error),code:code(error)});throw error;}
      if(this.disposed)return null;
    }
    return this.send(pending,false);
  }
  async retry(commandId:string):Promise<BetaReceipt|null>{
    this.active();const saved=this.state.confirmed.find(item=>item.command_id===commandId);if(saved)return Promise.resolve(saved);
    const pending=this.state.pending.find(item=>item.command.command_id===commandId);
    if(!pending)return Promise.reject(new BetaApiError('missing_submission','找不到该时间块操作'));return this.send(pending,true);
  }
  dismissRejected(commandId:string):void{
    const pending=this.state.pending.find(item=>item.command.command_id===commandId);
    if(pending?.state!=='rejected')throw new BetaApiError('timeblock_pending','结果未知的命令不能当作已取消');
    this.save({...this.state,pending:this.state.pending.filter(item=>item!==pending)});
  }
  private update(id:string,patch:Partial<PendingTimeblock>):void{this.save({...this.state,pending:this.state.pending.map(item=>item.command.command_id===id?{...item,...patch}:item)});}
  private send(pending:PendingTimeblock,reconcile:boolean):Promise<BetaReceipt|null>{
    const id=pending.command.command_id;const existing=this.flights.get(id);if(existing)return existing;
    const operation=this.perform(pending,reconcile);this.flights.set(id,operation);
    void operation.finally(()=>{if(this.flights.get(id)===operation)this.flights.delete(id);}).catch(()=>{});return operation;
  }
  private confirm(pending:PendingTimeblock,value:unknown):BetaReceipt{
    const receipt=validateReceipt(value,pending.command);if(this.disposed)return receipt;
    const link=pending.link;let draft=this.state.draft;let feedback=this.state.feedback;
    if(link?.kind==='start'&&draft.revision===link.revision)draft={...draft,name:'',note:'',revision:draft.revision+1};
    if(link?.kind==='feedback'&&feedback[link.block_id]?.revision===link.revision)feedback={...feedback,[link.block_id]:{text:'',revision:link.revision+1}};
    this.save({...this.state,draft,feedback,pending:this.state.pending.filter(item=>item.command.command_id!==pending.command.command_id),confirmed:[...this.state.confirmed,receipt].slice(-8)});
    void this.refresh();return receipt;
  }
  private async perform(pending:PendingTimeblock,reconcile:boolean):Promise<BetaReceipt|null>{
    if(reconcile){try{const found=await this.client.receipt(this.profileId,pending.command.command_id);if(found)return this.confirm(pending,found);}
      catch(error){if(!this.disposed)this.update(pending.command.command_id,{state:'unknown',message:message(error),code:code(error)});return null;}}
    if(this.disposed)return null;
    try{
      if(!this.client.timeblocks)throw new BetaApiError('unsupported_timeblocks','当前连接未提供时间块能力');
      this.save({...this.state,pending:this.state.pending.map(item=>item.command.command_id===pending.command.command_id?{...item,state:'pending' as const,message:undefined}:item)},true);
      if(durable(this.storage)){await this.flush();if(this.disposed)return null;}
      return this.confirm(pending,await this.client.timeblocks.command(pending.command));
    }catch(error){if(!this.disposed)this.update(pending.command.command_id,{state:code(error)==='timeblock_conflict'?'rejected':'unknown',message:message(error),code:code(error)});return null;}
  }
}

export const MAX_CLOCK_EXTRAPOLATION_MS=2000;
export function timeblockClock(snapshot:BetaTimeblockSnapshot,elapsedSinceSample:number):{text:string;warning:boolean;endTimeText?:string;stale:boolean}{
  const active=snapshot.active;const elapsed=Math.max(0,elapsedSinceSample);const stale=elapsed>MAX_CLOCK_EXTRAPOLATION_MS;
  const safeToAdvance=active?.phase==='running'&&!snapshot.clock.epoch_changed&&!snapshot.clock.wall_clock_moved_back;
  const work=(active?.work_ms??0)+(safeToAdvance?Math.min(elapsed,MAX_CLOCK_EXTRAPOLATION_MS):0);
  const format=(ms:number)=>{const seconds=Math.floor(Math.max(0,ms)/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;};
  if(!active)return{text:'00:00',warning:false,stale};
  if(active.timer.mode==='count_up')return{text:format(work),warning:false,stale};
  const left=active.timer.duration_ms-work;const overtime=left<0&&active.timer.end_mode==='soft';
  const endTimeText=snapshot.clock.epoch_changed||snapshot.clock.wall_clock_moved_back?'时钟已重新锚定，以服务状态为准'
    :left<=0&&!active.deadline_reached&&active.phase==='running'?'等待服务确认到点状态'
      :active.deadline?`预计 ${new Date(active.deadline.due_at_ms).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})} 结束`:undefined;
  return{text:overtime?`+${format(-left)}`:format(left),warning:left<=60_000,endTimeText,stale};
}
