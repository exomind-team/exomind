import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { Divider,SettingRow } from '@/ui/app/components/settings-shared';
import { formatEventTimestamp,type EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import { BetaReviewView,summaryArtifactLabel,summaryStateLabel } from './BetaReviewView';
import { SummaryTasksController,type SummaryControlKind } from './summary-tasks-controller';
import type { BetaClient } from './client';
import type { SummaryArtifactRecord,SummarySourceRef,SummaryTaskView } from './summary-types';
import type { LocalIntentJournal } from './local-intent-journal';
import { BetaManualSummaryDialog } from './BetaManualSummaryDialog';

interface Slot {client:BetaClient;deviceId:string;profileId:string;owner:SummaryTasksController;active:boolean}
export function BetaSummaryTasksPanel({open,onOpenChange,client,deviceId,profileId,target,revision,now,dateMode,onConfigure,onChanged,onOpenSource,intentJournal,onOwner}:{open:boolean;onOpenChange:(open:boolean)=>void;client:BetaClient;deviceId:string;profileId:string;target:SummaryArtifactRecord|null;revision:number;now:number;dateMode:EventDateDisplayMode;onConfigure:()=>void;onChanged:()=>void;onOpenSource?:(source:SummarySourceRef)=>void;intentJournal?:LocalIntentJournal;onOwner?:(owner:SummaryTasksController)=>void}){
  const [slot,setSlot]=useState<Slot|null>(null);const changed=useRef(onChanged);changed.current=onChanged;
  const lifecycle=useRef(onOwner);lifecycle.current=onOwner;
  useEffect(()=>{if(!client.summaries||!deviceId||!profileId){setSlot(null);return;}const owner=new SummaryTasksController(client.summaries,deviceId,profileId,(profile,command)=>client.receipt(profile,command),undefined,()=>changed.current(),intentJournal);lifecycle.current?.(owner);const next={client,deviceId,profileId,owner,active:true};setSlot(next);return()=>{next.active=false;void owner.close();};},[client,client.summaries,deviceId,profileId,intentJournal]);
  const owner=slot?.active&&slot.client===client&&slot.deviceId===deviceId&&slot.profileId===profileId?slot.owner:null;
  return<Dialog open={open} onOpenChange={value=>{if(!value)owner?.fenceDispatch();onOpenChange(value);}}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>回顾</DialogTitle><DialogDescription>按页读取任务，每批 25 项；结果与当前资格分开显示，旧版本和原文保留。</DialogDescription></DialogHeader>
    {!client.summaries?<p className="text-sm text-muted">当前连接尚未提供回顾任务能力。</p>:!owner?<p role="status" className="text-sm text-muted">正在打开当前档案的回顾…</p>:<TaskPanelBody client={client} owner={owner} open={open} target={target} revision={revision} now={now} dateMode={dateMode} canConfigure={!!client.summaryModel} onConfigure={()=>{onOpenChange(false);onConfigure();}} onOpenSource={onOpenSource}/>}
  </DialogContent></Dialog>;
}
function TaskPanelBody({client,owner,open,target,revision,now,dateMode,canConfigure,onConfigure,onOpenSource}:{client:BetaClient;owner:SummaryTasksController;open:boolean;target:SummaryArtifactRecord|null;revision:number;now:number;dateMode:EventDateDisplayMode;canConfigure:boolean;onConfigure:()=>void;onOpenSource?:(source:SummarySourceRef)=>void}){
  const state=useSyncExternalStore(owner.subscribe,owner.snapshot);const [confirm,setConfirm]=useState<{kind:SummaryControlKind;task:SummaryTaskView;recoveryOnly?:boolean}|null>(null);
  const [manualOpen,setManualOpen]=useState(false);
  useEffect(()=>{if(!open)return;void owner.loadTasks();if(target)void owner.selectTask(target.task_id,target);else if(owner.snapshot().detail)void owner.refreshSelected();},[owner,open,target?.event_id]);
  useEffect(()=>{if(open&&owner.snapshot().detail)void owner.refreshSelected();},[owner,open,revision]);
  const task=state.detail?.task;const active=task&&['queued','running','retry_wait'].includes(task.state);
  useEffect(()=>{if(!open||!active)return;let disposed=false;let timer:ReturnType<typeof setTimeout>|undefined;const tick=async()=>{if(!document.hidden)await owner.refreshSelected();if(!disposed)timer=setTimeout(()=>{void tick();},2000);};timer=setTimeout(()=>{void tick();},2000);return()=>{disposed=true;clearTimeout(timer);};},[owner,open,active,task?.task_id]);
  const intent=task?state.intents.find(item=>item.command.task_id===task.task_id):undefined;
  const eligible=state.persistence==='ready'&&!!task&&task.owner_device_id===owner.deviceId&&!task.conflicts.length&&task.control_heads.length<=128&&task.owner_generation<Number.MAX_SAFE_INTEGER&&!intent;
  const local=task?.owner_device_id===owner.deviceId;
  const takeover=state.persistence==='ready'&&!!task&&!local&&!task.conflicts.length&&task.control_heads.length<=128&&task.owner_generation<Number.MAX_SAFE_INTEGER&&!intent&&!['succeeded','cancelled'].includes(task.state);
  const versions=state.detail?[...new Map([...(state.detail.selected?[state.detail.selected]:[]),...state.detail.artifacts].map(item=>[item.event_id,item])).values()]:[];
  return<div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" disabled={state.loading} onClick={()=>{void owner.loadTasks();void owner.refreshSelected();}}>刷新回顾任务</Button><Button variant="outline" size="sm" disabled={!client.timeblocks||state.persistence!=='ready'||!!state.requests.length} onClick={()=>setManualOpen(true)}>手动压缩</Button><span className="text-xs text-muted">已读取 {state.tasks.length} 项，每次读取 25 项</span></div>
    {state.error&&<p role="alert" className="text-xs text-destructive">{state.error}</p>}
    {state.persistence==='loading'&&<p role="status" className="text-xs text-muted">正在可靠恢复本机回顾意图，尚未启用新请求…</p>}
    {state.persistence==='failed'&&<div className="space-y-2 text-xs text-muted"><p>本机确认缓存不可用，原缓存保留。生成、重试新轮次、更新另存与接管已停用；仅取消可走显式服务请求，结果以服务回读为准。</p><Button variant="outline" size="sm" onClick={()=>{void owner.reopenJournal();}}>重新读取本机回顾意图</Button></div>}
    <div className="grid min-w-0 gap-4 lg:grid-cols-2"><SettingsSection title="任务列表">
      {state.tasks.map((item,index)=><div key={item.task_id}>{index>0&&<Divider/>}<SettingRow label={`${summaryArtifactLabel(item.artifact_kind)} · ${formatEventTimestamp(item.created_at_ms,dateMode,now)}`} right={<span className="text-xs text-muted">{summaryStateLabel(item.state)}</span>} onClick={()=>{void owner.selectTask(item.task_id);}}/></div>)}
      {state.listLoaded&&!state.tasks.length&&<p className="px-4 py-4 text-xs text-muted">当前页没有任务。</p>}
      {state.loading&&<p role="status" className="px-4 py-3 text-xs text-muted">正在读取任务…</p>}
      <div className="px-4 py-3">{state.nextAfter?<Button variant="ghost" size="sm" disabled={state.loading} onClick={()=>{void owner.loadTasks(true);}}>更多任务（25项）</Button>:state.listLoaded&&<p className="text-xs text-muted">当前查询没有下一页。</p>}</div>
    </SettingsSection><div className="min-w-0 space-y-3">
      {!task?<p role="status" className="text-sm text-muted">{state.detail?.loading?'正在读取任务资格…':'请选择一项任务。'}</p>:<>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" disabled={state.detail?.loading} onClick={()=>{void owner.refreshSelected();}}>刷新所选任务</Button>
          {!!versions.length&&<select aria-label="回顾版本" className="h-9 max-w-full rounded-md border border-input bg-page px-2 text-xs dark:bg-page-dark" value={state.detail?.selected?.event_id??''} disabled={state.detail?.loading} onChange={event=>owner.selectArtifact(event.target.value)}><option value="" disabled>选择已读取版本</option>{versions.map(item=><option key={item.event_id} value={item.event_id}>{formatEventTimestamp(item.occurred_at_ms,dateMode,now)} · {item.event_id.slice(0,8)}</option>)}</select>}
        </div>
        <BetaReviewView task={task} artifact={state.detail?.selected} now={now} dateMode={dateMode} localDeviceId={owner.deviceId} qualificationPending={state.detail?.qualificationPending}
          pendingAction={intent?.phase==='sending'?(intent.kind==='resume'||intent.kind==='takeover'?'retry':intent.kind):null}
          actions={{...(canConfigure&&local&&task.state==='waiting_configuration'?{configure:onConfigure}:{}),...(eligible&&['waiting_configuration','queued','running','retry_wait'].includes(task.state)?{cancel:(task:SummaryTaskView)=>setConfirm({kind:'cancel',task})}:{}),...(eligible&&task.state==='failed'?{retry:(task:SummaryTaskView)=>setConfirm({kind:'retry',task})}:{}),...(eligible&&task.coverage_changed&&task.state!=='cancelled'?{update:(task:SummaryTaskView)=>setConfirm({kind:'update',task})}:{}),...(onOpenSource?{openSource:(source:SummarySourceRef)=>onOpenSource(source)}:{}),openLatest:id=>{void owner.openArtifact(id);}}}
          extraActions={<>{eligible&&task.state==='cancelled'&&<Button variant="outline" size="sm" onClick={()=>setConfirm({kind:'resume',task})}>恢复已取消的回顾（新一轮）</Button>}{takeover&&<Button variant="outline" size="sm" onClick={()=>setConfirm({kind:'takeover',task})}>接管到本机并开启新一轮</Button>}{state.persistence==='failed'&&local&&!['cancelled','succeeded'].includes(task.state)&&!state.intents.some(item=>item.recoveryOnly&&item.command.task_id===task.task_id)&&<Button variant="outline" size="sm" onClick={()=>setConfirm({kind:'cancel',task,recoveryOnly:true})}>仅请求取消</Button>}</>}/>
        {!local&&<p className="text-xs text-muted">默认由另一设备负责；只有明确接管才改变执行归属，不会自动争抢。</p>}
        {task.control_heads.length>128&&<p role="alert" className="text-xs text-destructive">控制分支超过 128，需处理后再操作；不会截断提交。</p>}
        {!!task.conflicts.length&&<p className="text-xs text-muted">控制存在冲突，本入口不自动裁决归属；请处理后刷新。</p>}
        {state.detail?.nextBefore!==null&&state.detail&&<Button variant="outline" size="sm" disabled={state.detail.loading} onClick={()=>{void owner.moreArtifacts();}}>更多版本（25项）</Button>}
      </>}
      {state.detail?.error&&<p role="alert" className="text-xs text-destructive">{state.detail.error}</p>}
      {state.intents.map(item=><div key={item.command.command_id} className="space-y-2 text-xs text-muted"><p role="status">{item.message}</p><div className="flex flex-wrap gap-1"><Button variant="ghost" size="sm" disabled={item.phase==='sending'} onClick={()=>{void owner.check(item);}}>查证原操作</Button>{item.phase==='rejected'&&item.recoveryOnly?<Button variant="outline" size="sm" onClick={()=>owner.dismissRecoveryCancellation(item)}>结束被拒取消并刷新</Button>:item.phase==='rejected'?<Button variant="outline" size="sm" disabled={state.persistence!=='ready'} onClick={()=>{void owner.dismissRejected(item);}}>放弃被拒操作并刷新</Button>:<Button variant="outline" size="sm" disabled={item.phase==='sending'||state.persistence!=='ready'&&!item.recoveryOnly} onClick={()=>{void owner.retryIntent(item);}}>{item.phase==='committed'?'重新读取已确认状态':'重试同一请求'}</Button>}</div></div>)}
      {state.requests.map(item=><div key={item.command.command_id} className="space-y-2 text-xs text-muted"><p role="status">{item.message}</p><p>{item.command.artifact_kind==='compressed_block'?'总块':'记录'} · {item.command.selection.block_ids.length} 个已选时间块 · 请求 {item.command.command_id.slice(0,8)}</p><div className="flex flex-wrap gap-1"><Button variant="ghost" size="sm" disabled={item.phase==='sending'} onClick={()=>{void owner.checkRequest(item);}}>查证原创建请求</Button>{['committed','rejected'].includes(item.phase)?<Button variant="outline" size="sm" disabled={state.persistence!=='ready'} onClick={()=>{void owner.dismissRequest(item);}}>{item.phase==='committed'?'已了解本机回执':'放弃被拒创建请求'}</Button>:<Button variant="outline" size="sm" disabled={item.phase==='sending'||state.persistence!=='ready'} onClick={()=>{void owner.retryRequest(item);}}>重试同一创建请求</Button>}</div></div>)}
    </div></div>
    <Dialog open={!!confirm} onOpenChange={value=>{if(!value)setConfirm(null);}}><DialogContent><DialogHeader><DialogTitle>{confirm?.kind==='cancel'?'取消生成':confirm?.kind==='resume'?'明确恢复已取消的回顾':confirm?.kind==='takeover'?'明确接管到本机并开启新一轮':confirm?.kind==='update'?'更新另存一个版本':'重试生成（新一轮）'}</DialogTitle><DialogDescription>{confirm?.kind==='cancel'?'将保存取消控制，使旧执行失去后续提交资格；已发出的供应商请求能否停止计费由上游决定。':confirm?.kind==='resume'?'这是明确恢复已取消任务，将开启新一轮；原始记录与旧结果保留。':confirm?.kind==='takeover'?'将改变生成归属到本机并创建新执行。原设备可能稍后才收到控制；已发出的上游调用及计费由供应商决定。不会自动恢复已取消任务。':confirm?.kind==='update'?'将沿用任务当前范围和已选择的原件生成新版本，不覆盖原文，也不替换正在阅读的旧版本。':'将创建新执行轮次，不复用此前的执行资格；原文与旧结果保留。'}</DialogDescription></DialogHeader>
      {confirm&&<p className="text-xs text-muted">范围内时间块 {confirm.task.selection.block_ids.length} 个 · 已选择原件 {confirm.task.selection.selected_original_ids.length} 件；不会自动选择新原件。</p>}
      {confirm?.recoveryOnly&&<p role="alert" className="text-xs text-destructive">本机确认缓存不可用。本次只重新读取任务并请求取消，不生成、不接管；未知结果仅在此窗口保留同一请求供查证，关闭后不自动重发。</p>}
      <DialogFooter><Button variant="outline" onClick={()=>setConfirm(null)}>返回</Button><Button onClick={()=>{const item=confirm;if(item){setConfirm(null);if(item.recoveryOnly)void owner.cancelWithoutJournal(item.task.task_id);else void owner.act(item.kind,item.task);}}}>确认{confirm?.kind==='cancel'?'取消':confirm?.kind==='resume'?'恢复':confirm?.kind==='takeover'?'接管并开启新一轮':confirm?.kind==='update'?'更新另存':'重试新一轮'}</Button></DialogFooter>
    </DialogContent></Dialog>
    {manualOpen&&<BetaManualSummaryDialog client={client} profileId={owner.profileId} owner={owner} now={now} dateMode={dateMode} onClose={()=>setManualOpen(false)}/>}
  </div>;
}
