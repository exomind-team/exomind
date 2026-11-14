import { useEffect,useRef,useState,useSyncExternalStore,type KeyboardEvent } from 'react';
import { FocusTimerView,type FocusTimerViewModel } from '@/ui/app/components/FocusTimerView';
import { TimeBlockFeedbackDialog } from '@/ui/app/components/TimeBlockFeedbackDialog';
import { Button } from '@/components/ui/button';
import type { BetaClient,BetaReceipt } from './client';
import { BetaTimeblockController } from './timeblocks-controller';

const message=(error:unknown)=>error&&typeof error==='object'&&'message'in error?String(error.message):'时间块操作尚未确认，请查证后重试';
type Panel={kind:'start'}|{kind:'rotate';from:string;name:string}|null;
type FeedbackTarget={id:string;kind:'submit'|'append'}|null;

/** Presentation is the actual Alpha View. This component owns only transient
 * panel/dialog choices; controller/journal/Host own intent and business state. */
export function BetaFocusTimer({controller,client,profileId,onCommitted}:{controller:BetaTimeblockController;client:BetaClient;profileId:string;onCommitted?:()=>void}){
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot);
  const [panel,setPanel]=useState<Panel>(()=>state.draft.name.trim()?{kind:'start'}:null);
  const [custom,setCustom]=useState({editing:false,text:String(state.draft.minutes)});
  const [feedback,setFeedback]=useState<FeedbackTarget>(null);
  const [error,setError]=useState('');const [roster,setRoster]=useState<Record<string,string>>({});const [choice,setChoice]=useState('');
  const [,tick]=useState(0);const alive=useRef(true);
  const configInput=useRef<HTMLTextAreaElement>(null);const customInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    alive.current=true;let cancelled=false;let timer:ReturnType<typeof setTimeout>;let reading=false;
    const refresh=async()=>{if(reading||cancelled)return;reading=true;await controller.refresh();reading=false;if(!cancelled){clearTimeout(timer);timer=setTimeout(()=>void refresh(),1000);}};
    void refresh();const display=setInterval(()=>tick(value=>value+1),250);
    const visible=()=>{if(!document.hidden)void refresh();};window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    return()=>{alive.current=false;cancelled=true;clearTimeout(timer);clearInterval(display);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[controller]);
  useEffect(()=>{
    const remote=state.remote;if(!remote)return;
    setRoster(previous=>{const next={...previous};if(remote.active)next[remote.active.block_id]=remote.active.name;for(const id of remote.pending_feedback)next[id]??=`时间块 ${id.slice(0,8)}`;return next;});
    let cancelled=false;
    void client.timeblocks?.nodes(profileId,{limit:100}).then(page=>{
      if(cancelled)return;setRoster(previous=>{const next={...previous};for(const node of page.items){if(node.payload.kind!=='action')continue;const action=node.payload.action;if(action.kind==='start')next[action.block_id]=action.name;else if(action.kind==='rotate')next[action.next.block_id]=action.next.name;}return next;});
    }).catch(()=>{/* Labels can remain explicit IDs; this is not a completeness claim. */});
    return()=>{cancelled=true;};
  },[client,profileId,state.remote?.revision]);
  useEffect(()=>{if(panel)configInput.current?.focus();},[panel?.kind]);
  useEffect(()=>{if(custom.editing){customInput.current?.focus();customInput.current?.select();}},[custom.editing]);
  const unresolved=state.pending.some(item=>item.state!=='rejected');
  const disabled=state.loading||unresolved||!!state.cacheError||!!state.error||!state.remote;
  async function run(action:()=>Promise<BetaReceipt|null>,completed?:()=>void){
    setError('');try{const receipt=await action();if(receipt&&alive.current){completed?.();onCommitted?.();}}catch(failure){if(alive.current)setError(message(failure));}
  }
  function setDraft(patch:Parameters<BetaTimeblockController['setStartDraft']>[0]){try{controller.setStartDraft(patch);}catch(failure){setError(message(failure));}}
  function start(){if(disabled){setError('当前操作或本机暂存尚未确认，请先查证');return;}
    if(panel?.kind==='rotate'&&state.remote?.active?.block_id!==panel.from){setError('当前时间块已变化，请重新确认切换目标');return;}
    void run(()=>panel?.kind==='rotate'?controller.rotate():controller.start(),()=>{if(!controller.snapshot().draft.name.trim())setPanel(null);});
  }
  const quick=(event:KeyboardEvent<HTMLElement>)=>!event.nativeEvent.isComposing&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey;
  function applyMinutes(raw:string){const number=Number.parseInt(raw,10);const minutes=Number.isFinite(number)?Math.max(1,Math.min(720,number)):state.draft.minutes;setDraft({mode:'countdown',minutes});setCustom({editing:false,text:String(minutes)});}
  const active=state.remote?.active;const clock=controller.displayClock();
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
  return <section aria-label="时间块" className="shrink-0">
    <div className="flex flex-wrap items-center gap-2 px-5 py-2 text-xs text-secondary">
      {active&&<Button size="sm" variant="ghost" disabled={disabled} onClick={()=>{setCustom({editing:false,text:String(state.draft.minutes)});setPanel({kind:'rotate',from:active.block_id,name:active.name});}}>切换时间块</Button>}
      {!!Object.keys(roster).length&&<><select aria-label="反馈时间块" className="max-w-44 rounded-md border border-input bg-transparent p-1" value={selected} onChange={event=>setChoice(event.target.value)}>{Object.entries(roster).map(([id,name])=><option value={id} key={id}>{name}</option>)}</select><Button size="sm" variant="ghost" disabled={!selected||disabled} onClick={()=>setFeedback({id:selected,kind:'append'})}>追加反馈</Button></>}
      <Button size="sm" variant="ghost" onClick={()=>void controller.refresh()}>刷新时间块</Button>
      {state.persistenceState==='pending'?<span role="status">正在暂存时间块草稿…</span>:state.persistenceState==='idle'&&(state.draft.name.trim()||Object.values(state.feedback).some(item=>item.text.trim()))?<span role="status">草稿已暂存 · 尚未提交</span>:null}
    </div>
    {(error||state.error||state.cacheError)&&<p role="alert" className="px-5 py-2 text-xs text-destructive">{error||state.error||state.cacheError}</p>}
    {state.persistenceState==='failed'&&<Button size="sm" variant="outline" className="mx-5 mb-2" onClick={()=>{void controller.flush().then(()=>setError('')).catch(failure=>setError(message(failure)));}}>重试本机暂存</Button>}
    {state.pending.map(item=><div key={item.command.command_id} className="flex items-center gap-2 px-5 py-2 text-xs text-secondary"><span className="min-w-0 flex-1">{item.state==='pending'?'正在确认时间块操作…':item.state==='rejected'?'时间块已变化，此操作被拒绝':'时间块操作结果待确认'}{item.message&&`：${item.message}`}</span>{item.state==='rejected'?<Button size="sm" variant="outline" onClick={()=>{controller.dismissRejected(item.command.command_id);void controller.refresh();}}>放弃被拒操作</Button>:<Button size="sm" variant="outline" disabled={item.state==='pending'} onClick={()=>void run(()=>controller.retry(item.command.command_id))}>查证时间块操作</Button>}</div>)}
    {!state.remote?<p role="status" className="px-5 py-3 text-xs text-muted">正在恢复并读取时间块…</p>:<>
      {panel?.kind==='rotate'&&<p className="px-5 text-xs text-muted">切换目标：{panel.name}</p>}
      {panel&&<label className="flex items-center gap-2 px-5 text-xs text-secondary">倒计时到点<select aria-label="倒计时到点方式" className="rounded-md border border-input bg-transparent p-1" value={state.draft.endMode} onChange={event=>setDraft({endMode:event.target.value as 'soft'|'hard'})}><option value="soft">继续超时</option><option value="hard">结束行动并待反馈</option></select></label>}
      <FocusTimerView model={model} actionsDisabled={disabled} actions={{
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
      }} slots={{dialogs:<TimeBlockFeedbackDialog open={!!feedback} onOpenChange={open=>{if(!open)setFeedback(null);}}
        title={feedback?.kind==='append'?'追加时间块反馈':'停止专注并记录反馈'} description={feedback?`反馈对象：${roster[feedback.id]??feedback.id.slice(0,8)}；关闭窗口不会自动提交`:''}
        feedback={feedbackDraft} onFeedbackChange={text=>{if(feedback)try{controller.setFeedbackDraft(feedback.id,text);}catch(failure){setError(message(failure));}}}
        onFeedbackKeyDown={event=>{if(quick(event)){event.preventDefault();submitFeedback();}}} feedbackPlaceholder="记录本次专注的反馈..." feedbackTestId="new-focus-feedback-textarea"
        onSubmit={()=>submitFeedback()} submitLabel={feedback?.kind==='append'?'确认追加':'确认反馈'} submitDisabled={disabled||!feedbackDraft.trim()} submitTestId="new-focus-feedback-confirm" tasks={[]}
        textareaClassName="min-h-[96px] resize-none dark:bg-[rgba(255,255,255,0.06)] dark:border-[#FFFFFF15] dark:text-[#FAFAF9] dark:placeholder:text-[#78716C]"
        submitButtonClassName="inline-flex items-center justify-center rounded-[10px] bg-brand-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 hover:bg-brand-accent/90"
        extraContent={feedback?.kind==='submit'?<Button variant="outline" disabled={disabled} onClick={()=>submitFeedback(true)}>明确跳过反馈</Button>:undefined}/>}}/>
      {clock?.stale&&<p className="px-5 text-xs text-muted">显示等待服务刷新；界面不会自行结束时间块</p>}
      <div className="flex flex-wrap gap-2 px-5 pb-2">{state.remote.pending_feedback.filter(id=>id!==active?.block_id).map(id=><Button key={id} variant="ghost" size="sm" disabled={disabled} onClick={()=>setFeedback({id,kind:'submit'})}>填写反馈 {id.slice(0,8)}</Button>)}</div>
    </>}
  </section>;
}
