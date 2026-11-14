import { useCallback,useEffect,useRef,useState,useSyncExternalStore } from 'react';
import { FocusTimerView } from '@/ui/app/components/FocusTimerView';
import { NowWorkbenchOverlayView } from '@/ui/app/components/NowWorkbenchOverlayView';
import { NowInputRowView } from '@/ui/app/components/NowInputRowView';
import { TimeBlockFeedbackDialog } from '@/ui/app/components/TimeBlockFeedbackDialog';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { OverlaySession } from './session';
import { OverlayDraftBuffer } from './draft-buffer';
import { nativeOverlayWindow } from './native-port';
import { overlayScopeKey,type OverlayAction,type OverlayResponse,type OverlayScope,type OverlayView } from './protocol';
import { useOverlayWindowLayout } from './window-layout';

const message=(error:unknown)=>error instanceof Error?error.message:'浮窗操作尚未确认，请保留输入并重试';
interface RetainedInput {kind:'capture'|'feedback';blockId?:string;text:string}
interface RetainedScope {key:string;scope:OverlayScope;inputs:RetainedInput[];pending:number}
export function BetaOverlayPage(){
  const [session,setSession]=useState<OverlaySession|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const opening=useRef<Promise<void>|null>(null);
  useEffect(()=>{let cancelled=false,owned:OverlaySession|undefined;const previous=opening.current;
    const operation=(async()=>{if(previous)await previous.catch(()=>{});if(cancelled)return;owned=await OverlaySession.open();if(cancelled){owned.close();return;}setSession(owned);setError('');})();
    opening.current=operation;void operation.catch(failure=>{if(!cancelled)setError(message(failure));});
    return()=>{cancelled=true;owned?.close();setSession(null);};
  },[attempt]);
  if(session)return<BetaOverlaySurface session={session}/>;
  return<div className="rounded-[24px] bg-[#1C1917] p-5 text-sm text-[#FAFAF9]"><p role="status">{error||'正在连接主窗口…'}</p>{error&&<Button variant="outline" onClick={()=>setAttempt(value=>value+1)}>重新连接浮窗</Button>}</div>;
}
export function BetaOverlaySurface({session}:{session:OverlaySession}){
  const state=useSyncExternalStore(session.subscribe,session.snapshot);
  const [retained,setRetained]=useState<RetainedScope[]>([]);
  const retain=useCallback((value:RetainedScope)=>setRetained(previous=>[...previous.filter(item=>item.key!==value.key),value]),[]);
  return<>
    {!!retained.length&&<RetainedInputs key={state.view?overlayScopeKey(state.view.scope):'unavailable'} values={retained} onResolved={key=>setRetained(previous=>previous.filter(item=>item.key!==key))}/>}
    {state.view?<ConnectedSurface key={overlayScopeKey(state.view.scope)} session={session} view={state.view} onRetire={retain} hasRetained={retained.length>0}/>:<div className="rounded-[24px] bg-[#1C1917] p-5 text-sm text-[#FAFAF9]" role="status">{state.error||'主窗口尚未就绪，浮窗暂不可操作'}</div>}
  </>;
}
function ConnectedSurface({session,view,onRetire,hasRetained}:{session:OverlaySession;view:OverlayView;onRetire:(value:RetainedScope)=>void;hasRetained:boolean}){
  const state=useSyncExternalStore(session.subscribe,session.snapshot);
  const [mini,setMini]=useState(false),[hover,setHover]=useState(false),[idleHover,setIdleHover]=useState(false),[idleFocus,setIdleFocus]=useState(false);
  const [error,setError]=useState(''),[acting,setActing]=useState(false),[feedback,setFeedback]=useState<{id:string;kind:'submit'|'append'}|null>(null);
  const captureRef=useRef<OverlayDraftBuffer|null>(null);captureRef.current??=new OverlayDraftBuffer(session,view,{kind:'capture'});const capture=captureRef.current;
  const feedbackBuffers=useRef(new Map<string,OverlayDraftBuffer>());const alive=useRef(true),mountGeneration=useRef(0),operationLock=useRef(false);
  const latestView=useRef(view);latestView.current=view;
  const draft=useSyncExternalStore(capture.subscribe,capture.snapshot);
  useEffect(()=>{capture.sync(view);for(const buffer of feedbackBuffers.current.values())buffer.sync(view);document.documentElement.classList.toggle('dark',view.theme==='dark');},[capture,view]);
  useEffect(()=>{alive.current=true;const generation=++mountGeneration.current;return()=>{alive.current=false;queueMicrotask(()=>{if(mountGeneration.current===generation){
    const previous=latestView.current,key=overlayScopeKey(previous.scope),inputs:RetainedInput[]=[];
    const captureDraft=capture.snapshot();if(captureDraft.dirty||captureDraft.saving||captureDraft.error)inputs.push({kind:'capture',text:captureDraft.text});
    for(const [blockId,buffer]of feedbackBuffers.current){const draft=buffer.snapshot();if(draft.dirty||draft.saving||draft.error)inputs.push({kind:'feedback',blockId,text:draft.text});}
    const pending=previous.focus_pending.filter(item=>item.state!=='rejected').length+previous.capture_pending.length+session.snapshot().pending.filter(item=>overlayScopeKey(item.scope)===key).length;
    if(inputs.length||pending)onRetire({key,scope:previous.scope,inputs,pending});
    capture.close();feedbackBuffers.current.forEach(buffer=>buffer.close());
  }});};},[capture,session,onRetire]);
  const active=view.remote?.active,mode=active?'running':'idle',expanded=idleHover||idleFocus;
  useEffect(()=>{if(!active){setMini(false);setHover(false);}else{setIdleHover(false);setIdleFocus(false);}},[active?.block_id]);
  const statusError=error||state.error||draft.error||view.capture.error||view.focus_error||(view.clock?.stale?'显示等待主窗口刷新；界面不会自行结束时间块':'');
  const surface=useOverlayWindowLayout({mode,mini,peek:mini&&hover,expanded,feedback:!!feedback||!!statusError||hasRetained,onError:failure=>{if(alive.current)setError(message(failure));}});
  const disabled=!state.ready||acting||active?.phase==='completed'||view.focus_busy||view.focus_state==='failed'||!!view.focus_error||!!view.clock?.stale||state.pending.some(item=>overlayScopeKey(item.scope)===overlayScopeKey(view.scope));
  async function run(action:OverlayAction,done?:(response:OverlayResponse)=>void){
    const current=session.snapshot().view;
    if(!alive.current||!current||overlayScopeKey(current.scope)!==overlayScopeKey(view.scope)||operationLock.current)return;
    if(!state.ready){setError('主窗口尚未就绪，浮窗暂不可操作');return;}
    operationLock.current=true;
    setActing(true);setError('');try{const response=await session.send(action,current);if(!response.ok)throw new Error(response.message);const latest=session.snapshot().view;if(alive.current&&latest&&overlayScopeKey(latest.scope)===overlayScopeKey(view.scope)&&overlayScopeKey(response.view.scope)===overlayScopeKey(view.scope))done?.(response);}catch(failure){if(alive.current)setError(message(failure));}finally{operationLock.current=false;if(alive.current)setActing(false);}
  }
  function end(){if(!active||disabled)return;const target=active.block_id;if(active.phase==='feedback_pending')setFeedback({id:target,kind:'submit'});else void run({kind:'end_action',block_id:target},()=>setFeedback({id:target,kind:'submit'}));}
  function feedbackBuffer(id:string){let buffer=feedbackBuffers.current.get(id);if(!buffer){buffer=new OverlayDraftBuffer(session,view,{kind:'feedback',block_id:id});feedbackBuffers.current.set(id,buffer);}return buffer;}
  const captureDisabled=!state.ready||acting||draft.saving||draft.dirty||!!draft.error||!view.remote||(!draft.text.trim()&&view.capture.file_count===0);
  async function sendCapture(){if(captureDisabled||operationLock.current)return;setError('');try{await capture.flush();const saved=capture.submission();await run({kind:'capture',draft_revision:saved.revision});}catch(failure){if(alive.current)setError(message(failure));}}
  const dialogs=<>
    {statusError&&<p role="alert" className="rounded-[12px] bg-[#1C1917] px-4 py-2 text-xs text-[#FED7AA]">{statusError}</p>}
    {(view.clock?.stale||view.focus_error)&&<Button variant="outline" disabled={!state.ready||acting} onClick={()=>void run({kind:'refresh'})}>刷新时间块</Button>}
    {view.remote?.pending_feedback.filter(id=>id!==active?.block_id).map(id=><Button key={id} size="sm" variant="ghost" disabled={disabled} onClick={()=>setFeedback({id,kind:'submit'})}>填写反馈 {id.slice(0,8)}</Button>)}
    {state.pending.filter(item=>overlayScopeKey(item.scope)===overlayScopeKey(view.scope)&&!['capture_edit','feedback_edit'].includes(item.action.kind)).map(item=><Button key={item.request_id} variant="outline" onClick={()=>{void session.retry(item.request_id).then(response=>{if(alive.current&&!response.ok)setError(response.message);}).catch(failure=>{if(alive.current)setError(message(failure));});}}>查证浮窗请求</Button>)}
    {view.focus_pending.filter(item=>item.state!=='rejected').map(item=><Button key={item.command_id} variant="outline" disabled={!state.ready||item.state==='pending'||acting} onClick={()=>void run({kind:'retry_timeblock',command_id:item.command_id})}>查证时间块操作</Button>)}
    {view.capture_pending.map(item=><Button key={item.command_id} variant="outline" disabled={!state.ready||item.state==='pending'||acting} onClick={()=>void run({kind:'retry_capture',command_id:item.command_id})}>查证记录提交</Button>)}
    {feedback&&<FeedbackSurface key={feedback.id} target={feedback} view={view} buffer={feedbackBuffer(feedback.id)} disabled={disabled} onClose={()=>setFeedback(null)} onAppend={()=>setFeedback({...feedback,kind:'append'})} onSubmit={async skipped=>{const target=feedback,buffer=feedbackBuffer(target.id);await buffer.flush();const sent=buffer.submission(),text=buffer.snapshot().text;await run(target.kind==='append'?{kind:'append_feedback',block_id:target.id,draft_revision:sent.revision}:{kind:'submit_feedback',block_id:target.id,draft_revision:sent.revision,skipped},()=>{if(buffer.snapshot().text===''||buffer.submission().revision===sent.revision&&buffer.snapshot().text===text)setFeedback(current=>current?.id===target.id&&current.kind===target.kind?null:current);});}}/>}
  </>;
  return<NowWorkbenchOverlayView model={{mode,title:active?.name??'当下工作台',statusLabel:active?.phase==='feedback_pending'?'待反馈':active?.phase==='completed'?'已完成':active?.phase==='paused'?'已暂停':active?'进行中':'随时记录',clockText:view.clock?.text??'--:--',paused:active?.phase!=='running',miniCollapsed:mini,miniHovered:hover,idleExpanded:expanded,surfaceActive:surface.surfaceActive}}
    actionsDisabled={disabled} pauseDisabled={active?.phase==='feedback_pending'} onMiniHover={setHover} onIdleHover={setIdleHover} onIdleFocusCapture={()=>setIdleFocus(true)} onIdleBlurCapture={event=>{if(!event.relatedTarget||!event.currentTarget.contains(event.relatedTarget as Node))setIdleFocus(false);}}
    onIdleCollapse={()=>{setIdleHover(false);setIdleFocus(false);}} onExpand={()=>setMini(false)} onCollapse={()=>setMini(true)} onReturnToMain={()=>{void nativeOverlayWindow({kind:'return_main'}).catch(failure=>setError(message(failure)));}}
    onPauseOrResume={()=>{if(active&&!disabled)void run({kind:active.phase==='paused'?'resume':'pause',block_id:active.block_id});}} onEndBlock={end} onSurfaceMount={surface.onSurfaceMount} onSurfaceMouseDownCapture={surface.onSurfaceMouseDownCapture}
    slots={{running:chrome=><FocusTimerView surface="overlay" overlayChrome={chrome} actionsDisabled={disabled} model={active&&view.clock?{phase:'running',name:{text:active.name,draft:'',editing:false,saving:false,readOnly:true},clock:view.clock,paused:active.phase!=='running',feedback:{inProgress:active.phase==='feedback_pending',dialogOpen:feedback?.id===active.block_id}}:{phase:'idle'}}
      actions={{expand:()=>{},collapse:chrome.onCollapse,selectTiming:()=>{},editCustom:()=>{},start:()=>{},beginRename:()=>{},pauseResume:()=>{if(active&&!disabled)void run({kind:active.phase==='paused'?'resume':'pause',block_id:active.block_id});},end}}/>,
      record:<NowInputRowView value={draft.text} placeholder="记录当下的事实..." textareaLabel="记录当下" sendLabel="发送" onValueChange={text=>capture.edit(text)} onKeyDown={event=>{if(!event.nativeEvent.isComposing&&(event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void sendCapture();}}} onSend={sendCapture}
        sendDisabled={captureDisabled}
        beforeControls={<>{view.capture.file_count>0&&<p className="mb-2 text-xs text-muted">含主窗整组 {view.capture.file_count} 个原件；回主窗管理</p>}{draft.error&&<div className="mb-2 flex gap-2"><Button size="sm" variant="outline" onClick={()=>{void capture.retry().catch(failure=>setError(message(failure)));}}>重试本机暂存</Button><Button size="sm" variant="outline" onClick={()=>capture.useMainDraft()}>使用主窗草稿</Button></div>}</>}
        afterControls={<p role="status" className="mt-2 text-[11px] text-muted">{draft.saving||draft.dirty?'正在暂存，请保留窗口…':view.capture.state==='failed'?'暂存失败，请保留窗口并重试':'草稿已暂存 · 尚未提交'}</p>}/>,dialogs}}/>;
}
function RetainedInputs({values,onResolved}:{values:RetainedScope[];onResolved:(key:string)=>void}){
  const [open,setOpen]=useState(false),[error,setError]=useState('');
  return<>
    <div className="space-y-2 p-3 text-xs text-secondary"><p>原档案或旧连接有未确认输入，请保留此窗口并回原档案核对。</p><Button size="sm" variant="outline" onClick={()=>setOpen(true)}>查看原档案未确认输入</Button></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>原档案未确认输入</DialogTitle><DialogDescription>这些内容保留原来的归属，不会迁移或提交到当前档案。未确认输入目前保留在此窗口，关闭或重载前请复制；原档案草稿和操作仍需回主窗查证。“已在原档案核对”只关闭此处提示，不删除原档案草稿或操作。</DialogDescription></DialogHeader>
      {values.map(value=><div key={value.key} className="space-y-2"><p className="text-xs text-secondary">原档案 {value.scope.profile_id.slice(0,8)} · 旧连接</p>
        {value.inputs.map((input,index)=><label key={index} className="block space-y-1 text-sm">{input.kind==='feedback'?`反馈 · ${input.blockId?.slice(0,8)}`:'记录草稿'}<Textarea readOnly aria-label={input.kind==='feedback'?'原档案未确认反馈':'原档案未确认记录'} value={input.text} className="min-h-[96px] resize-none"/></label>)}
        {value.pending>0&&<p className="text-xs text-muted">原档案仍有操作待查证；此处不会重新发送。</p>}
        <Button size="sm" variant="outline" onClick={()=>onResolved(value.key)}>已在原档案核对</Button>
      </div>)}
      {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>{void nativeOverlayWindow({kind:'return_main'}).catch(failure=>setError(message(failure)));}}>回主窗核对</Button><Button onClick={()=>setOpen(false)}>关闭查看</Button></div>
    </DialogContent></Dialog>
  </>;
}
function FeedbackSurface({target,view,buffer,disabled,onClose,onAppend,onSubmit}:{target:{id:string;kind:'submit'|'append'};view:OverlayView;buffer:OverlayDraftBuffer;disabled:boolean;onClose:()=>void;onAppend:()=>void;onSubmit:(skipped:boolean)=>Promise<void>}){
  const draft=useSyncExternalStore(buffer.subscribe,buffer.snapshot);
  const [error,setError]=useState('');const submit=(skipped=false)=>{if(disabled||draft.dirty||draft.saving||draft.error||!skipped&&!draft.text.trim())return;void onSubmit(skipped).catch(failure=>setError(message(failure)));};
  return<TimeBlockFeedbackDialog open onOpenChange={open=>{if(!open)onClose();}} title={target.kind==='append'?'追加时间块反馈':'结束专注并记录反馈'} description={`反馈对象：${view.remote?.active?.block_id===target.id?view.remote.active.name:target.id.slice(0,8)}；关闭窗口不会自动提交`}
    feedback={draft.text} onFeedbackChange={text=>buffer.edit(text)} onFeedbackKeyDown={event=>{if(!event.nativeEvent.isComposing&&(event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();submit();}}}
    feedbackPlaceholder="记录本次专注的反馈..." onSubmit={()=>submit()} submitLabel={target.kind==='append'?'确认追加':'提交反馈'} submitDisabled={disabled||draft.dirty||draft.saving||!!draft.error||!draft.text.trim()} tasks={[]} autoFocusFeedback
    dialogTestId="now-overlay-feedback-surface" feedbackTestId="now-overlay-feedback-textarea" submitTestId="now-overlay-feedback-confirm"
    textareaClassName="min-h-[88px] resize-none text-[13px] dark:bg-[rgba(255,255,255,0.06)] dark:border-[#FFFFFF15] dark:text-[#FAFAF9] dark:placeholder:text-[#78716C]"
    submitButtonClassName="h-10 w-full rounded-[12px] bg-[#C75B3A] text-white hover:bg-[#B24D2F] disabled:cursor-not-allowed disabled:opacity-60"
    extraContent={<div className="space-y-2"><p className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">Ctrl+Enter 提交 · Enter / Shift+Enter 换行</p>{(error||draft.error)&&<p role="alert" className="text-xs text-destructive">{error||draft.error}</p>}{draft.error&&<Button variant="outline" onClick={()=>{void buffer.retry().catch(failure=>setError(message(failure)));}}>重试反馈暂存</Button>}{target.kind==='submit'&&!view.remote?.pending_feedback.includes(target.id)&&view.remote?.active?.block_id!==target.id&&<Button variant="outline" disabled={disabled} onClick={onAppend}>改为追加反馈</Button>}{target.kind==='submit'&&<Button variant="outline" disabled={disabled||draft.dirty||draft.saving} onClick={()=>submit(true)}>明确跳过反馈</Button>}</div>}/>;
}
