import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type MutableRefObject } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Bot, FileText, RefreshCw, Timer, X } from 'lucide-react';
import { PageShell } from '@/ui/app/components/PageShell';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import { NowInputRowView, resizeNowInputTextarea } from '@/ui/app/components/NowInputRowView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import { nativeBetaClient, webBetaClient, type BetaClient, type BetaProfile, type BetaStatus, type BetaQuery } from './client';
import { BetaDraftController, errorMessage } from './drafts';
import { betaUuid } from './initialization';
import { useBetaNow } from './date-clock';
import type { FileSourceStore } from './file-source-store';
import { OriginalDownloads } from './OriginalDownloads';
import type { LocalIntentJournal,IntentPredecessor } from './local-intent-journal';
import type { BetaTimelinePage } from './timeblocks-types';
import type { SummaryArtifactRecord,SummarySourceRef } from './summary-types';
import { BetaSummaryHistoryRow } from './BetaSummaryHistoryRow';
import { BetaExternalSummaryHistoryRow } from './BetaExternalSummaryHistoryRow';
import { BetaSummaryTasksPanel } from './BetaSummaryTasksPanel';
import { BetaSummarySourceDialog } from './BetaSummarySourceDialog';
import { betaTimeblockLabel } from './timeblock-label';
import type { SummaryTasksController } from './summary-tasks-controller';
import { BetaTimeblockController } from './timeblocks-controller';
import { BetaFocusTimer } from './BetaFocusTimer';
import { MainOverlayBridge } from './overlay/MainOverlayBridge';
import { keepBetaEditableInViewport } from './editable-viewport';
import { BetaAppShell, type BetaSection } from './BetaAppShell';
import { BetaSettingsPage } from './BetaSettingsPage';
import { BetaPeersPage } from './BetaPeersPage';
import { nativeBetaPeersClient, type BetaPeersClient } from './peers-client';
import { setBetaDateDisplayMode, useBetaDateDisplayMode, useBetaThemePresentation } from './preferences';
import { ChatMessageRowView } from '@/ui/app/components/ChatMessageRowView';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { mergeTimelineItems, refreshTimelineWindow } from './timeline-refresh';
import { BetaProfileDialog } from './BetaProfileDialog';
import { rememberLastBetaProfile, restoreLastBetaProfile } from './last-profile';
import { BetaApiError } from './api-error';
import { nativeBetaDeadlineHandoffsClient, type BetaDeadlineHandoff, type BetaDeadlineHandoffsClient } from './deadline-handoff-client';
import { describeDeadlineHandoff, useBetaDeadlineHandoff } from './deadline-handoff';
import { clipboardImageFiles, readBetaClipboard } from './clipboard-images';
import { BetaImagePreview } from './BetaImagePreview';
import { BetaRuntimeLocation } from './BetaRuntimeLocation';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { betaDesktopPreferences } from './desktop-preferences';
import { inputSendShortcutLabel, shouldSubmitOnEnter, useBetaInputSendMode } from './input-preferences';

const SESSION_KEY = 'exomind:beta:connection';
const selectClass = 'h-9 max-w-full rounded-md border border-input bg-page px-2 text-sm dark:bg-page-dark';

/** A separate entry: no legacy runtime/profile/event-store bootstrap. */
export function BetaApp({ client: injected, sourceStore, intentJournal, intentPredecessor, peers: injectedPeers, handoffs: injectedHandoffs }: { client?: BetaClient; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor; peers?:BetaPeersClient|null; handoffs?:BetaDeadlineHandoffsClient|null }) {
  useEffect(() => keepBetaEditableInViewport(), []);
  useBetaThemePresentation();
  const [native] = useState(() => isTauri());
  const [nativePeers] = useState(() => native ? nativeBetaPeersClient() : null);
  const [nativeHandoffs] = useState(() => native ? nativeBetaDeadlineHandoffsClient() : null);
  const peers = injectedPeers === undefined ? injected ? null : nativePeers : injectedPeers;
  const handoffs = injectedHandoffs === undefined ? injected ? null : nativeHandoffs : injectedHandoffs;
  const [client, setClient] = useState<BetaClient | null>(() => injected ?? (native ? nativeBetaClient() : null));
  const [endpoint, setEndpoint] = useState(() => {
    try { return (JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}') as { endpoint?: string }).endpoint ?? window.location.origin; }
    catch { return window.location.origin; }
  });
  const [token, setToken] = useState(() => {
    try { return (JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}') as { token?: string }).token ?? ''; }
    catch { return ''; }
  });
  const [error, setError] = useState('');
  useEffect(() => { if (injected) setClient(injected); }, [injected]);
  function connect(event: FormEvent) {
    event.preventDefault();
    try {
      const next = webBetaClient(endpoint, token);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ endpoint, token }));
      setError(''); setClient(next);
    } catch (failure) { setError(errorMessage(failure)); }
  }
  if (client) return <ConnectedBeta key={native ? 'native' : undefined} endpoint={!native && !injected ? endpoint : undefined} client={client} peers={peers} handoffs={handoffs} sourceStore={sourceStore} intentJournal={intentJournal} intentPredecessor={intentPredecessor}
    onDisconnect={!native && !injected ? () => { setClient(null); setToken(''); sessionStorage.removeItem(SESSION_KEY); } : undefined} />;
  return <PageShell title="外心" subtitle="Beta · 连接本机服务" contentClassName="overflow-y-auto">
    <form onSubmit={connect} className="mx-auto flex max-w-lg flex-col gap-4 px-5 py-8">
      <label className="space-y-2 text-sm">服务地址<Input aria-label="服务地址" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:4310" required /></label>
      <label className="space-y-2 text-sm">管理凭据<Input type="password" autoComplete="off" aria-label="管理凭据" value={token} onChange={event => setToken(event.target.value)} required /></label>
      <p className="text-xs text-muted">凭据仅保留在当前浏览器会话。跨地址连接需在本机服务中允许此页面的来源。</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit">连接</Button>
    </form>
  </PageShell>;
}

type DeadlineLocation={handoffId:string;profileId:string;blockId:string;attempt:number};
function ConnectedBeta({ client, peers, handoffs, onDisconnect, sourceStore, intentJournal, intentPredecessor, endpoint }: { client: BetaClient; peers:BetaPeersClient|null; handoffs:BetaDeadlineHandoffsClient|null; onDisconnect?: () => void; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor; endpoint?: string }) {
  const [status, setStatus] = useState<BetaStatus | null>(null);
  const [profiles, setProfiles] = useState<BetaProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  const [persistenceBusy,setPersistenceBusy]=useState(false);
  const [switching,setSwitching]=useState(false);
  const [section,setSection]=useState<BetaSection>('now');
  const [inputFocusRequest, setInputFocusRequest] = useState(0);
  useEffect(() => {
    if (!isTauri() || /Android|iPhone|iPad/i.test(navigator.userAgent)) return;
    let active = true; let unlisten: (() => void) | undefined;
    const request = () => { if (active) { setSection('now'); setInputFocusRequest(value => value + 1); } };
    void listen<{quick_focus:boolean}>('beta-main-window-shortcut', event => {
      void invoke('beta_take_desktop_activation').catch(() => {});
      if (event.payload?.quick_focus === true) request();
    }).then(async cleanup => {
      if (!active) { cleanup(); return; } unlisten = cleanup;
      const pending = await invoke<boolean>('beta_take_desktop_activation');
      if (!active || !pending) return;
      const preferences = await betaDesktopPreferences.refresh();
      if (active && preferences.quick_focus) request();
    }).catch(failure => { if (active) setError(`快捷唤起状态暂未确认：${errorMessage(failure)}`); });
    return () => { active = false; unlisten?.(); };
  }, []);
  const sectionRef=useRef(section);sectionRef.current=section;
  useEffect(() => {
    if (!inputFocusRequest || section !== 'now') return;
    const focus = () => {
      const element = document.querySelector<HTMLTextAreaElement>('[data-beta-view="now"] textarea[data-testid="new-now-input-textarea"]');
      if (!element) return;
      // Preserve an active feedback/settings dialog and its unfinished input.
      if (!document.querySelector('[role="dialog"][data-state="open"]')) element.focus({ preventScroll: true });
      setInputFocusRequest(0);
    };
    window.addEventListener('beta:capture-input-ready', focus); focus();
    return () => window.removeEventListener('beta:capture-input-ready', focus);
  }, [inputFocusRequest, section]);
  const [eventRevision,setEventRevision]=useState(0);
  const [profileDialog,setProfileDialog]=useState(false);
  const prepareSwitch=useRef<(()=>Promise<void>)|null>(null);
  const switchFlight=useRef(false);
  const creation = useRef<{ name: string; id: string; client: BetaClient } | null>(null);
  const generation = useRef(0);
  const selectionScope=useRef<{generation:number;deviceId:string;profiles:BetaProfile[]}|null>(null);
  const [deadlineLocation,setDeadlineLocation]=useState<DeadlineLocation|null>(null);
  const locationWaiter=useRef<{id:string;attempt:number;finish(error?:Error,hint?:string):void}|null>(null);
  const locationSequence=useRef(0);
  useEffect(()=>()=>{locationWaiter.current?.finish(new BetaApiError('handoff_location_pending','来源档案已变化'));},[client]);
  useEffect(() => {
    const current = ++generation.current;
    selectionScope.current=null;
    setStatus(null); setLoading(true); setError(''); setProfiles([]); setProfileId('');
    switchFlight.current=false;setSwitching(false);setCreating(false);
    void (async () => {
      try {
        const hello = await client.status(); const list = await client.profiles();
        if (current !== generation.current) return;
        selectionScope.current={generation:current,deviceId:hello.device_id,profiles:list};
        setStatus(hello); setProfiles(list); setProfileId(restoreLastBetaProfile(hello.device_id,list));
      } catch (failure) { if (current === generation.current) setError(errorMessage(failure)); }
      finally { if (current === generation.current) setLoading(false); }
    })();
    return () => { ++generation.current; };
  }, [client, reload]);
  async function changeProfile(next:string,stillWanted:()=>boolean=()=>true){
    const scope=selectionScope.current;
    if(!scope||scope.generation!==generation.current||!scope.profiles.some(profile=>profile.profile_id===next)||!stillWanted())return false;
    if(next===profileId){rememberLastBetaProfile(scope.deviceId,next,scope.profiles);return true;}
    if(switchFlight.current||!prepareSwitch.current)return false;
    const current=generation.current;const guard=prepareSwitch.current;
    switchFlight.current=true;setSwitching(true);setError('');
    try{await guard();if(current!==generation.current||guard!==prepareSwitch.current||selectionScope.current!==scope||!scope.profiles.some(profile=>profile.profile_id===next)||!stillWanted())return false;setProfileId(next);rememberLastBetaProfile(scope.deviceId,next,scope.profiles);return true;}
    catch(failure){if(current===generation.current&&guard===prepareSwitch.current)setError(`当前草稿尚未暂存，未切换档案；请保留窗口并重试：${errorMessage(failure)}`);return false;}
    finally{if(current===generation.current){switchFlight.current=false;setSwitching(false);}}
  }
  async function create(event: FormEvent) {
    event.preventDefault(); if (!name.trim() || creating || persistenceBusy) return;
    const current = generation.current;
    const scope=selectionScope.current;if(!scope||scope.generation!==current)return;
    const guard=prepareSwitch.current;if(!guard)return;
    try { if (creation.current?.name !== name.trim() || creation.current?.client!==client) creation.current = { name: name.trim(), id: betaUuid(), client }; }
    catch (failure) { setError(errorMessage(failure)); return; }
    const request = creation.current;
    if (!request) return;
    setCreating(true); setError('');
    try {
      await guard();
      if(current!==generation.current||guard!==prepareSwitch.current||selectionScope.current!==scope)return;
      const result = await client.provisionProfile(request.id, request.name);
      if (current !== generation.current || guard!==prepareSwitch.current || selectionScope.current!==scope) return;
      await guard();
      if(current!==generation.current||guard!==prepareSwitch.current||selectionScope.current!==scope)return;
      const nextProfiles=[...scope.profiles.filter(item=>item.profile_id!==result.profile_id),result];scope.profiles=nextProfiles;
      setProfiles(nextProfiles);
      rememberLastBetaProfile(scope.deviceId,result.profile_id,nextProfiles);
      setProfileId(result.profile_id); setName(''); creation.current = null;
    } catch (failure) { if (current === generation.current) setError(errorMessage(failure)); }
    finally { if (current === generation.current) setCreating(false); }
  }
  const profileName=profiles.find(profile=>profile.profile_id===profileId)?.display_name??'';
  async function joined(nextProfile:string){
    const current=generation.current;
    const scope=selectionScope.current;if(!scope||scope.generation!==current)throw new Error('本机档案列表尚未就绪，请稍后重试');
    const list=await client.profiles();
    if(current!==generation.current||selectionScope.current!==scope)throw new Error('本机服务已变化，请重新打开已加入的档案');
    if(!list.some(profile=>profile.profile_id===nextProfile))throw new Error('已加入档案尚未出现在本机列表，请刷新后打开');
    scope.profiles=list;setProfiles(list);
    if(sectionRef.current!=='sync')throw new Error('当前页面已切换，请从档案菜单打开已加入的档案');
    if(!(await changeProfile(nextProfile,()=>sectionRef.current==='sync')))throw new Error('请等待当前草稿暂存后，再选择已加入的档案');
    if(current===generation.current)setSection('now');
  }
  async function openDeadlineHandoff(target:BetaDeadlineHandoff,stillCurrent:()=>boolean,signal:AbortSignal):Promise<string>{
    const scope=selectionScope.current;const current=generation.current;const guard=prepareSwitch.current;
    const wanted=()=>stillCurrent()&&!signal.aborted&&current===generation.current&&selectionScope.current===scope;
    if(!scope||scope.generation!==current||!guard||!client.timeblocks)throw new BetaApiError('handoff_location_pending','来源档案尚未就绪');
    const list=await client.profiles();if(!wanted())throw new BetaApiError('handoff_location_pending','通知入口已变化');
    if(!list.some(profile=>profile.profile_id===target.profile_id))throw new BetaApiError('handoff_missing_profile','来源档案不在本机');
    const message=await describeDeadlineHandoff(client.timeblocks,target,wanted);if(!wanted()||guard!==prepareSwitch.current)throw new BetaApiError('handoff_location_pending','当前档案已变化');
    try{await guard();}catch{throw new BetaApiError('handoff_draft_pending','当前草稿尚未暂存');}
    if(!wanted()||guard!==prepareSwitch.current)throw new BetaApiError('handoff_location_pending','当前档案已变化');
    scope.profiles=list;setProfiles(list);
    if(!(await changeProfile(target.profile_id,()=>wanted()&&guard===prepareSwitch.current)))throw new BetaApiError('handoff_draft_pending','当前草稿尚未暂存');
    if(!wanted())throw new BetaApiError('handoff_location_pending','通知入口已变化');
    const active=document.activeElement;if(active instanceof HTMLElement&&active.closest('[data-beta-view]'))active.blur();
    setSection('now');
    try{
      const hint=await new Promise<string>((resolve,reject)=>{
        locationWaiter.current?.finish(new BetaApiError('handoff_location_pending','通知入口已变化'));
        let timer:ReturnType<typeof setTimeout>|undefined;
        const abort=()=>owned.finish(new BetaApiError('handoff_location_pending','通知入口已变化'));
        const attempt=++locationSequence.current;
        const owned={id:target.handoff_id,attempt,finish(error?:Error,hint?:string){clearTimeout(timer);signal.removeEventListener('abort',abort);if(locationWaiter.current===owned)locationWaiter.current=null;if(error)reject(error);else resolve(hint??'');}};
        locationWaiter.current=owned;timer=setTimeout(()=>owned.finish(new BetaApiError('handoff_location_pending','来源档案尚未完成定位')),8000);
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
        setDeadlineLocation({handoffId:target.handoff_id,profileId:target.profile_id,blockId:target.block_id,attempt});
      });
      if(!wanted())throw new BetaApiError('handoff_location_pending','通知入口已变化');
      return hint||message;
    }finally{if(current===generation.current&&selectionScope.current===scope)setDeadlineLocation(previous=>previous?.handoffId===target.handoff_id?null:previous);}
  }
  const handoff=useBetaDeadlineHandoff(handoffs,status?`${status.device_id}:${status.runtime_id??''}:${generation.current}`:'',!!status&&!!prepareSwitch.current&&!switching&&!creating,openDeadlineHandoff);
  useEffect(()=>{if(handoff.pending||handoff.failed)setSection('now');},[handoff.pending?.handoff_id,handoff.failed]);
  return <><BetaAppShell section={section} onSectionChange={setSection} profileName={profileName} onProfileClick={()=>setProfileDialog(true)}
    sync={<BetaPeersPage peers={peers} profileId={profileId} profileName={profileName} runtimeId={status?.runtime_id??''} deviceId={status?.device_id??''} onJoined={joined} onEventsChanged={changed=>{if(changed===profileId)setEventRevision(value=>value+1);}}/>}
    settings={<BetaSettingsPage profileName={profileName} profileId={profileId} deviceId={status?.device_id??''} endpoint={endpoint} onManageProfile={()=>setProfileDialog(true)} summaryModel={client.summaryModel} onDisconnect={persistenceBusy?undefined:onDisconnect}/>}
    now={<PageShell title="当下" headerTop={<BetaRuntimeLocation endpoint={endpoint}/>} className="min-h-0 overflow-y-auto" headerClassName="shrink-0" contentClassName="flex flex-col"
    headerAction={<div className="flex max-w-[15rem] items-center gap-1">{status&&profileId&&<>
      <label className="sr-only" htmlFor="beta-profile">当前档案</label>
      <select id="beta-profile" className={`${selectClass} min-w-0 max-w-36`} value={profileId} disabled={!prepareSwitch.current||switching||creating} onChange={event => {void changeProfile(event.target.value);}}>
        {profiles.map(item => <option key={item.profile_id} value={item.profile_id}>{item.display_name}</option>)}
      </select>
      </>}
      <Button variant="ghost" size="sm" aria-label="管理档案" onClick={()=>setProfileDialog(true)}>档案</Button>
      {onDisconnect&&<Button variant="ghost" size="sm" disabled={persistenceBusy} onClick={onDisconnect}>断开</Button>}
    </div>}
    headerBottom={status&&!profileId&&<div className="space-y-2"><p className="text-xs text-muted">先创建本机档案，或从同步页加入已授权档案。</p>
      <form onSubmit={create} className="flex min-w-0 flex-[1_1_16rem] gap-2">
        <Input aria-label="新档案名称" className="min-w-0 max-w-48" placeholder="新档案名称" value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={creating} />
        <Button type="submit" variant="outline" disabled={creating || persistenceBusy || !name.trim()}>{creating ? '创建中…' : '创建档案'}</Button>
      </form>
    </div>}>
    {handoff.message&&<div data-testid="beta-deadline-handoff" className="shrink-0 space-y-2 border-b border-border-page px-5 py-3"><p role={handoff.failed?'alert':'status'} className={handoff.failed?'text-xs text-destructive':'text-xs text-secondary'}>{handoff.message}</p>{(handoff.pending||handoff.failed)&&<Button variant="outline" size="sm" disabled={handoff.busy} onClick={handoff.retry}>重试打开提醒</Button>}</div>}
    {loading && <p role="status" className="p-5 text-sm text-muted">正在连接…</p>}
    {error && <div role="alert" className="flex items-center gap-2 px-5 py-3 text-sm text-destructive">{error}
      {!status && <Button variant="outline" onClick={() => setReload(value => value + 1)}>重新连接</Button>}</div>}
    {status && <DeviceWorkspace key={`${status.device_id}`} active={section==='now'} eventRevision={eventRevision} client={client} deviceId={status.device_id} profileId={profileId} sourceStore={sourceStore} intentJournal={intentJournal} intentPredecessor={intentPredecessor} onPersistenceBusy={setPersistenceBusy} prepareSwitch={prepareSwitch} deadlineLocation={deadlineLocation} onDeadlineLocated={(id,hint,attempt)=>{const waiter=locationWaiter.current;if(waiter?.id===id&&waiter.attempt===attempt)waiter.finish(undefined,hint);}} onConfigureSummary={()=>setSection('settings')} />}
  </PageShell>}/><BetaProfileDialog open={profileDialog} onOpenChange={setProfileDialog} profiles={profiles} profileId={profileId} loading={loading} disabled={persistenceBusy||switching||!prepareSwitch.current} creating={creating} name={name} onNameChange={setName} onCreate={create} onSelect={changeProfile} error={error}/></>;
}

function DeviceWorkspace({ client, deviceId, profileId, sourceStore, intentJournal, intentPredecessor, onPersistenceBusy, prepareSwitch, active, eventRevision, deadlineLocation, onDeadlineLocated,onConfigureSummary }: { client: BetaClient; deviceId: string; profileId: string; sourceStore?: FileSourceStore; intentJournal?:LocalIntentJournal; intentPredecessor?:IntentPredecessor; onPersistenceBusy:(busy:boolean)=>void; prepareSwitch:MutableRefObject<(()=>Promise<void>)|null>; active:boolean;eventRevision:number;deadlineLocation:DeadlineLocation|null;onDeadlineLocated:(id:string,hint:string,attempt:number)=>void;onConfigureSummary:()=>void }) {
  const summaryOwner=useRef<SummaryTasksController|null>(null);
  type Owners={capture:BetaDraftController;focus:BetaTimeblockController|null;profileId:string};
  const [owners, setOwners] = useState<Owners | null>(null);
  const [error, setError] = useState('');
  const [recoveryRequired,setRecoveryRequired]=useState(false);
  const [legacyConsent,setLegacyConsent]=useState<{client:BetaClient;deviceId:string;profileId:string}|null>(null);
  const allowLegacyImport=legacyConsent?.client===client&&legacyConsent.deviceId===deviceId&&legacyConsent.profileId===profileId;
  const [lockAttempt, setLockAttempt] = useState(0);
  const lockRequest = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let capture:BetaDraftController|undefined;let focus:BetaTimeblockController|undefined;
    let cancelled=false;let release:(()=>void)|undefined;let switchGuard:(()=>Promise<void>)|undefined;const unsubscribers:Array<()=>void>=[];
    onPersistenceBusy(true);setOwners(null);setRecoveryRequired(false);
    // Web Locks prevent two tabs overwriting this device's durable draft cache.
    const locks = navigator.locks;
    if (typeof locks?.request === 'function') {
      const previous = lockRequest.current;
      const operation = (async () => {
        // StrictMode replays effects before a previously requested lock may have
        // finished releasing. Wait only for this workspace's own lifecycle;
        // another window is still rejected with ifAvailable, never queued for.
        if (previous) await previous.catch(() => {});
        if (cancelled) return;
        await locks.request(`exomind-beta-drafts:${deviceId}`, { ifAvailable: true }, async lock => {
          if (cancelled) return;
          if (!lock) { setError('另一窗口正在编辑此设备的草稿，请先关闭该窗口，再重试草稿锁');onPersistenceBusy(false); return; }
          try {
            capture=await BetaDraftController.open(client,deviceId,{journal:intentJournal,predecessor:intentPredecessor,allowLegacyImport,sources:sourceStore});
            if(cancelled)return;
            if(profileId&&client.timeblocks)focus=await BetaTimeblockController.open(client,deviceId,profileId,{journal:intentJournal,predecessor:intentPredecessor,allowLegacyImport});
            if(cancelled)return;
            switchGuard=async()=>{
              summaryOwner.current?.fenceDispatch();
              for(let attempt=0;attempt<8;attempt++){
                if(cancelled)throw new Error('当前草稿窗口已关闭');
                await Promise.all([capture!.flush(),focus?.flush(),summaryOwner.current?.flush()]);
                if(cancelled)throw new Error('当前草稿窗口已关闭');
                if(capture!.snapshot().persistenceState==='idle'&&(!focus||focus.snapshot().persistenceState==='idle'))return;
              }
              throw new Error('草稿仍在变化，请停止输入后重试');
            };
            prepareSwitch.current=switchGuard;
            const update=()=>{if(!cancelled)onPersistenceBusy(capture!.snapshot().persistenceState!=='idle'||!!focus&&focus.snapshot().persistenceState!=='idle');};
            unsubscribers.push(capture.subscribe(update));if(focus)unsubscribers.push(focus.subscribe(update));
            setOwners({capture,focus:focus??null,profileId});setError('');update();
            await new Promise<void>(resolve=>{release=resolve;});
          } finally {
            for(const unsubscribe of unsubscribers)unsubscribe();capture?.dispose();focus?.dispose();const summary=summaryOwner.current;summary?.dispose();
            // The Web Lock callback does not settle while an accepted local
            // transaction is still draining, including StrictMode late opens.
            await Promise.all([capture?.close(),focus?.close(),summary?.close()]);
          }
        });
      })();
      lockRequest.current = operation;
      void operation.catch(failure => { if (!cancelled) {setError(errorMessage(failure));setRecoveryRequired(!!failure&&typeof failure==='object'&&'code'in failure&&failure.code==='intent_recovery_required');onPersistenceBusy(false);} });
    }
    else {setError('当前浏览器不支持安全的草稿窗口锁，请使用支持 Web Locks 的浏览器');onPersistenceBusy(false);}
    return () => { cancelled = true;if(prepareSwitch.current===switchGuard)prepareSwitch.current=null;capture?.dispose();focus?.dispose();summaryOwner.current?.dispose();release?.();setOwners(null); };
  }, [client, deviceId, profileId, lockAttempt, sourceStore, intentJournal, intentPredecessor, allowLegacyImport, onPersistenceBusy, prepareSwitch]);
  if (error) return <div className="space-y-3 p-5">
    <p role="alert" className="text-sm text-destructive">{error}</p>
    {recoveryRequired&&<div className="space-y-2"><p className="text-xs text-secondary">旧缓存可能缺少最近输入或原件源，恢复不代表完整找回新稿。原缓存会保留；缺少的原文件需要重新选择。</p><Button variant="outline" onClick={()=>{setLegacyConsent({client,deviceId,profileId});setError('');setLockAttempt(value=>value+1);}}>恢复旧缓存（保留原缓存）</Button></div>}
    {typeof navigator.locks?.request === 'function' && <Button variant="outline" onClick={() => {
      owners?.capture.dispose();owners?.focus?.dispose();setOwners(null);setError('');setLockAttempt(value=>value+1);
    }}>重试草稿锁</Button>}
  </div>;
  if(!owners||owners.profileId!==profileId)return <p role="status" className="p-5 text-xs text-muted">正在恢复本机草稿…</p>;
  if(!profileId)return null;
  return <ProfileWorkspace key={profileId} visible={active} externalRevision={eventRevision} client={client} controller={owners.capture} focus={owners.focus} deviceId={deviceId} profileId={profileId} deadlineLocation={deadlineLocation} onDeadlineLocated={onDeadlineLocated} onConfigureSummary={onConfigureSummary} intentJournal={intentJournal} summaryOwner={summaryOwner}/>;
}

async function readTimeline(client:BetaClient,profileId:string,query:BetaQuery):Promise<BetaTimelinePage>{
  if(client.timelinePage)return client.timelinePage(profileId,query);
  const page=await client.eventsPage(profileId,query);return{...page,items:page.items.map(record=>({kind:'capture' as const,record}))};
}
function ProfileWorkspace({ client, controller, focus, deviceId,profileId, visible, externalRevision, deadlineLocation, onDeadlineLocated,onConfigureSummary,intentJournal,summaryOwner }: { client: BetaClient; controller: BetaDraftController; focus:BetaTimeblockController|null; deviceId:string;profileId: string; visible:boolean;externalRevision:number;deadlineLocation:DeadlineLocation|null;onDeadlineLocated:(id:string,hint:string,attempt:number)=>void;onConfigureSummary:()=>void;intentJournal?:LocalIntentJournal;summaryOwner:MutableRefObject<SummaryTasksController|null> }) {
  const drafts = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const inputSendMode = useBetaInputSendMode();
  const [page, setPage] = useState<BetaTimelinePage | null>(null);
  const pageRef=useRef(page);pageRef.current=page;
  const pageOwner=useRef({client,profileId,query:''});
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const generation = useRef(0);
  const scroll = useRef<HTMLDivElement>(null); const olderHeight = useRef<number | null>(null);
  const alive = useRef(true); const now = useBetaNow();
  const mode=useBetaDateDisplayMode();
  const readingTop=useRef(0);const followTail=useRef(true);
  const [reviewsOpen,setReviewsOpen]=useState(false),[reviewTarget,setReviewTarget]=useState<SummaryArtifactRecord|null>(null),[summarySource,setSummarySource]=useState<SummarySourceRef|null>(null);
  const sourceReader=useMemo(()=>client.timelineEvent?(profile:string,event:string)=>client.timelineEvent!(profile,event):undefined,[client,client.timelineEvent]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const same=pageOwner.current.client===client&&pageOwner.current.profileId===profileId&&pageOwner.current.query===query;
    const previous=same?pageRef.current:null;
    if(!same){setPage(null);pageRef.current=null;followTail.current=true;readingTop.current=0;}
    pageOwner.current={client,profileId,query};
    const current = ++generation.current; setLoading(true); setError('');
    void refreshTimelineWindow(next=>readTimeline(client,profileId,next),previous,query).then(result => {
      if (current === generation.current) { olderHeight.current = null; setPage(result); }
    }).catch(failure => { if (current === generation.current) setError(errorMessage(failure)); })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => { ++generation.current; };
  }, [client, profileId, query, revision,externalRevision]);
  useEffect(()=>{
    if(!visible||!client.summaries||loading)return;
    // Read-only foreground refresh, serialized by the existing timeline load.
    // Each reconciliation remains bounded to the existing 16-page window.
    const refresh=()=>{if(!document.hidden&&alive.current)setRevision(value=>value+1);};
    const timer=setTimeout(refresh,3000);document.addEventListener('visibilitychange',refresh);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);};
  },[visible,client,client.summaries,profileId,loading,query]);
  useLayoutEffect(() => {
    const element = scroll.current; if (!element) return;
    if(!visible)return;
    if (olderHeight.current !== null) element.scrollTop += element.scrollHeight - olderHeight.current;
    else if(followTail.current)element.scrollTop = element.scrollHeight;
    else element.scrollTop=readingTop.current;
    readingTop.current=element.scrollTop;
    olderHeight.current = null;
  }, [page,visible]);
  async function older() {
    if (!page || page.next_before === null || loading) return;
    const current = generation.current; setLoading(true); setError('');
    try {
      const result = await readTimeline(client,profileId, { before: page.next_before, through: page.highwater, limit: 100, ...(query ? { search: query } : {}) });
      if (current !== generation.current) return;
      olderHeight.current = scroll.current?.scrollHeight ?? null;
      setPage({ ...result, items: mergeTimelineItems(page.items,result.items) });
    } catch (failure) { if (current === generation.current) setError(errorMessage(failure)); }
    finally { if (current === generation.current) setLoading(false); }
  }
  async function submit(commandId?: string) {
    if (!commandId && clipboardFlight.current) return;
    setError('');
    try {
      const receipt = commandId ? await controller.retry(commandId) : await controller.submit(profileId);
      if (receipt && alive.current) setRevision(value => value + 1);
    } catch (failure) { if (alive.current) setError(errorMessage(failure)); }
  }
  const draft = drafts.drafts[profileId];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (visible && textareaRef.current) window.dispatchEvent(new Event('beta:capture-input-ready')); }, [visible]);
  const fileInput = useRef<HTMLInputElement>(null);
  const reselectTarget = useRef<string | null>(null);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const clipboardFlight = useRef<object | null>(null);
  const [pasteFeedback, setPasteFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const pasteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clipboardFlight.current = null; clearTimeout(pasteTimer.current); }, []);
  function reportPaste(result: 'success' | 'error') {
    setPasteFeedback(result); clearTimeout(pasteTimer.current);
    pasteTimer.current = setTimeout(() => { if (alive.current) setPasteFeedback('idle'); }, 1500);
  }
  function insertClipboardText(text: string) {
    if (!text) return;
    const element = textareaRef.current;
    const current = controller.snapshot().drafts[profileId]?.text ?? '';
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    controller.setDraft(profileId, current.slice(0, start) + text + current.slice(end));
    requestAnimationFrame(() => {
      if (!alive.current || !textareaRef.current) return;
      textareaRef.current.focus(); textareaRef.current.setSelectionRange(start + text.length, start + text.length);
      resizeNowInputTextarea(textareaRef.current);
    });
  }
  async function pasteClipboard(read: () => Promise<{ files: File[]; text: string }>) {
    if (clipboardFlight.current) return;
    const flight = {}; clipboardFlight.current = flight; setClipboardBusy(true); setError('');
    const revision = controller.snapshot().drafts[profileId]?.revision ?? 0;
    try {
      const result = await read();
      if (!alive.current || clipboardFlight.current !== flight) return;
      if (!result.files.length && !result.text) throw new Error('剪贴板没有可粘贴的图片或文字');
      // A system permission dialog can outlive edits or a profile switch. Never
      // replace newer input with text captured for the earlier draft.
      if (result.text && revision !== (controller.snapshot().drafts[profileId]?.revision ?? 0)) throw new Error('草稿已变化，请再次粘贴；现有输入已保留');
      if (result.files.length && !client.originals) throw new Error('当前服务尚不支持图片原件');
      insertClipboardText(result.text);
      if (result.files.length) await controller.addFiles(profileId, result.files);
      if (alive.current && clipboardFlight.current === flight) reportPaste('success');
    } catch (failure) {
      if (alive.current && clipboardFlight.current === flight) { setError(errorMessage(failure)); reportPaste('error'); }
    } finally {
      if (clipboardFlight.current === flight) { clipboardFlight.current = null; if (alive.current) setClipboardBusy(false); }
    }
  }
  useEffect(() => { void controller.resumeFiles(profileId); }, [controller, profileId]);
  useLayoutEffect(() => resizeNowInputTextarea(textareaRef.current), [draft?.text]);
  const pending = drafts.pending.filter(item => item.command.profile_id === profileId && item.state !== 'committed');
  const busy = pending.some(item => item.state === 'pending' && item.draft_revision === draft?.revision);
  const preparing = draft?.files?.some(file => !file.original || file.state === 'preparing') ?? false;
  return <>
    {focus&&<MainOverlayBridge client={client} capture={controller} focus={focus} profileId={profileId} onCommitted={()=>setRevision(value=>value+1)}/>}
    {focus&&<BetaFocusTimer controller={focus} client={client} profileId={profileId}
      onCommitted={()=>setRevision(value=>value+1)}
      handoffTarget={visible&&deadlineLocation?.profileId===profileId?deadlineLocation:undefined}
      onHandoffReady={(id,hint,attempt)=>{
        const region=scroll.current?.parentElement?.querySelector<HTMLElement>('section[aria-label="时间块"]');
        if(region){
          region.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
          onDeadlineLocated(id,hint,attempt);
        }
      }}/>
    }
    {!client.timelinePage&&<p className="px-5 py-1 text-[11px] text-muted">此连接仅提供兼容记录历史，尚未提供完整时间线</p>}
    <div className="flex flex-wrap gap-2 border-b border-border-page px-5 py-2">
      <form className="flex min-w-0 flex-1 gap-2" onSubmit={event => { event.preventDefault(); setQuery(search); }}>
        <Input aria-label="搜索记录" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索文字" />
        <Button variant="outline" type="submit">搜索</Button>
      </form>
      <select aria-label="日期显示" className={selectClass} value={mode} onChange={event => {
        const value = event.target.value as EventDateDisplayMode;
        try { setBetaDateDisplayMode(value); } catch { setError('日期偏好暂时无法保存'); }
      }}><option value="compact">简略日期</option><option value="full">完整日期</option><option value="weekday">星期日期</option></select>
      <Button variant="ghost" size="icon" aria-label="刷新记录" onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-4" /></Button>
      <Button variant="outline" size="sm" onClick={()=>{setReviewTarget(null);setReviewsOpen(true);}}>回顾</Button>
    </div>
    {error && <p role="alert" className="px-5 py-2 text-sm text-destructive">{error}</p>}
    <div ref={scroll} className="min-h-[8rem] flex-1 overflow-y-auto px-5 py-4" aria-label="记录历史" aria-busy={loading} onScroll={event=>{if(!visible)return;const element=event.currentTarget;readingTop.current=element.scrollTop;followTail.current=element.scrollHeight-element.clientHeight-element.scrollTop<64;}}>
      {page?.next_before !== null && page && <div className="mb-4 text-center"><Button variant="ghost" disabled={loading} onClick={() => void older()}>加载更早记录</Button></div>}
      {loading && <p role="status" className="text-center text-sm text-muted">正在读取…</p>}
      {page?.items.length === 0 && <p className="py-8 text-center text-sm text-muted">{query ? '没有匹配记录' : '还没有记录'}</p>}
      <div className="space-y-4">{page && [...page.items].reverse().map(item => item.kind==='timeblock'?<ChatMessageRowView key={item.record.event_id} eventId={item.record.event_id} timelineKind="timeblock" tone="system"
        avatar={<Avatar className="mt-0.5 h-8 w-8 shrink-0"><AvatarFallback className="bg-surface text-brand-accent"><Timer size={16}/></AvatarFallback></Avatar>}
        metadata={<><span className="text-xs font-semibold text-strong">{item.record.source.kind==='scheduler'?'计时服务':'我 · 时间块'}</span><EventTimestamp timestamp={item.record.occurred_at_ms} now={now} mode={mode}/></>}
        content={<p className="whitespace-pre-wrap break-words">{betaTimeblockLabel(item.record)}</p>}/>
      :item.kind==='summary/1'?<BetaSummaryHistoryRow key={item.record.event_id} record={item.record} api={client.summaries} revision={page.highwater} now={now} dateMode={mode} onInspect={record=>{setReviewTarget(record);setReviewsOpen(true);}} onOpenSource={sourceReader?source=>setSummarySource(source):undefined}/>
      :item.kind==='agent_summary/1'?<BetaExternalSummaryHistoryRow key={item.record.event_id} record={item.record} now={now} dateMode={mode} onOpenSource={sourceReader?source=>setSummarySource(source):undefined}/>
      :(()=>{const event=item.record;return <ChatMessageRowView key={event.event_id} eventId={event.event_id} timelineKind="capture" tone={event.author_kind==='human'?'user':'system'}
        avatar={<Avatar className={`${event.author_kind==='human'?'':'mt-0.5 '}h-8 w-8 shrink-0`}><AvatarFallback className={event.author_kind==='human'?'rounded-full bg-orange-100 text-[11px] font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-100':'bg-surface text-brand-accent'}>{event.author_kind==='human'?'我':<Bot size={16}/>}</AvatarFallback></Avatar>}
        metadata={<><span className="text-muted">设备 {event.device_id.slice(0,8)}</span><EventTimestamp timestamp={event.occurred_at_ms} now={now} mode={mode}/><span className="text-xs font-semibold text-strong">{event.author_kind==='human'?'我':'Agent 记录'}</span></>}
        content={event.text?<p className="whitespace-pre-wrap break-words">{event.text}</p>:null}
        afterBubble={!!event.originals?.length&&<OriginalDownloads client={client} profileId={profileId} originals={event.originals}/>}/>;})())}</div>
    </div>
    <BetaSummaryTasksPanel open={reviewsOpen} onOpenChange={setReviewsOpen} client={client} deviceId={deviceId} profileId={profileId} target={reviewTarget} revision={page?.highwater??0} now={now} dateMode={mode} onConfigure={onConfigureSummary} onChanged={()=>{if(alive.current)setRevision(value=>value+1);}} onOpenSource={sourceReader?source=>setSummarySource(source):undefined} intentJournal={intentJournal} onOwner={owner=>{summaryOwner.current=owner;}}/>
    <BetaSummarySourceDialog profileId={profileId} source={summarySource} reader={sourceReader} onClose={()=>setSummarySource(null)} now={now} dateMode={mode}/>
    <NowInputRowView
      value={draft?.text ?? ''}
      placeholder="记录此刻的想法…"
      inputRef={textareaRef}
      textareaLabel="记录当下"
      sendLabel="发送"
      onValueChange={(next, element) => { try { controller.setDraft(profileId, next); resizeNowInputTextarea(element); } catch (failure) { setError(errorMessage(failure)); } }}
      onKeyDown={event => { if (!event.nativeEvent.isComposing && shouldSubmitOnEnter(inputSendMode, event)) { event.preventDefault(); void submit(); } }}
      onPaste={event => {
        const files = clipboardImageFiles(event.clipboardData);
        if (!files.length) return;
        event.preventDefault();
        if (clipboardFlight.current) { setError('正在粘贴图片，请稍候再试'); return; }
        const text = event.clipboardData.getData('text/plain');
        void pasteClipboard(async () => ({ files, text }));
      }}
      onPasteClick={() => pasteClipboard(readBetaClipboard)}
      pasteFeedback={pasteFeedback}
      pasteFailureLabel="未粘贴"
      onSend={() => submit()}
      onAttachmentClick={client.originals ? () => { reselectTarget.current = null; if (fileInput.current) { fileInput.current.multiple = true; fileInput.current.click(); } } : undefined}
      sendDisabled={(!draft?.text.trim() && !draft?.files?.length) || preparing || busy || clipboardBusy || !!drafts.persistenceError}
      beforeControls={<>
      <input ref={fileInput} type="file" multiple hidden aria-label="选择原件" onChange={event => {
        const selected = Array.from(event.target.files ?? []); event.target.value = '';
        const target = reselectTarget.current; reselectTarget.current = null;
        if (!selected.length) return;
        const operation = target ? controller.reselectFile(profileId, target, selected[0]) : controller.addFiles(profileId, selected);
        void operation.catch(failure => { if (alive.current) setError(errorMessage(failure)); });
      }} />
      {!!draft?.files?.length && <div className="mb-2 flex flex-col gap-2" aria-label="原件队列">
        {draft.files.map(file => <div key={file.id} className="flex items-center gap-2 rounded-2xl border border-[#E7E5E4] bg-white/90 px-3 py-2 shadow-sm dark:border-[#292524] dark:bg-[#1C1917]">
          {file.original && <BetaImagePreview identity={`${deviceId}:${profileId}:${file.id}:${file.original.sha256}`} fileName={file.file_name} mediaType={file.media_type} byteLength={file.byte_length} load={() => controller.previewSource(profileId, file.id)} thumbnail />}
          {(!file.original || !file.media_type.startsWith('image/')) && <FileText size={16} className="shrink-0 text-[#C75B3A] dark:text-[#FDBA74]" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-stone-700 dark:text-stone-100">{file.file_name}</p>
            <p className="text-[10px] text-stone-500 dark:text-[#A8A29E]">{formatBytes(file.byte_length)} · {file.state === 'verified' ? '原件已暂存，尚未提交记录' : file.state === 'preparing' ? '正在复制并校验本机源…' : file.state === 'uploading' ? `正在暂存 ${formatBytes(file.next_offset)}` : file.state === 'source_missing' ? '本机源缺失，请重选' : '暂存未完成'}</p>
            {file.message && <p className="text-xs text-destructive">{file.message}</p>}
          </div>
          {(file.state === 'failed' || file.state === 'source_missing') && <>
            {file.original && <Button size="sm" variant="ghost" onClick={() => { void controller.resumeFiles(profileId); }}>恢复暂存</Button>}
            <Button size="sm" variant="ghost" onClick={() => { reselectTarget.current = file.id; if (fileInput.current) { fileInput.current.multiple = false; fileInput.current.click(); } }}>重新选择</Button>
          </>}
          <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-[#78716C] dark:hover:bg-[#292524] dark:hover:text-[#E7E5E4]"
            aria-label={`移除原件：${file.file_name}`} onClick={() => { try { controller.removeFile(profileId, file.id); } catch (failure) { setError(errorMessage(failure)); } }}><X size={14} /></button>
        </div>)}
      </div>}
      {drafts.persistenceError && <p role="alert" className="mb-2 text-xs text-destructive">{drafts.persistenceError}</p>}
      {drafts.persistenceState==='failed'&&<Button variant="outline" size="sm" className="mb-2" onClick={()=>{void controller.flush().catch(failure=>setError(errorMessage(failure)));}}>重试记录草稿暂存</Button>}
      {pending.map(item => <div key={item.command.command_id} className="mb-2 flex items-center gap-2 text-xs text-secondary">
        <div className="min-w-0 flex-1"><p>{item.state === 'pending' ? item.capture_attempted === false ? '正在准备固定整组原件…' : '正在确认保存…' : item.state === 'failed' ? '原件或本机暂存未就绪，记录未提交' : `结果待确认${item.error_code ? `（${item.error_code}）` : ''}`}</p><p className="truncate">{item.command.text}</p>{!!item.command.originals?.length && <p className="truncate">{item.command.originals.map(file => file.file_name).join('、')}</p>}{item.message && <p>{item.message}</p>}</div>
        {item.state !== 'pending' && <Button variant="outline" size="sm" onClick={() => void submit(item.command.command_id)}>查证并重试</Button>}
      </div>)}
      </>}
      afterControls={<p role="status" className="mt-2 text-[11px] text-muted">{clipboardBusy?'正在粘贴…':drafts.persistenceState==='pending'?'正在暂存记录草稿…':drafts.persistenceState==='failed'?'暂存失败，请保留窗口并重试':pending.length ? '待确认的提交会保留原文与原命令' : draft?.text === '' && drafts.confirmed.some(item => item.receipt.profile_id === profileId && item.draft_revision + 1 === draft.revision) ? '本机已保存' : draft?.text.trim()||draft?.files?.length?'记录草稿已暂存 · 尚未提交':`${inputSendShortcutLabel(inputSendMode)} · 支持粘贴图片`}</p>}
    />
  </>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
