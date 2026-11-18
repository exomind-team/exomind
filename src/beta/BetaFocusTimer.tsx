import { useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type KeyboardEvent } from 'react';
import { FocusTimerView,type FocusTimerViewModel } from '@/ui/app/components/FocusTimerView';
import { TimeBlockFeedbackDialog } from '@/ui/app/components/TimeBlockFeedbackDialog';
import { Button } from '@/components/ui/button';
import type { BetaClient,BetaReceipt } from './client';
import { BetaTimeblockController,timeblockControlsBlocked } from './timeblocks-controller';
import { runActionOnPrimaryModifierEnter } from '@/ui/app/components/dialog-submit-shortcuts';
import { useBetaViewActive } from './view-activity';
import { ChevronDown, RefreshCw, Target } from 'lucide-react';

const message=(error:unknown)=>error&&typeof error==='object'&&'message'in error?String(error.message):'时间块操作尚未确认，请查证后重试';
type Panel={kind:'start'}|{kind:'rotate';from:string;name:string}|null;
type FeedbackTarget={id:string;kind:'submit'|'append'}|null;
export interface BetaFocusHandoffTarget {handoffId:string;blockId:string;attempt:number}

/** Presentation is the actual Alpha View. This component owns only transient
 * panel/dialog choices; controller/journal/Host own intent and business state. */
export function BetaFocusTimer({controller,client,profileId,onCommitted,handoffTarget,onHandoffReady,onOpenSync,onCollapse,visible=true}:{controller:BetaTimeblockController;client:BetaClient;profileId:string;onCommitted?:()=>void;handoffTarget?:BetaFocusHandoffTarget;onHandoffReady?:(id:string,hint:string,attempt:number)=>void;onOpenSync?:()=>void;onCollapse?:()=>void;visible?:boolean}){
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot);
  const observing = useBetaViewActive(visible);
  const [panel,setPanel]=useState<Panel>(null);
  const initializedOwner=useRef<BetaTimeblockController|null>(null);
  const [custom,setCustom]=useState({editing:false,text:String(state.draft.minutes)});
  const [feedback,setFeedback]=useState<FeedbackTarget>(null);
  const [openedHandoff,setOpenedHandoff]=useState('');const readyHandoff=useRef('');
  const [feedbackPortal,setFeedbackPortal]=useState<HTMLDivElement|null>(null);
  const [error,setError]=useState('');const [roster,setRoster]=useState<Record<string,string>>({});const [choice,setChoice]=useState('');
  const [,tick]=useState(0);const alive=useRef(true);
  const configInput=useRef<HTMLTextAreaElement>(null);const customInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[controller]);
  useEffect(()=>{
    if(!observing)return;
    // Presentation owns interpolation repaint only. Controller.open/close owns
    // the state reader shared with the independent desktop overlay.
    const display=setInterval(()=>tick(value=>value+1),250);
    return()=>clearInterval(display);
  },[controller,observing]);
  useEffect(()=>{
    if(!state.remote||initializedOwner.current===controller)return;
    initializedOwner.current=controller;
    // The first authoritative read decides what is running. A retained next
    // draft stays in the journal until the user explicitly opens rotation.
    setPanel(!state.remote.active&&state.draft.name.trim()?{kind:'start'}:null);
  },[controller,state.remote,state.draft.name]);
  useEffect(()=>{
    if(!observing)return;
    const remote=state.remote;if(!remote)return;
    setRoster(previous=>{const next={...previous};if(remote.active)next[remote.active.block_id]=remote.active.name;for(const id of remote.pending_feedback)next[id]??=`时间块 ${id.slice(0,8)}`;return next;});
    let cancelled=false;
    void client.timeblocks?.nodes(profileId,{limit:100}).then(page=>{
      if(cancelled)return;setRoster(previous=>{const next={...previous};for(const node of page.items){if(node.payload.kind!=='action')continue;const action=node.payload.action;if(action.kind==='start')next[action.block_id]=action.name;else if(action.kind==='rotate')next[action.next.block_id]=action.next.name;}return next;});
    }).catch(()=>{/* Labels can remain explicit IDs; this is not a completeness claim. */});
    return()=>{cancelled=true;};
  },[client,profileId,state.remote?.revision,observing]);
  useEffect(()=>{if(panel)configInput.current?.focus();},[panel?.kind]);
  useEffect(()=>{if(custom.editing){customInput.current?.focus();customInput.current?.select();}},[custom.editing]);
  const disabled=timeblockControlsBlocked(state);
  async function run(action:()=>Promise<BetaReceipt|null>,completed?:()=>void){
    setError('');try{const receipt=await action();if(receipt&&alive.current){completed?.();onCommitted?.();}}catch(failure){if(alive.current)setError(message(failure));}
  }
  function setDraft(patch:Parameters<BetaTimeblockController['setStartDraft']>[0]){try{controller.setStartDraft(patch);}catch(failure){setError(message(failure));}}
  function start(){if(disabled){setError('当前操作或本机暂存尚未确认，请先查证');return;}
    if(panel?.kind==='rotate'&&state.remote?.active?.block_id!==panel.from){setError('当前时间块已变化，请重新确认切换目标');return;}
    void run(()=>panel?.kind==='rotate'?controller.rotate():controller.start(),()=>setPanel(null));
  }
  const quick=(event:KeyboardEvent<HTMLElement>)=>!event.nativeEvent.isComposing&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey;
  function applyMinutes(raw:string){const number=Number.parseInt(raw,10);const minutes=Number.isFinite(number)?Math.max(1,Math.min(720,number)):state.draft.minutes;setDraft({mode:'countdown',minutes});setCustom({editing:false,text:String(minutes)});}
  const active=state.remote?.active;const clock=controller.displayClock();
  const pendingFeedback=[...new Set([...(state.remote?.pending_feedback??[]),...(active?.phase==='feedback_pending'?[active.block_id]:[])])];
  const handoffKey=handoffTarget?`${handoffTarget.handoffId}:${handoffTarget.attempt}`:'';
  const handoffPending=!!handoffTarget&&pendingFeedback.includes(handoffTarget.blockId);
  useEffect(()=>{
    if(!handoffTarget||!state.remote||disabled)return;
    if(openedHandoff!==handoffKey){
      setOpenedHandoff(handoffKey);
      // Only this explicit notification/open attempt opens a dialog. A closed
      // dialog stays closed across the controller's periodic snapshot reads.
      setPanel(null);setFeedback(handoffPending?{id:handoffTarget.blockId,kind:'submit'}:null);
    }else if(!handoffPending&&feedback?.id===handoffTarget.blockId&&feedback.kind==='submit')setFeedback(null);
  },[handoffKey,handoffTarget,state.remote,disabled,handoffPending,feedback,openedHandoff]);
  useLayoutEffect(()=>{
    if(!handoffTarget||!state.remote||disabled||openedHandoff!==handoffKey||readyHandoff.current===handoffKey)return;
    if(handoffPending){
      if(feedback?.id!==handoffTarget.blockId||feedback.kind!=='submit')return;
      const marker=feedbackPortal?.dataset.betaFeedbackBlockId===handoffTarget.blockId&&feedbackPortal.dataset.betaFeedbackKind==='submit'?feedbackPortal:null;
      const dialog=marker?.closest('[role="dialog"]');
      if(!marker?.isConnected||dialog?.getAttribute('data-state')!=='open'||!dialog.querySelector('[data-testid="new-focus-feedback-textarea"]'))return;
    }else if(feedback?.id===handoffTarget.blockId&&feedback.kind==='submit')return;
    // The section alone is mounted before remote hydration. ACK readiness now
    // requires its real snapshot, and pending sources require the exact form.
    readyHandoff.current=handoffKey;
    const prefix=`提醒时间块 ${handoffTarget.blockId.slice(0,8)}：`;
    const hint=handoffPending?prefix+'行动已结束，等待反馈。':active?.block_id===handoffTarget.blockId?prefix+(active.phase==='completed'?'已完成；已打开来源档案的时间块。':active.phase==='paused'?'当前已暂停。':'当前仍在运行。'):'';
    onHandoffReady?.(handoffTarget.handoffId,hint,handoffTarget.attempt);
  },[handoffKey,handoffTarget,state.remote,disabled,openedHandoff,handoffPending,feedback,feedbackPortal,active,onHandoffReady]);
  let model:FocusTimerViewModel={phase:'idle'};
  if(panel)model={phase:'config',name:state.draft.name,mode:state.draft.mode,minutes:state.draft.minutes,custom:{editing:custom.editing,draft:custom.text}};
  else if(active&&clock)model={phase:'running',name:{text:active.name||'未命名时间块',draft:'',editing:false,saving:false,readOnly:true},clock,
    paused:active.phase!=='running',feedback:{inProgress:active.phase==='feedback_pending',dialogOpen:feedback?.id===active.block_id},linkedTasks:[]};
  const feedbackDraft=feedback?state.feedback[feedback.id]?.text??'':'';
  function submitFeedback(skipped=false){if(!feedback||disabled)return;const target=feedback;
    void run(()=>target.kind==='append'?controller.appendFeedback(target.id):controller.submitFeedback(target.id,skipped),()=>{
      setFeedback(current=>current?.id===target.id&&current.kind===target.kind&&!controller.snapshot().feedback[target.id]?.text.trim()?null:current);
    });
  }
  const selected=choice||active?.block_id||Object.keys(roster)[0]||'';
  return <section aria-label="时间块" className="shrink-0 px-3 pb-2">
    <div className="flex min-h-9 flex-wrap items-center gap-1 py-1 text-xs text-secondary">
      {onCollapse&&<Button size="sm" variant="ghost" aria-label="折叠专注" aria-expanded="true" onClick={onCollapse}><Target size={14} aria-hidden="true"/><ChevronDown size={12} aria-hidden="true"/></Button>}
      {active&&<Button size="sm" variant="ghost" disabled={disabled} onClick={()=>{setCustom({editing:false,text:String(state.draft.minutes)});setPanel({kind:'rotate',from:active.block_id,name:active.name});}}>切换时间块</Button>}
      {!!Object.keys(roster).length&&<><select aria-label="反馈时间块" className="max-w-44 rounded-md border border-input bg-transparent p-1" value={selected} onChange={event=>setChoice(event.target.value)}>{Object.entries(roster).map(([id,name])=><option value={id} key={id}>{name}</option>)}</select><Button size="sm" variant="ghost" disabled={!selected||disabled} onClick={()=>setFeedback({id:selected,kind:'append'})}>追加反馈</Button></>}
      <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" aria-label="刷新时间块" title="刷新时间块" onClick={()=>void controller.refresh()}><RefreshCw size={14} aria-hidden="true" /></Button>
      {state.persistenceState==='pending'?<span role="status">正在暂存时间块草稿…</span>:state.persistenceState==='idle'&&(state.draft.name.trim()||Object.values(state.feedback).some(item=>item.text.trim()))?<span role="status">草稿已暂存 · 尚未提交</span>:null}
    </div>
    {(error||state.error||state.cacheError)&&<p role="alert" className="px-5 py-2 text-xs text-destructive">{error||state.error||state.cacheError}</p>}
    {state.errorCode==='timeblock_history_incomplete'&&<div className="space-y-2 px-5 pb-2 text-xs text-secondary">
      <p>现有记录已保留，请保留当前草稿。时间块状态尚未确认，暂不能开始或控制计时。文字已到达不代表时间块历史已补齐。</p>
      <p>先让参与过此档案时间块的设备上线，在同步页核对同一档案的设备授权和连接，逐台点击「立即同步」，然后返回刷新时间块。历史可经同版已授权设备中转；尚缺来源证明时，仍需原来源设备上线补齐。</p>
      <p>若仍未恢复，请保留资料，记录未连接的来源设备和同步页错误以继续核对；不要清空档案或重建时间块历史。</p>
      {onOpenSync&&<Button variant="outline" size="sm" onClick={onOpenSync}>查看设备同步</Button>}
    </div>}
    {state.persistenceState==='failed'&&<Button size="sm" variant="outline" className="mx-5 mb-2" onClick={()=>{void controller.flush().then(()=>setError('')).catch(failure=>setError(message(failure)));}}>重试本机暂存</Button>}
    {state.pending.map(item=><div key={item.command.command_id} className="flex items-center gap-2 px-5 py-2 text-xs text-secondary"><span className="min-w-0 flex-1">{item.state==='pending'?'正在确认时间块操作…':item.state==='rejected'?'时间块已变化，此操作被拒绝':'时间块操作结果待确认'}{item.message&&`：${item.message}`}</span>{item.state==='rejected'?<Button size="sm" variant="outline" onClick={()=>{controller.dismissRejected(item.command.command_id);void controller.refresh();}}>放弃被拒操作</Button>:<Button size="sm" variant="outline" disabled={item.state==='pending'} onClick={()=>void run(()=>controller.retry(item.command.command_id))}>查证时间块操作</Button>}</div>)}
    {!state.remote?<p role="status" className="px-5 py-3 text-xs text-muted">{state.error?'尚未读取到可用的时间块状态，请按错误提示处理后刷新。':'正在恢复并读取时间块…'}</p>:<>
      <FocusTimerView surface="workspace" startLabel={panel?.kind==='rotate'?'切换并开始':'开始计时'} model={model} actionsDisabled={disabled} actions={{
        expand:()=>{setCustom({editing:false,text:String(state.draft.minutes)});setPanel({kind:'start'});},collapse:()=>setPanel(null),
        selectTiming:(mode,minutes)=>{setCustom({editing:false,text:String(minutes??state.draft.minutes)});setDraft({mode,...(minutes===undefined?{}:{minutes})});},
        editCustom:()=>setCustom({editing:true,text:String(state.draft.minutes)}),start,beginRename:()=>{},
        pauseResume:()=>{if(active&&!disabled)void run(()=>controller.control(active.phase==='paused'?'resume':'pause',active.block_id));},
        end:()=>{if(!active||disabled)return;if(active.phase==='feedback_pending')setFeedback({id:active.block_id,kind:'submit'});else void run(()=>controller.control('end_action',active.block_id),()=>setFeedback({id:active.block_id,kind:'submit'}));},
      }} bindings={{
        configName:{inputRef:configInput,onChange:event=>setDraft({name:event.target.value}),onKeyDown:event=>{if(quick(event)){event.preventDefault();start();}}},
        customMinutes:{inputRef:customInput,onChange:event=>setCustom({editing:true,text:event.target.value.replace(/[^\d]/g,'')}),onBlur:()=>applyMinutes(custom.text),onKeyDown:event=>{
          if(event.nativeEvent.isComposing)return;if(quick(event)){event.preventDefault();event.stopPropagation();applyMinutes(event.currentTarget.value);start();}
          else if(event.key==='Enter'){event.preventDefault();applyMinutes(event.currentTarget.value);}else if(event.key==='Escape'){event.preventDefault();setCustom({editing:false,text:String(state.draft.minutes)});}
        }},expectedTimeKeyDown:event=>{if(quick(event)){event.preventDefault();start();}},
      }} slots={{configurationDetails:panel&&<div className="flex flex-wrap items-center gap-2 text-xs text-secondary">{panel.kind==='rotate'&&<span>当前时间块：{panel.name} → 新时间块</span>}<label className="flex items-center gap-2">倒计时到点<select aria-label="倒计时到点方式" className="rounded-md border border-input bg-page p-1 dark:bg-page-dark" value={state.draft.endMode} onChange={event=>setDraft({endMode:event.target.value as 'soft'|'hard'})}><option value="soft">继续超时</option><option value="hard">结束行动并待反馈</option></select></label></div>,dialogs:<TimeBlockFeedbackDialog open={!!feedback} onOpenChange={open=>{if(!open)setFeedback(null);}}
        title={feedback?.kind==='append'?'追加反馈':'结束反馈'} description={feedback?roster[feedback.id]??feedback.id.slice(0,8):''} compact
        feedback={feedbackDraft} onFeedbackChange={text=>{if(feedback)try{controller.setFeedbackDraft(feedback.id,text);}catch(failure){setError(message(failure));}}}
        onFeedbackKeyDown={event=>{runActionOnPrimaryModifierEnter(event,()=>submitFeedback());}} feedbackPlaceholder="记录本次专注的反馈..." feedbackTestId="new-focus-feedback-textarea"
        onSubmit={()=>submitFeedback()} submitLabel={feedback?.kind==='append'?'追加反馈':'提交反馈'} submitDisabled={disabled||!feedbackDraft.trim()} submitTestId="new-focus-feedback-confirm" tasks={[]}
        textareaClassName="min-h-[96px] resize-none dark:bg-[rgba(255,255,255,0.06)] dark:border-[#FFFFFF15] dark:text-[#FAFAF9] dark:placeholder:text-[#78716C]"
        submitButtonClassName="inline-flex items-center justify-center rounded-[10px] bg-brand-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-brand-accent/90"
        extraContent={<p className="hidden text-[11px] text-muted [@media(pointer:fine)]:block">Ctrl/Cmd+Enter 提交 · Enter 换行</p>}
        footerContent={feedback?.kind==='submit'?<div ref={setFeedbackPortal} data-beta-feedback-block-id={feedback.id} data-beta-feedback-kind={feedback.kind}><Button aria-label="明确跳过反馈" className="h-9 rounded-[10px]" variant="ghost" disabled={disabled} onClick={()=>submitFeedback(true)}>跳过</Button></div>:undefined}/>}}/>
      {clock?.stale&&<p className="px-5 text-xs text-muted">显示等待服务刷新；界面不会自行结束时间块</p>}
      <div className="flex flex-wrap gap-2 px-5 pb-2">{pendingFeedback.map(id=><Button key={id} aria-label={`填写反馈 ${id.slice(0,8)}`} variant="ghost" size="sm" disabled={disabled} onClick={()=>setFeedback({id,kind:'submit'})}>填写反馈 {roster[id]??id.slice(0,8)}</Button>)}</div>
    </>}
  </section>;
}
