import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FieldSelect } from '@/components/ui/field-select';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import type { BetaClient } from './client';
import type { SummaryTasksController } from './summary-tasks-controller';
import { ManualSummarySelection } from './manual-summary-selection';
import { SummaryOriginalSelection, emptyOriginalChoice, summaryOriginalScope, type SummaryOriginalChoice } from './SummaryOriginalSelection';

export function BetaManualSummaryDialog({client,profileId,owner,onClose,now,dateMode}:{client:BetaClient;profileId:string;owner:SummaryTasksController;onClose:()=>void;now:number;dateMode:EventDateDisplayMode}){
  const [selection,setSelection]=useState<ManualSummarySelection|null>(null);
  useEffect(()=>{if(!client.timeblocks||!client.summaries)return;const current=new ManualSummarySelection(client.timeblocks,client.summaries,profileId);setSelection(current);void current.loadCandidates();return()=>current.dispose();},[client,client.timeblocks,client.summaries,profileId]);
  function close(){selection?.dispose();owner.fenceDispatch();onClose();}
  return<Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>手动压缩</DialogTitle><DialogDescription>选择已填写或明确跳过反馈的时间块，生成派生总块或派生记录。原文、原时间块与旧结果保留；不会改变计时状态。</DialogDescription></DialogHeader>
    {!client.timeblocks||!client.summaries?<p className="text-sm text-muted">当前连接缺少时间块或回顾读取能力。</p>:!selection?<p role="status" className="text-sm text-muted">正在打开当前档案的候选…</p>:<ManualSummaryBody key={profileId} client={client} profileId={profileId} selection={selection} owner={owner} now={now} dateMode={dateMode} onClose={close}/>}
  </DialogContent></Dialog>;
}
function ManualSummaryBody({client,profileId,selection,owner,now,dateMode,onClose}:{client:BetaClient;profileId:string;selection:ManualSummarySelection;owner:SummaryTasksController;now:number;dateMode:EventDateDisplayMode;onClose:()=>void}){
  const state=useSyncExternalStore(selection.subscribe,selection.snapshot),operations=useSyncExternalStore(owner.subscribe,owner.snapshot);
  const [mode,setMode]=useState<'single'|'range'>('single'),[start,setStart]=useState(''),[end,setEnd]=useState(''),[kind,setKind]=useState<'compressed_block'|'compressed_message'>('compressed_block'),[submitting,setSubmitting]=useState(false),[error,setError]=useState('');
  const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const [originalChoice,setOriginalChoice]=useState<SummaryOriginalChoice & {scope:string}>({...emptyOriginalChoice(),scope:''});
  const originalScope=state.selection?summaryOriginalScope(profileId,state.selection):'';
  const choice=originalChoice.scope===originalScope?originalChoice:emptyOriginalChoice();
  const canCreate=operations.persistence==='ready'&&!operations.requests.length;
  function reset(){selection.reset();setOriginalChoice({...emptyOriginalChoice(),scope:''});setError('');}
  async function submit(){if(submitting||!canCreate)return;setSubmitting(true);setError('');try{const confirmed=await selection.confirmed();if(!live.current)return;
    if(choice.ids.length){if(!choice.consent||originalChoice.scope!==summaryOriginalScope(profileId,confirmed))throw Error('Material consent changed');await owner.create(kind,{...confirmed,selected_original_ids:[...choice.ids]},choice.consent);}
    else await owner.create(kind,confirmed);
    if(!live.current)return;onClose();}catch{if(live.current)setError('确认范围尚未完成或已变化，未创建新请求；请重新核验。');}finally{if(live.current)setSubmitting(false);}}
  return<div className="space-y-4"><SettingsSection title="选择范围"><div className="space-y-3 px-4 py-3 text-sm">
    <label className="flex flex-wrap items-center justify-between gap-2">选择方式<FieldSelect label="压缩范围方式" value={mode} disabled={submitting} onValueChange={value=>{setMode(value as 'single'|'range');reset();}} options={[{value:'single',label:'单个时间块'},{value:'range',label:'从开始块到结束块的范围'}]}/></label>
    <label className="flex flex-wrap items-center justify-between gap-2">{mode==='single'?'时间块':'开始块'}<FieldSelect label={mode==='single'?'压缩时间块':'压缩开始块'} value={start} disabled={submitting} onValueChange={value=>{setStart(value);reset();}} options={[{value:'',label:'请选择候选'},...state.candidates.map(candidate=>({value:candidate.blockId,label:`${candidate.name||candidate.blockId.slice(0,8)}${candidate.hasFeedback?' · 已有反馈事实':' · 结束状态待核验'}`}))]}/></label>
    {mode==='range'&&<label className="flex flex-wrap items-center justify-between gap-2">结束块<FieldSelect label="压缩结束块" value={end} disabled={submitting} onValueChange={value=>{setEnd(value);reset();}} options={[{value:'',label:'请选择候选'},...state.candidates.map(candidate=>({value:candidate.blockId,label:candidate.name||candidate.blockId.slice(0,8)}))]}/></label>}
    <p className="text-xs text-muted">已读取 {state.nodesRead} 条本机时间块节点。{state.nodesComplete?'本次固定读取位置的候选分页已结束；不表示其他设备资料全部同步。':'候选尚未读完；分界范围必须继续读取，不能把当前页当作全部。单块可独立核验。'}</p>
    {!state.nodesComplete&&<Button variant="outline" size="sm" disabled={state.loading||submitting||state.nodesRead>=10000} onClick={()=>{void selection.loadCandidates();}}>继续读取候选（100条节点）</Button>}
    <Button variant="outline" size="sm" disabled={state.loading||submitting||!start||mode==='range'&&(!end||!state.nodesComplete)} onClick={()=>{void selection.prepare(start,mode==='range'?end:undefined);}}>核验真实范围</Button>
    {state.loading&&<p role="status" className="text-xs text-muted">正在核验本机来源与分界；尚未创建生成请求…</p>}
    {state.error&&<p role="alert" className="text-xs text-destructive">{state.error}</p>}
    {state.stage==='intervals'&&<><p className="text-xs text-muted">区间分页尚未读完，尚未确认所有中间块。不会跳过中间块或使用当前时间猜结束边界。</p><Button variant="outline" size="sm" disabled={state.loading||submitting} onClick={()=>{void selection.continueIntervals();}}>继续核验区间（100项）</Button></>}
  </div></SettingsSection>
    <SettingsSection title="派生形式"><div className="space-y-3 px-4 py-3 text-sm"><label className="flex items-center justify-between gap-2">生成形式<FieldSelect label="压缩派生形式" value={kind} disabled={submitting} onValueChange={value=>setKind(value as typeof kind)} options={[{value:'compressed_block',label:'总块'},{value:'compressed_message',label:'记录'}]}/></label><p className="text-xs text-muted">只生成可追溯的派生结果，原件默认不选择给模型。配置未就绪时由真实任务进入等待配置状态，不冒充已执行。</p></div></SettingsSection>
    {state.stage==='ready'&&state.selection&&<div className="space-y-2 text-sm"><p>已核验 {state.selection.block_ids.length} 个时间块（含范围内可确认的零时长中间块）。</p><p className="flex flex-wrap gap-1"><EventTimestamp timestamp={state.selection.from_ms} now={now} mode={dateMode}/><span>至</span><EventTimestamp timestamp={state.selection.to_ms} now={now} mode={dateMode}/></p><p className="text-xs text-muted">区间空白段 {state.gapCount} 项；仅表示本机此读取范围，不表示现实活动完整。确认后将可靠保存固定请求再提交，可能产生模型费用。</p></div>}
    {state.stage==='ready'&&state.selection&&client.summaryModel&&client.timelinePeriodPage&&client.summaries?.requestWithMaterialConsent&&<SummaryOriginalSelection key={originalScope} client={client} profileId={profileId} selection={state.selection} disabled={submitting||!canCreate} onChange={next=>setOriginalChoice({...next,scope:originalScope})}/>}
    {!canCreate&&<p role="alert" className="text-xs text-muted">本机意图尚未就绪或有原创建请求需要查证、确认；不会创建另一个付费请求。</p>}{error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" onClick={onClose}>返回</Button><Button disabled={!canCreate||state.stage!=='ready'||state.loading||submitting||!!choice.ids.length&&!choice.consent} onClick={()=>{void submit();}}>{submitting?'正在保存固定意图…':choice.ids.length?(kind==='compressed_block'?'发送所选原件并创建总块':'发送所选原件并创建记录'):kind==='compressed_block'?'确认创建总块':'确认创建记录'}</Button></DialogFooter>
  </div>;
}
