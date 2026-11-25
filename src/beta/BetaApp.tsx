import { Tooltip } from '@/components/ui/tooltip';
import { BetaTimelineItemRow } from './BetaTimelineItemRow';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type MutableRefObject } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { FileText, PanelsTopLeft, X } from 'lucide-react';
import { PageShell } from '@/ui/app/components/PageShell';
import { NowInputRowView, resizeNowInputTextarea } from '@/ui/app/components/NowInputRowView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import { nativeBetaClient, webBetaClient, type BetaClient, type BetaEvent, type BetaProfile, type BetaStatus, type BetaQuery } from './client';
import { BetaDraftController, errorMessage } from './drafts';
import { betaUuid } from './initialization';
import { useBetaNow } from './date-clock';
import { formatBetaPeriodWindow, resolveBetaPeriodWindow, shiftBetaPeriodAnchor, type BetaPeriodWindow, type BetaTimelinePeriod } from './period-window';
import type { FileSourceStore } from './file-source-store';
import type { LocalIntentJournal,IntentPredecessor } from './local-intent-journal';
import type { BetaTimelineItem, BetaTimelinePage, BetaTimelinePeriodQuery } from './timeblocks-types';
import type { SummaryArtifactRecord,SummarySourceRef } from './summary-types';
import { BetaSummaryTasksPanel } from './BetaSummaryTasksPanel';
import { BetaSummarySourceDialog } from './BetaSummarySourceDialog';
import type { SummaryTasksController } from './summary-tasks-controller';
import { BetaTimeblockController } from './timeblocks-controller';
import { BetaFocusTimer } from './BetaFocusTimer';
import { BetaHistoryToolbar, BetaWorkspacePane, BetaWorkspaceToolbar } from './BetaWorkspaceView';
import { useBetaWorkspacePresentation, type BetaWorkspaceLayout, type BetaWorkspacePresentation } from './workspace-layout';
import { useBetaViewActive } from './view-activity';
import { MainOverlayBridge } from './overlay/MainOverlayBridge';
import { keepBetaEditableInViewport } from './editable-viewport';
import { BetaAppShell, type BetaSection } from './BetaAppShell';
import { BetaSettingsPage } from './BetaSettingsPage';
import { BetaPeersPage } from './BetaPeersPage';
import { nativeBetaPeersClient, type BetaPeersClient } from './peers-client';
import { openBetaOverlayForProfile, setBetaDateDisplayMode, useBetaDateDisplayMode, useBetaThemePresentation } from './preferences';
import { mergeTimelineItems, refreshTimelineWindow } from './timeline-refresh';
import { BetaProfileDialog } from './BetaProfileDialog';
import { BetaProfileArchiveEntry } from './BetaProfileArchives';
import { rememberLastBetaProfile, restoreLastBetaProfile } from './last-profile';
import { BetaApiError } from './api-error';
import { ProfileSwitchGuardGate } from './profile-switch-guard';
import { nativeBetaDeadlineHandoffsClient, type BetaDeadlineHandoff, type BetaDeadlineHandoffsClient } from './deadline-handoff-client';
import { describeDeadlineHandoff, useBetaDeadlineHandoff } from './deadline-handoff';
import { clipboardImageFiles, readBetaClipboard } from './clipboard-images';
import { BetaImagePreview } from './BetaImagePreview';
import { BetaRuntimeLocation } from './BetaRuntimeLocation';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from '@/components/ui/toast-hook';
import { betaDesktopPreferences } from './desktop-preferences';
import { observeBetaTimeblockEnd, playBetaTimeblockEndSound } from './timeblock-end-sound';
import { inputSendShortcutLabel, shouldSubmitOnEnter, useBetaInputSendMode } from './input-preferences';
import { BetaCaptureStatus } from './BetaCaptureStatus';
import { BetaOriginalExportCenter } from './BetaOriginalExportCenter';
import { BetaUserRangeExportControls } from './BetaUserRangeExportControls';
import { useUserRangeExportState } from './user-range-export-state';
import type { UserRangeSelection } from './user-range-export-client';
import { BetaAttachmentProgress } from './BetaAttachmentProgress';
import { FieldSelect } from '@/components/ui/field-select';
import { pickNativeFiles } from './native-attachments';
import { useNativeAttachmentDrop } from './native-attachment-drop';
import type { AttachmentSelection } from './native-attachment-types';
import { BetaAudioRecordingController } from './beta-audio-recording';
import { BetaAudioRecorder } from './BetaAudioRecorder';
import { BetaCaptureTagsEditor, BetaRecordCorrectionDialog, BetaRecordTagFilter } from './BetaRecordOrganization';
import { BetaRecordCorrectionOwner } from './record-correction-owner';
import { useBetaDeviceNames } from './device-names';
import { BetaMessageLocationBoundary, BetaMessageReferenceDraft, type BetaMessageLocationNotice } from './BetaMessageActions';
import { locateBetaMessageReference } from './beta-message-locator';
import { buildBetaMessageReferenceUri, insertBetaMessageReference, removeBetaMessageReference } from './message-references';
import type { BetaMessageReference, BetaMessageReferenceIdentity, BetaMessageReferenceSource } from './message-references';
import { betaProfileLabels } from './profile-display';
import { BetaShareHandoffInbox } from './BetaShareHandoffInbox';
import { nativeBetaShareHandoffsClient, type BetaShareHandoffsClient } from './share-handoff-client';
import { countPendingBetaShareHandoffs, useBetaShareHandoffQueue, type BetaShareHandoffQueueSnapshot } from './share-handoff-queue';

const SESSION_KEY = 'exomind:beta:connection';

/** A separate entry: no legacy runtime/profile/event-store bootstrap. */
export function BetaApp({ client: injected, sourceStore, intentJournal, intentPredecessor, peers: injectedPeers, handoffs: injectedHandoffs, shareHandoffs: injectedShareHandoffs }: { client?: BetaClient; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor; peers?:BetaPeersClient|null; handoffs?:BetaDeadlineHandoffsClient|null; shareHandoffs?:BetaShareHandoffsClient|null }) {
  useEffect(() => keepBetaEditableInViewport(), []);
  useBetaThemePresentation();
  const [native] = useState(() => isTauri());
  const [nativePeers] = useState(() => native ? nativeBetaPeersClient() : null);
  const [nativeHandoffs] = useState(() => native ? nativeBetaDeadlineHandoffsClient() : null);
  const [nativeShareHandoffs] = useState(() => native ? nativeBetaShareHandoffsClient() : null);
  const peers = injectedPeers === undefined ? injected ? null : nativePeers : injectedPeers;
  const handoffs = injectedHandoffs === undefined ? injected ? null : nativeHandoffs : injectedHandoffs;
  const shareHandoffs = injectedShareHandoffs === undefined ? injected ? null : nativeShareHandoffs : injectedShareHandoffs;
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
  if (client) return <ConnectedBeta key={native ? 'native' : undefined} endpoint={!native && !injected ? endpoint : undefined} client={client} peers={peers} handoffs={handoffs} shareHandoffs={shareHandoffs} sourceStore={sourceStore} intentJournal={intentJournal} intentPredecessor={intentPredecessor}
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
type MessageReadingPosition={top:number;followTail:boolean;layout:BetaWorkspaceLayout};
type MessageLocationRestore={kind:'reading';position:MessageReadingPosition}|{kind:'latest'};
type MessageLocationView={reference:BetaMessageReferenceIdentity;state:BetaMessageLocationNotice;item?:BetaTimelinePage['items'][number]};
type MessageLocationFlight={sequence:number;profileId:string;eventId:string;client:BetaClient;abort:AbortController};
type BetaTimelineMode = 'all' | BetaTimelinePeriod;
type BetaTimelinePageOwner = {client:BetaClient;profileId:string;query:string;tag:string;mode:BetaTimelineMode;from_ms:number|null;to_ms:number|null};
type TagReturnView={client:BetaClient;profileId:string;query:string;search:string;tagSearch:string;tag:string;mode:BetaTimelineMode;from_ms:number|null;to_ms:number|null;page:BetaTimelinePage|null;top:number;followTail:boolean};
type PreparingPreSend={profileId:string;revision:number;clipboardAttempt?:object};
type QueuedClipboardPreSend={flight:object;profileId:string;revision:number};
function ConnectedBeta({ client, peers, handoffs, shareHandoffs, onDisconnect, sourceStore, intentJournal, intentPredecessor, endpoint }: { client: BetaClient; peers:BetaPeersClient|null; handoffs:BetaDeadlineHandoffsClient|null; shareHandoffs:BetaShareHandoffsClient|null; onDisconnect?: () => void; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor; endpoint?: string }) {
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
  const workspace = useBetaWorkspacePresentation();
  const openIncomingShare=useCallback(()=>setSection('now'),[]);
  const shareQueue=useBetaShareHandoffQueue(shareHandoffs,profileId,openIncomingShare);
  const pendingShareCount=countPendingBetaShareHandoffs(shareQueue.state.handoffs);
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
  const prepareSwitch=useMemo(()=>new ProfileSwitchGuardGate(),[]);
  const switchGuardReady=useSyncExternalStore(prepareSwitch.subscribe,prepareSwitch.snapshot,prepareSwitch.snapshot)!==null;
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
  const profileLabels=useMemo(()=>betaProfileLabels(profiles),[profiles]);
  const profileName=profileId?profileLabels.get(profileId)?.text??profileId:'';
  function refreshArchiveProfiles() {
    const current = generation.current, scope = selectionScope.current;
    if (!scope || scope.generation !== current) return;
    void client.profiles().then(list => {
      if (generation.current !== current || selectionScope.current !== scope) return;
      // Profiles are append-only. A late list cannot erase a newer local admission.
      const merged = [...new Map([...list, ...scope.profiles].map(profile => [profile.profile_id, profile])).values()];
      scope.profiles = merged;
      setProfiles(merged);
    }).catch(failure => {
      if (generation.current === current && selectionScope.current === scope) setError(`档案列表暂未刷新：${errorMessage(failure)}`);
    });
  }
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
  const handoff=useBetaDeadlineHandoff(handoffs,status?`${status.device_id}:${status.runtime_id??''}:${generation.current}`:'',!!status&&switchGuardReady&&!switching&&!creating,openDeadlineHandoff);
  useEffect(()=>{if(handoff.pending||handoff.failed)setSection('now');},[handoff.pending?.handoff_id,handoff.failed]);
  const workspaceTools = <>{client.originalExports&&<BetaOriginalExportCenter client={client} profileId={profileId} visible={section==='now'}/>}<BetaRuntimeLocation endpoint={endpoint} compact/>
    {isTauri()&&!/Android|iPhone|iPad/i.test(navigator.userAgent)&&<Tooltip content="在浮窗打开当前档案"><Button size="icon" variant="ghost" aria-label="专注浮窗"  onClick={()=>{void openBetaOverlayForProfile(profileId).catch(failure=>setError(errorMessage(failure)));}}><PanelsTopLeft size={16}/></Button></Tooltip>}
    <FieldSelect id="beta-profile" label="当前档案" title="当前档案" className="max-w-28" value={profileId} disabled={!switchGuardReady||switching||creating} onValueChange={value=>{void changeProfile(value);}} options={profiles.map(profile=>({value:profile.profile_id,label:profileLabels.get(profile.profile_id)?.text??profile.display_name}))}/>
    {onDisconnect&&<Button variant="ghost" size="sm" disabled={persistenceBusy} onClick={onDisconnect}>断开</Button>}</>;
  return <><BetaAppShell section={section} onSectionChange={setSection} profileName={profileName} onProfileClick={()=>setProfileDialog(true)}
    sync={<BetaPeersPage peers={peers} visible={section==='sync'} profileId={profileId} profileName={profileName} runtimeId={status?.runtime_id??''} deviceId={status?.device_id??''} onJoined={joined} onEventsChanged={changed=>{if(changed===profileId)setEventRevision(value=>value+1);}}/>}
    settings={<BetaSettingsPage profileName={profileName} profileId={profileId} deviceId={status?.device_id??''} endpoint={endpoint} onManageProfile={()=>setProfileDialog(true)} summaryModel={client.summaryModel} onDisconnect={persistenceBusy?undefined:onDisconnect} visible={section==='settings'}/>}
    now={<PageShell title="当下" hideHeader={!!status&&!!profileId} className="min-h-0 overflow-hidden" headerClassName="shrink-0" contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
    headerAction={<div className="flex max-w-[15rem] items-center gap-1">{status&&profileId&&<>
      <label className="sr-only" htmlFor="beta-profile">当前档案</label>
      <FieldSelect id="beta-profile" label="当前档案" className="max-w-36" value={profileId} disabled={!switchGuardReady||switching||creating} onValueChange={value=>{void changeProfile(value);}} options={profiles.map(profile=>({value:profile.profile_id,label:profileLabels.get(profile.profile_id)?.text??profile.display_name}))}/>
      </>}
      <Button variant="ghost" size="sm" aria-label="管理档案" onClick={()=>setProfileDialog(true)}>档案</Button>
      {onDisconnect&&<Button variant="ghost" size="sm" disabled={persistenceBusy} onClick={onDisconnect}>断开</Button>}
    </div>}
     headerBottom={status&&!profileId&&<div className="space-y-2"><p className="text-xs text-muted">先创建本机档案，或从同步页加入已授权档案。</p>
       {shareQueue.state.loading&&!shareQueue.state.handoffs.length&&<p role="status" className="text-xs text-muted">正在查证待处理的系统分享…</p>}
       {pendingShareCount>0&&<div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-page px-3 py-2">
         <p role="status" className="min-w-0 flex-1 text-xs text-secondary">有 {pendingShareCount} 条系统分享待处理；选择档案后查看内容并继续处理。此处不会显示分享内容。</p>
         <Button type="button" size="sm" variant="outline" onClick={()=>setProfileDialog(true)}>选择或创建档案</Button>
       </div>}
       {shareQueue.state.error&&<div className="flex flex-wrap items-center gap-2"><p role="alert" className="min-w-0 flex-1 text-xs text-destructive">系统分享状态未知；暂不能确认是否已在本机暂存。请保留来源应用中的原始内容。</p><Button type="button" size="sm" variant="outline" onClick={()=>{void shareQueue.refresh();}}>重新读取</Button></div>}
      <form onSubmit={create} className="flex min-w-0 flex-[1_1_16rem] gap-2">
        <Input aria-label="新档案名称" className="min-w-0 max-w-48" placeholder="新档案名称" value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={creating} />
        <Button type="submit" variant="outline" disabled={creating || persistenceBusy || !name.trim()}>{creating ? '创建中…' : '创建档案'}</Button>
      </form>
    </div>}>
    {status && profileId && <BetaWorkspaceToolbar layout={workspace.layout} onChange={workspace.change} hasFocus={!!client.timeblocks} tools={workspaceTools}/>}
    {workspace.error && <p role="alert" className="shrink-0 px-5 py-2 text-xs text-destructive">{workspace.error}</p>}
    {handoff.message&&<div data-testid="beta-deadline-handoff" className="shrink-0 space-y-2 border-b border-border-page px-5 py-3"><p role={handoff.failed?'alert':'status'} className={handoff.failed?'text-xs text-destructive':'text-xs text-secondary'}>{handoff.message}</p>{(handoff.pending||handoff.failed)&&<Button variant="outline" size="sm" disabled={handoff.busy} onClick={handoff.retry}>重试打开提醒</Button>}</div>}
    {loading && <p role="status" className="p-5 text-sm text-muted">正在连接…</p>}
    {error && <div role="alert" className="flex items-center gap-2 px-5 py-3 text-sm text-destructive">{error}
      {!status && <Button variant="outline" onClick={() => setReload(value => value + 1)}>重新连接</Button>}</div>}
     {status && <DeviceWorkspace key={`${status.device_id}`} workspace={workspace} active={section==='now'} eventRevision={eventRevision} client={client} shareHandoffs={shareHandoffs} shareQueue={shareQueue.state} refreshShareHandoffs={shareQueue.refresh} deviceId={status.device_id} profileId={profileId} profiles={profiles} status={status} sourceStore={sourceStore} intentJournal={intentJournal} intentPredecessor={intentPredecessor} onPersistenceBusy={setPersistenceBusy} prepareSwitch={prepareSwitch} deadlineLocation={deadlineLocation} onDeadlineLocated={(id,hint,attempt)=>{const waiter=locationWaiter.current;if(waiter?.id===id&&waiter.attempt===attempt)waiter.finish(undefined,hint);}} onConfigureSummary={()=>setSection('settings')} onOpenSync={peers?()=>setSection('sync'):undefined} onReturnToProfile={target=>{void changeProfile(target);}} />}
  </PageShell>}/><BetaProfileDialog open={profileDialog} onOpenChange={setProfileDialog} profiles={profiles} profileId={profileId} loading={loading} disabled={persistenceBusy||switching||!switchGuardReady} creating={creating} name={name} onNameChange={setName} onCreate={create} onSelect={changeProfile} error={error} archiveActions={<BetaProfileArchiveEntry client={client.profileArchives} profileId={profileId} profileName={profileName} onProfilesChanged={refreshArchiveProfiles} />}/></>;
}

function DeviceWorkspace({ workspace, client, deviceId, profileId, profiles, status, sourceStore, intentJournal, intentPredecessor, onPersistenceBusy, prepareSwitch, active, eventRevision, deadlineLocation, onDeadlineLocated,onConfigureSummary,onOpenSync,onReturnToProfile,shareHandoffs,shareQueue,refreshShareHandoffs }: { workspace: BetaWorkspacePresentation; client: BetaClient; deviceId: string; profileId: string; profiles:BetaProfile[]; status:BetaStatus; sourceStore?: FileSourceStore; intentJournal?:LocalIntentJournal; intentPredecessor?:IntentPredecessor; onPersistenceBusy:(busy:boolean)=>void; prepareSwitch:ProfileSwitchGuardGate; active:boolean;eventRevision:number;deadlineLocation:DeadlineLocation|null;onDeadlineLocated:(id:string,hint:string,attempt:number)=>void;onConfigureSummary:()=>void;onOpenSync?:()=>void;onReturnToProfile:(profileId:string)=>void;shareHandoffs:BetaShareHandoffsClient|null;shareQueue:BetaShareHandoffQueueSnapshot;refreshShareHandoffs:()=>Promise<void> }) {
  const summaryOwner=useRef<SummaryTasksController|null>(null);
  const profileNames=useMemo(()=>new Map([...betaProfileLabels(profiles)].map(([profileId,label])=>[profileId,label.text])),[profiles]);
  const profileNameFor=useCallback((id:string)=>profileNames.get(id)??id,[profileNames]);
  const profileName=profileNameFor(profileId);
  type Owners={capture:BetaDraftController;focus:BetaTimeblockController|null;profileId:string};
  const [owners, setOwners] = useState<Owners | null>(null);
  const [correctionOwner, setCorrectionOwner] = useState<BetaRecordCorrectionOwner | null>(null);
  const [correctionOwnerError, setCorrectionOwnerError] = useState('');
  const [audioRecorder] = useState(() => new BetaAudioRecordingController());
  const activeOwners = useRef<Owners | null>(null); activeOwners.current = owners;
  const activeProfile = useRef(profileId); activeProfile.current = profileId;
  const correctionServiceScope = client.serviceScope ?? 'injected-beta-service';
  useEffect(() => {
    let active = true;
    let opened: BetaRecordCorrectionOwner | undefined;
    setCorrectionOwner(null);
    setCorrectionOwnerError('');
    void BetaRecordCorrectionOwner.open({ deviceId, serviceScope: correctionServiceScope, journal: intentJournal })
      .then(owner => {
        opened = owner;
        if (!active) { owner.close(); return; }
        setCorrectionOwner(owner);
      })
      .catch(failure => {
        if (active) setCorrectionOwnerError(errorMessage(failure));
      });
    return () => { active = false; opened?.close(); setCorrectionOwner(null); };
  }, [deviceId, correctionServiceScope, intentJournal]);
  const addRecordedFile = useCallback(async (targetProfileId: string, file: File, sourceId: string): Promise<void> => {
    const current = activeOwners.current;
    if (activeProfile.current !== targetProfileId || !current || current.profileId !== targetProfileId) {
      throw new Error(`这段原声属于档案 ${targetProfileId}；请返回该档案后重试，录音仍保留。`);
    }
    const attachmentIds = await current.capture.addFiles(targetProfileId, [file], { sourceIds: [sourceId] });
    const attachmentId = attachmentIds[0];
    if (!attachmentId) throw new Error('草稿没有返回这段原声的附件身份；原声仍保留，可以重试。');
    const entry = current.capture.snapshot().drafts[targetProfileId]?.files?.find(item => item.id === attachmentId);
    if (!entry || entry.source_id !== sourceId) throw new Error('草稿与录音来源没有建立关联；原声仍保留，可以重试。');
    const source = await current.capture.previewSource(targetProfileId, attachmentId);
    if (!source || source.size !== file.size) throw new Error('草稿尚未确认保存这段原声；原声仍保留，可以重试。');
  }, []);
  useLayoutEffect(() => { audioRecorder.setAttachmentSink(addRecordedFile); return () => audioRecorder.setAttachmentSink(null); }, [audioRecorder, addRecordedFile]);
  useEffect(() => () => audioRecorder.dispose(), [audioRecorder]);
  const [error, setError] = useState('');
  const [recoveryRequired,setRecoveryRequired]=useState(false);
  const [legacyConsent,setLegacyConsent]=useState<{client:BetaClient;deviceId:string;profileId:string}|null>(null);
  const allowLegacyImport=legacyConsent?.client===client&&legacyConsent.deviceId===deviceId&&legacyConsent.profileId===profileId;
  const [lockAttempt, setLockAttempt] = useState(0);
  const lockRequest = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let capture:BetaDraftController|undefined;let focus:BetaTimeblockController|undefined;
    let cancelled=false;let release:(()=>void)|undefined;let releaseSwitchGuard:(()=>void)|undefined;const unsubscribers:Array<()=>void>=[];
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
            if(focus&&isTauri()&&!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)){
              unsubscribers.push(observeBetaTimeblockEnd(focus, cue=>{
                void playBetaTimeblockEndSound().catch(()=>{
                  if(!cancelled)toast({title:'时间块结束提示音未能播放',description:`“${cue.name}”已结束；检查本机声音输出或应用提示音设置。`,variant:'destructive'});
                });
              }));
            }
            const switchGuard=async()=>{
              summaryOwner.current?.fenceDispatch();
              for(let attempt=0;attempt<8;attempt++){
                if(cancelled)throw new Error('当前草稿窗口已关闭');
                await Promise.all([capture!.flush(),focus?.flush(),summaryOwner.current?.flush()]);
                if(cancelled)throw new Error('当前草稿窗口已关闭');
                if(capture!.snapshot().persistenceState==='idle'&&(!focus||focus.snapshot().persistenceState==='idle'))return;
              }
              throw new Error('草稿仍在变化，请停止输入后重试');
            };
            releaseSwitchGuard=prepareSwitch.bind(switchGuard);
            const update=()=>{if(!cancelled)onPersistenceBusy(capture!.snapshot().persistenceState!=='idle'||!!focus&&focus.snapshot().persistenceState!=='idle');};
            unsubscribers.push(capture.subscribe(update));if(focus)unsubscribers.push(focus.subscribe(update));
            setOwners({capture,focus:focus??null,profileId});setError('');update();
            await new Promise<void>(resolve=>{release=resolve;});
          } finally {
            releaseSwitchGuard?.();for(const unsubscribe of unsubscribers)unsubscribe();capture?.dispose();focus?.dispose();const summary=summaryOwner.current;summary?.dispose();
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
    return () => { cancelled = true;releaseSwitchGuard?.();capture?.dispose();focus?.dispose();summaryOwner.current?.dispose();release?.();setOwners(null); };
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
  return <ProfileWorkspace workspace={workspace} key={profileId} visible={active} externalRevision={eventRevision} client={client} shareHandoffs={shareHandoffs} shareQueue={shareQueue} refreshShareHandoffs={refreshShareHandoffs} status={status} controller={owners.capture} focus={owners.focus} deviceId={deviceId} profileId={profileId} profileName={profileName} profileNameFor={profileNameFor} deadlineLocation={deadlineLocation} onDeadlineLocated={onDeadlineLocated} onConfigureSummary={onConfigureSummary} onOpenSync={onOpenSync} onReturnToProfile={onReturnToProfile} audioRecorder={audioRecorder} correctionOwner={correctionOwner} correctionOwnerError={correctionOwnerError} addRecordedFile={addRecordedFile} intentJournal={intentJournal} summaryOwner={summaryOwner}/>;
}

function isTimelinePeriodBudgetError(failure:unknown): boolean {
  if (failure instanceof BetaApiError) return failure.code === 'timeline_period_budget_exceeded';
  return !!failure && typeof failure === 'object' && 'code' in failure && failure.code === 'timeline_period_budget_exceeded';
}
function betaPeriodQuery(window:BetaPeriodWindow,query:BetaQuery,tag:string):BetaTimelinePeriodQuery {
  return {from_ms:window.from_ms,to_ms:window.to_ms,...query,...(tag?{tag}:{})};
}
async function readTimeline(client:BetaClient,profileId:string,query:BetaQuery,tag:string|undefined,typedTimelineAvailable:boolean):Promise<BetaTimelinePage>{
  if (tag) {
    if (!client.recordOrganization) throw new BetaApiError('unsupported_record_tags', '当前连接尚不支持标签筛选，请更新 Beta 服务');
    const page = await client.recordOrganization.eventsPageWithTag(profileId, query, tag);
    return { ...page, items: page.items.map(record => ({ kind: 'capture' as const, record })) };
  }
  if(client.timelinePage&&typedTimelineAvailable)return client.timelinePage(profileId,query);
  const page=await client.eventsPage(profileId,query);return{...page,items:page.items.map(record=>({kind:'capture' as const,record}))};
}
function ProfileWorkspace({ workspace, client, shareHandoffs, shareQueue, refreshShareHandoffs, status, controller, focus, deviceId,profileId,profileName,profileNameFor, visible, externalRevision, deadlineLocation, onDeadlineLocated,onConfigureSummary,onOpenSync,onReturnToProfile,audioRecorder,correctionOwner,correctionOwnerError,addRecordedFile,intentJournal,summaryOwner }: { workspace: BetaWorkspacePresentation; client: BetaClient; shareHandoffs:BetaShareHandoffsClient|null; shareQueue:BetaShareHandoffQueueSnapshot; refreshShareHandoffs:()=>Promise<void>; status:BetaStatus; controller: BetaDraftController; focus:BetaTimeblockController|null; deviceId:string;profileId: string;profileName:string;profileNameFor:(profileId:string)=>string;visible:boolean;externalRevision:number;deadlineLocation:DeadlineLocation|null;onDeadlineLocated:(id:string,hint:string,attempt:number)=>void;onConfigureSummary:()=>void;onOpenSync?:()=>void;onReturnToProfile:(profileId:string)=>void;audioRecorder:BetaAudioRecordingController;correctionOwner:BetaRecordCorrectionOwner|null;correctionOwnerError:string;addRecordedFile:(profileId:string,file:File,sourceId:string)=>Promise<void>;intentJournal?:LocalIntentJournal;summaryOwner:MutableRefObject<SummaryTasksController|null> }) {
  const drafts = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const deviceNames=useBetaDeviceNames(deviceId);
  const { layout, change: changeLayout } = workspace;
  const workspaceActive = useBetaViewActive(visible);
  const recordsActive = workspaceActive && (layout.minimal || layout.records === 'expanded');
  const rangeExportViewActive = visible && (layout.minimal || layout.records === 'expanded');
  const rangeExportSession = useUserRangeExportState(client.userRangeExports, {
    deviceId, runtimeId: status.runtime_id ?? '', profileId,
  }, rangeExportViewActive);
  const rangeExportOwner = rangeExportSession.owner;
  const rangeExportSnapshot = rangeExportSession.state;
  const rangeExportActions = rangeExportOwner && rangeExportSnapshot.supported && rangeExportSnapshot.storageReady
    ? {
      selections: rangeExportSnapshot.selections,
      onToggle: (selection: UserRangeSelection) => { void rangeExportOwner.toggleSelection(selection); },
    }
    : undefined;
  const deferredRefresh = useRef(false);
  const inputSendMode = useBetaInputSendMode();
  const [page, setPage] = useState<BetaTimelinePage | null>(null);
  const [timelineMode, setTimelineMode] = useState<'browse' | 'select-export'>('browse');
  const pageRef=useRef(page);pageRef.current=page;
  const pageOwner=useRef<BetaTimelinePageOwner>({client,profileId,query:'',tag:'',mode:'all',from_ms:null,to_ms:null});
  const tagReturnView=useRef<TagReturnView|null>(null);
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const [tagSearch, setTagSearch] = useState(''); const [tagFilter, setTagFilter] = useState('');
  const [timelinePeriod, setTimelinePeriod] = useState<BetaTimelineMode>('all');
  const [periodAnchor, setPeriodAnchor] = useState(() => Date.now());
  const periodType:BetaTimelinePeriod=timelinePeriod==='all'?'day':timelinePeriod;
  const periodWindow = useMemo(() => resolveBetaPeriodWindow(periodAnchor, periodType), [periodAnchor, periodType]);
  const periodAvailable = typeof client.timelinePeriodPage === 'function'
    && status.capabilities?.timeline_period !== false
    && (client.serviceScope === undefined || status.capabilities?.timeline_period === true);
  const periodUnavailable = client.serviceScope !== undefined && !periodAvailable;
  const typedTimelineAvailable = typeof client.timelinePage === 'function'
    && status.capabilities?.typed_timeline !== false
    && (client.serviceScope === undefined || status.capabilities?.typed_timeline === true);
  const activePeriod:BetaTimelineMode=periodAvailable?timelinePeriod:'all';
  const periodViewActive=activePeriod!=='all';
  const [searchOpen, setSearchOpen] = useState(false);
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const generation = useRef(0);
  const [historyError, setHistoryError] = useState('');
  const [periodBudgetExceeded, setPeriodBudgetExceeded] = useState(false);
  const scroll = useRef<HTMLDivElement>(null); const olderHeight = useRef<number | null>(null);
  const periodPositionRestore = useRef<{top:number;followTail:boolean}|null>(null);
  const historyContent = useRef<HTMLDivElement>(null);
  const alive = useRef(true); const now = useBetaNow(recordsActive);
  const mode=useBetaDateDisplayMode();
  const readingTop=useRef(0);const followTail=useRef(true);
  const [messageLocation,setMessageLocation]=useState<MessageLocationView|null>(null);
  const messageLocationSequence=useRef(0);
  const messageLocationFlight=useRef<MessageLocationFlight|null>(null);
  const messageLocationOrigin=useRef<MessageReadingPosition|null>(null);
  const pendingMessageLocationRestore=useRef<MessageLocationRestore|null>(null);
  const [messageLocationRestoreRevision,setMessageLocationRestoreRevision]=useState(0);
  const [messageDraftNotice,setMessageDraftNotice]=useState('');
  const [preparingPreSend,setPreparingPreSend]=useState<PreparingPreSend|null>(null);
  const completingPreSend=useRef<PreparingPreSend|null>(null);
  const [correctionTarget,setCorrectionTarget]=useState<BetaEvent|null>(null);
  const messageScope=useRef({client,profileId});messageScope.current={client,profileId};
  const [reviewsOpen,setReviewsOpen]=useState(false),[reviewTarget,setReviewTarget]=useState<SummaryArtifactRecord|null>(null),[summarySource,setSummarySource]=useState<{profileId:string;source:SummarySourceRef}|null>(null);
  const sourceReader=useMemo(()=>client.timelineEvent?(profile:string,event:string)=>client.timelineEvent!(profile,event):undefined,[client,client.timelineEvent]);
  const correctionSourceReader=useMemo(()=>client.correctionSource?(profile:string,event:string,digest:string)=>client.correctionSource!(profile,event,digest):undefined,[client,client.correctionSource]);
  useEffect(()=>{setSummarySource(null);},[profileId]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(()=>()=>{
    ++messageLocationSequence.current;
    messageLocationFlight.current?.abort.abort();
    messageLocationFlight.current=null;
  },[]);
  useLayoutEffect(()=>{
    const restore=pendingMessageLocationRestore.current;
    const element=scroll.current;
    if(!restore||!element)return;
    if(restore.kind==='latest'){
      followTail.current=true;
      element.scrollTop=element.scrollHeight;
    }else{
      followTail.current=restore.position.followTail;
      element.scrollTop=restore.position.top;
    }
    readingTop.current=element.scrollTop;
    pendingMessageLocationRestore.current=null;
  },[messageLocationRestoreRevision]);
  useLayoutEffect(()=>{
    const item=messageLocation?.state.kind==='found'?messageLocation.item:undefined;
    if(!item||!historyContent.current)return;
    const kind=item.kind;
    const target=Array.from(historyContent.current.querySelectorAll<HTMLElement>('[data-event-id][data-timeline-kind]'))
      .find(row=>row.dataset.eventId===item.record.event_id&&row.dataset.timelineKind===kind);
    if(!target)return;
    followTail.current=false;
    target.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
    readingTop.current=scroll.current?.scrollTop??readingTop.current;
  },[messageLocation]);
  useEffect(() => {
    if (visible && deadlineLocation?.profileId === profileId) changeLayout({ focus: 'expanded', minimal: false });
  }, [visible, profileId, deadlineLocation?.handoffId, deadlineLocation?.attempt]);
  useEffect(() => {
    if (recordsActive && deferredRefresh.current) { deferredRefresh.current = false; setRevision(value => value + 1); }
  }, [recordsActive]);
  useEffect(() => {
    // Visibility does not itself invalidate a retained reading window. Changed
    // facts/queries while hidden are reconciled once when the pane returns.
    if (!recordsActive) { deferredRefresh.current = true; return; }
    const mode=activePeriod;
    const from_ms=periodViewActive?periodWindow.from_ms:null;
    const to_ms=periodViewActive?periodWindow.to_ms:null;
    const same=pageOwner.current.client===client&&pageOwner.current.profileId===profileId&&pageOwner.current.query===query&&pageOwner.current.tag===tagFilter
      &&pageOwner.current.mode===mode&&pageOwner.current.from_ms===from_ms&&pageOwner.current.to_ms===to_ms;
    const previous=same&&!periodViewActive?pageRef.current:null;
    if(!same){
      // A second period can be selected while the first page is still pending.
      // Its current reading position supersedes the earlier window's snapshot.
      if(periodViewActive)periodPositionRestore.current={top:scroll.current?.scrollTop??readingTop.current,followTail:followTail.current};
      setPage(null);pageRef.current=null;
    }
    pageOwner.current={client,profileId,query,tag:tagFilter,mode,from_ms,to_ms};
    const current = ++generation.current; setLoading(true);setHistoryError('');setPeriodBudgetExceeded(false);
    const request = periodViewActive
      ? client.timelinePeriodPage!(profileId,betaPeriodQuery(periodWindow,{limit:100,...(query?{search:query}:{})},tagFilter))
      : refreshTimelineWindow(next=>readTimeline(client,profileId,next,tagFilter,typedTimelineAvailable),previous,query);
    void request.then(result => {
      if (current === generation.current) { olderHeight.current = null; setPage(result); setHistoryError('');setPeriodBudgetExceeded(false); }
    }).catch(failure => { if (current === generation.current) {setHistoryError(errorMessage(failure));setPeriodBudgetExceeded(isTimelinePeriodBudgetError(failure));} })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => { ++generation.current; };
  }, [client, profileId, query, tagFilter, revision,externalRevision,periodAvailable,activePeriod,periodViewActive,typedTimelineAvailable,periodWindow.from_ms,periodWindow.to_ms]);
  useEffect(()=>{
    if(!recordsActive||!client.summaries||loading||tagFilter)return;
    // Read-only foreground refresh, serialized by the existing timeline load.
    // Each reconciliation remains bounded to the existing 16-page window.
    const refresh=()=>{if(!document.hidden&&alive.current)setRevision(value=>value+1);};
    const timer=setTimeout(refresh,3000);document.addEventListener('visibilitychange',refresh);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',refresh);};
  },[recordsActive,client,client.summaries,profileId,loading,query,tagFilter]);
  useLayoutEffect(() => {
    const element = scroll.current; if (!element) return;
    if(!recordsActive)return;
    const restore=periodPositionRestore.current;
    if(restore&&!page)return;
    if(restore&&page){
      followTail.current=restore.followTail;
      const maximum=Math.max(0,element.scrollHeight-element.clientHeight);
      element.scrollTop=restore.followTail?element.scrollHeight:Math.min(restore.top,maximum);
      readingTop.current=restore.followTail?element.scrollTop:restore.top;
      periodPositionRestore.current=null;
      olderHeight.current=null;
      return;
    }
    if (olderHeight.current !== null) element.scrollTop += element.scrollHeight - olderHeight.current;
    else if(followTail.current)element.scrollTop = element.scrollHeight;
    else element.scrollTop=readingTop.current;
    readingTop.current=element.scrollTop;
    olderHeight.current = null;
  }, [page,recordsActive]);
  useLayoutEffect(() => {
    if (!recordsActive || !historyContent.current || typeof ResizeObserver === 'undefined') return;
    // Image decoding can change height after the timeline commit. Follow only
    // readers already at the tail; native scroll anchoring handles older text.
    const observer = new ResizeObserver(() => {
      if (followTail.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    });
    observer.observe(historyContent.current); return () => observer.disconnect();
  }, [recordsActive]);
  async function older():Promise<BetaTimelinePage|null> {
    if (!page || page.next_before === null || loading) return null;
    const current = generation.current; setLoading(true);
    try {
      const olderQuery = { before: page.next_before, through: page.highwater, limit: 100, ...(query ? { search: query } : {}) };
      const result = periodViewActive && client.timelinePeriodPage
        ? await client.timelinePeriodPage(profileId,betaPeriodQuery(periodWindow,olderQuery,tagFilter))
        : await readTimeline(client,profileId,olderQuery,tagFilter,typedTimelineAvailable);
      if (current !== generation.current) return null;
      olderHeight.current = scroll.current?.scrollHeight ?? null;
      const merged={...result,items:mergeTimelineItems(page.items,result.items)};
      pageRef.current=merged;
      setPage(merged);
      setHistoryError('');setPeriodBudgetExceeded(false);
      return merged;
    } catch (failure) { if (current === generation.current) {setHistoryError(errorMessage(failure));setPeriodBudgetExceeded(isTimelinePeriodBudgetError(failure));}return null; }
    finally { if (current === generation.current) setLoading(false); }
  }
  function tagReturnMatchesCurrentView(restore:TagReturnView):boolean {
    return restore.mode===activePeriod
      &&restore.from_ms===(periodViewActive?periodWindow.from_ms:null)
      &&restore.to_ms===(periodViewActive?periodWindow.to_ms:null);
  }
  function applyTagFilter(tag: string): void {
    if (!tagFilter && !tagReturnView.current) {
      tagReturnView.current = {
        client, profileId, query, search, tagSearch, tag: tagFilter, mode:activePeriod,
        from_ms:periodViewActive?periodWindow.from_ms:null,to_ms:periodViewActive?periodWindow.to_ms:null,
        page: pageRef.current, top: scroll.current?.scrollTop ?? readingTop.current,
        followTail: followTail.current,
      };
    }
    setTagFilter(tag);
  }
  function clearTagFilter(): void {
    const restore = tagReturnView.current;
    tagReturnView.current = null;
    setTagFilter(restore?.tag ?? '');
    setTagSearch(restore?.tagSearch ?? '');
    if (restore && restore.client === client && restore.profileId === profileId && tagReturnMatchesCurrentView(restore)) {
      setSearch(restore.search); setQuery(restore.query);
      pageRef.current = restore.page; setPage(restore.page);
      pageOwner.current = { client, profileId, query: restore.query, tag: restore.tag, mode:restore.mode, from_ms:restore.from_ms, to_ms:restore.to_ms };
      readingTop.current = restore.top; followTail.current = restore.followTail;
    }
  }
  function clearAllFilters(): void {
    const restore = tagReturnView.current;
    tagReturnView.current = null;
    setSearch(''); setQuery(''); setTagSearch(''); setTagFilter('');
    if (restore && restore.client === client && restore.profileId === profileId && !restore.query && !restore.tag && tagReturnMatchesCurrentView(restore)) {
      pageRef.current = restore.page; setPage(restore.page);
      pageOwner.current = { client, profileId, query: '', tag: '', mode:restore.mode, from_ms:restore.from_ms, to_ms:restore.to_ms };
      readingTop.current = restore.top; followTail.current = restore.followTail;
    }
  }
  async function submit(commandId?: string, fromQueuedPreSend=false) {
    if (!commandId && preparingPreSendCurrent && !fromQueuedPreSend) return;
    setError(''); setMessageDraftNotice('');
    const clipboardAttempt=!commandId?clipboardFlight.current:null;
    if(clipboardAttempt){
      const current=controller.snapshot().drafts[profileId];
      clipboardPreSendFlight.current={flight:clipboardAttempt,profileId,revision:current?.revision??0};
      setPreparingPreSend({profileId,revision:current?.revision??0,clipboardAttempt});
      return;
    }
    if (!commandId && preparing) {
      const current = controller.snapshot().drafts[profileId];
      if (!current) return;
      setPreparingPreSend({ profileId, revision: current.revision });
      return;
    }
    try {
      const receipt = commandId ? await controller.retry(commandId) : await controller.submit(profileId);
      if (receipt && alive.current) setRevision(value => value + 1);
    } catch (failure) { if (alive.current) setError(errorMessage(failure)); }
  }
  const draft = drafts.drafts[profileId];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (visible && textareaRef.current) window.dispatchEvent(new Event('beta:capture-input-ready')); }, [visible]);
  async function openMessageReference(reference:BetaMessageReferenceIdentity){
    messageLocationFlight.current?.abort.abort();
    const sequence=++messageLocationSequence.current;
    if(!messageLocationOrigin.current){
      messageLocationOrigin.current={top:scroll.current?.scrollTop??readingTop.current,followTail:followTail.current,layout:{...layout}};
    }
    try{buildBetaMessageReferenceUri(reference);}catch{
      messageLocationFlight.current=null;
      setMessageLocation({reference,state:{kind:'failed',message:'引用身份无效，未读取任何档案数据。'}});
      return;
    }
    if(reference.profileId!==profileId){
      messageLocationFlight.current=null;
      setMessageLocation({reference,state:{kind:'profile-mismatch'}});
      return;
    }
    if(!layout.minimal&&layout.records!=='expanded')changeLayout({records:'expanded'});
    const abort=new AbortController();
    const flight:MessageLocationFlight={sequence,profileId,eventId:reference.eventId,client,abort};
    messageLocationFlight.current=flight;
    setMessageLocation({reference,state:{kind:'loading'}});
    const isCurrent=()=>alive.current
      &&messageLocationSequence.current===sequence
      &&messageLocationFlight.current===flight
      &&messageScope.current.profileId===flight.profileId
      &&messageScope.current.client===flight.client
      &&reference.profileId===flight.profileId
      &&reference.eventId===flight.eventId;
    try{
      const currentPage=pageRef.current;
      const result=await locateBetaMessageReference({
        client,
        currentProfileId:profileId,
        reference,
        ...(currentPage?{highwater:currentPage.highwater,loadedItems:currentPage.items}:{}),
        signal:abort.signal,
        isCurrent,
      });
      if(!isCurrent())return;
      messageLocationFlight.current=null;
      if(result.kind==='found'){
        setMessageLocation({reference,state:{kind:'found',pagesRead:result.pagesRead,source:result.source,highwater:result.highwater},item:result.item});
      }else if(result.kind==='profile-mismatch'){
        setMessageLocation({reference,state:{kind:'profile-mismatch'}});
      }else if(result.kind==='not-found'){
        setMessageLocation({reference,state:{kind:'not-found',pagesRead:result.pagesRead,highwater:result.highwater,limitReached:result.limitReached}});
      }else if(result.kind==='failed'){
        setMessageLocation({reference,state:{kind:'failed',message:result.message}});
      }else{
        setMessageLocation({reference,state:{kind:'cancelled'}});
      }
    }catch(failure){
      if(isCurrent()){
        messageLocationFlight.current=null;
        setMessageLocation({reference,state:{kind:'failed',message:errorMessage(failure)}});
      }
    }
  }
  function cancelMessageLocation(){
    const flight=messageLocationFlight.current;
    if(!flight)return;
    ++messageLocationSequence.current;
    flight.abort.abort();
    messageLocationFlight.current=null;
    setMessageLocation(current=>current&&current.reference.profileId===flight.profileId&&current.reference.eventId===flight.eventId
      ?{...current,state:{kind:'cancelled'}}:current);
  }
  async function loadOlderAndRetryMessageReference(reference:BetaMessageReferenceIdentity){
    const sequence=messageLocationSequence.current;
    const requestedClient=client;
    const requestedProfile=profileId;
    const loaded=await older();
    if(!loaded||!alive.current||messageLocationSequence.current!==sequence
      ||messageScope.current.client!==requestedClient||messageScope.current.profileId!==requestedProfile
      ||reference.profileId!==requestedProfile||reference.eventId!==messageLocation?.reference.eventId)return;
    void openMessageReference(reference);
  }
  function closeMessageLocation(destination:'reading'|'latest'){
    ++messageLocationSequence.current;
    messageLocationFlight.current?.abort.abort();
    messageLocationFlight.current=null;
    const position=messageLocationOrigin.current??{top:scroll.current?.scrollTop??readingTop.current,followTail:followTail.current,layout:{...layout}};
    const restoredLayout=destination==='latest'?{...position.layout,minimal:false,records:'expanded' as const}:position.layout;
    if(restoredLayout.focus!==layout.focus||restoredLayout.records!==layout.records||restoredLayout.minimal!==layout.minimal)changeLayout(restoredLayout);
    pendingMessageLocationRestore.current=destination==='latest'?{kind:'latest'}:{kind:'reading',position};
    messageLocationOrigin.current=null;
    setMessageLocation(null);
    setMessageLocationRestoreRevision(value=>value+1);
  }
  function quoteMessage(source:BetaMessageReferenceSource){
    const currentText=controller.snapshot().drafts[profileId]?.text??'';
    const textarea=textareaRef.current;
    const editing=!!textarea&&document.activeElement===textarea;
    const selectionStart=editing?Math.min(textarea!.selectionStart,currentText.length):currentText.length;
    const selectionEnd=editing?Math.min(textarea!.selectionEnd,currentText.length):currentText.length;
    try{
      const inserted=insertBetaMessageReference(currentText,source);
      if(!inserted.inserted){setMessageDraftNotice('这条消息已在当前草稿中；可在引用列表中移除。');return;}
      controller.setDraft(profileId,inserted.text);
      const insertedRevision=controller.snapshot().drafts[profileId]?.revision;
      setMessageDraftNotice('引用已加入当前草稿');
      requestAnimationFrame(()=>{
        const latest=controller.snapshot().drafts[profileId];
        if(!alive.current||!latest||latest.text!==inserted.text||latest.revision!==insertedRevision||!textareaRef.current)return;
        textareaRef.current.focus({preventScroll:true});
        const mapDraftOffset=(offset:number)=>inserted.referencePrefixLength+Math.max(0,offset-inserted.removedLeadingWhitespace);
        textareaRef.current.setSelectionRange(mapDraftOffset(selectionStart),mapDraftOffset(selectionEnd));
        resizeNowInputTextarea(textareaRef.current);
      });
    }catch(failure){setError(errorMessage(failure));}
  }
  function removeDraftReference(reference:BetaMessageReferenceIdentity){
    const currentText=controller.snapshot().drafts[profileId]?.text??'';
    try{
      const next=removeBetaMessageReference(currentText,reference);
      if(next!==currentText)controller.setDraft(profileId,next);
      setMessageDraftNotice('已从当前草稿移除引用');
    }catch(failure){setError(errorMessage(failure));}
  }
  function messageReferenceSourceLabel(reference:BetaMessageReference):string|undefined{
    if(reference.profileId!==profileId)return undefined;
    const matches=(item:BetaTimelineItem)=>item.record.profile_id===reference.profileId&&item.record.event_id===reference.eventId;
    const source=pageRef.current?.items.find(matches)??(messageLocation?.item&&matches(messageLocation.item)?messageLocation.item:undefined);
    if(!source)return undefined;
    if(source.kind==='capture')return deviceNames.label(source.record.device_id);
    if(source.kind==='timeblock')return '外心档案内系统时间块';
    if(source.kind==='summary/1')return '外心档案内 AI 总结';
    return '外心档案内外部 Agent 回顾';
  }
  const fileInput = useRef<HTMLInputElement>(null);
  const reselectTarget = useRef<string | null>(null);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  const clipboardFlight = useRef<object | null>(null);
  const clipboardPreSendFlight = useRef<QueuedClipboardPreSend|null>(null);
  const [pasteFeedback, setPasteFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const pasteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clipboardFlight.current = null; clearTimeout(pasteTimer.current); }, []);
  function reportPaste(result: 'success' | 'error') {
    setPasteFeedback(result); clearTimeout(pasteTimer.current);
    pasteTimer.current = setTimeout(() => { if (alive.current) setPasteFeedback('idle'); }, 1500);
  }
  function insertComposerText(text: string) {
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
  async function pasteClipboard(read: () => Promise<{ files: AttachmentSelection[]; text: string }>) {
    if (clipboardFlight.current) return;
    const flight = {}; clipboardFlight.current = flight; setClipboardBusy(true); setError('');
    const revision = controller.snapshot().drafts[profileId]?.revision ?? 0;
    try {
      const result = await read();
      if (!alive.current || clipboardFlight.current !== flight) return;
      if (!result.files.length && !result.text) throw new Error('剪贴板没有可粘贴的文件或文字');
      // A system permission dialog can outlive edits or a profile switch. Never
      // replace newer input with text captured for the earlier draft.
      if (result.text && revision !== (controller.snapshot().drafts[profileId]?.revision ?? 0)) throw new Error('草稿已变化，请再次粘贴；现有输入已保留');
      if (result.files.length && !client.originals) throw new Error('当前服务尚不支持附件原件');
      insertComposerText(result.text);
      if (result.files.length) await controller.addFiles(profileId, result.files);
      if (alive.current && clipboardFlight.current === flight) {
        reportPaste('success');
        const queued=clipboardPreSendFlight.current;
        if(queued?.flight===flight){
          clipboardPreSendFlight.current=null;
          const expectedRevision=queued.revision+(result.text?1:0)+(result.files.length?1:0);
          const latest=controller.snapshot().drafts[queued.profileId];
          if(queued.profileId!==profileId||latest?.revision!==expectedRevision){
            setPreparingPreSend(current=>current?.profileId===queued.profileId&&current.clipboardAttempt===flight?null:current);
            setMessageDraftNotice('预发送已取消：草稿在剪贴板读取期间变化，本次内容尚未提交。');
          }else{
            setPreparingPreSend(current=>current?.profileId===profileId&&current.clipboardAttempt===flight
              ?{profileId,revision:expectedRevision}:current);
          }
        }
      }
    } catch (failure) {
      if (alive.current && clipboardFlight.current === flight) {
        setError(errorMessage(failure)); reportPaste('error');
        if(clipboardPreSendFlight.current?.flight===flight){
          clipboardPreSendFlight.current=null;
          setPreparingPreSend(current=>current?.clipboardAttempt===flight?null:current);
          setMessageDraftNotice('预发送已取消：剪贴板读取未完成，本次内容尚未提交；当前草稿保留。');
        }
      }
    } finally {
      if (clipboardFlight.current === flight) { clipboardFlight.current = null; if (alive.current) setClipboardBusy(false); }
    }
  }
  useEffect(() => { void controller.resumeFiles(profileId); }, [controller, profileId]);
  useLayoutEffect(() => resizeNowInputTextarea(textareaRef.current), [draft?.text]);
  const pending = drafts.pending.filter(item => item.command.profile_id === profileId && item.state !== 'committed');
  const busy = pending.some(item => item.state === 'pending' && item.draft_revision === draft?.revision);
  const preparing = draft?.files?.some(file => !file.original || file.state === 'preparing') ?? false;
  const preparingPreSendCurrent = preparingPreSend?.profileId === profileId ? preparingPreSend : null;
  const attachmentReadiness = draft?.files?.map(file => `${file.id}:${Boolean(file.original)}:${file.state}`).join('|') ?? '';
  useEffect(() => {
    if (!preparingPreSendCurrent) { completingPreSend.current=null; return; }
    if(completingPreSend.current===preparingPreSendCurrent)return;
    if(preparingPreSendCurrent.clipboardAttempt)return;
    const currentDraft=controller.snapshot().drafts[profileId];
    if (!currentDraft || currentDraft.revision !== preparingPreSendCurrent.revision) {
      if(clipboardPreSendFlight.current?.flight===preparingPreSendCurrent.clipboardAttempt)clipboardPreSendFlight.current=null;
      setPreparingPreSend(null);
      setMessageDraftNotice('预发送已取消：当前草稿内容或附件已变化，当前输入未发送。');
      return;
    }
    const files = currentDraft.files ?? [];
    if (files.some(file => file.state === 'failed' || file.state === 'source_missing')) {
      if(clipboardPreSendFlight.current?.flight===preparingPreSendCurrent.clipboardAttempt)clipboardPreSendFlight.current=null;
      setPreparingPreSend(null);
      setMessageDraftNotice('预发送已取消：附件尚未就绪，当前输入未发送；请重试或移除附件后再发送。');
      return;
    }
    if (files.some(file => !file.original || file.state === 'preparing')) return;
    if(clipboardPreSendFlight.current?.flight===preparingPreSendCurrent.clipboardAttempt)clipboardPreSendFlight.current=null;
    completingPreSend.current=preparingPreSendCurrent;
    setPreparingPreSend(null);
    void submit(undefined,true);
  }, [controller, profileId, preparingPreSendCurrent, draft?.revision, attachmentReadiness]);
  useEffect(()=>{
    if(!preparingPreSend||preparingPreSend.profileId===profileId)return;
    if(clipboardPreSendFlight.current?.flight===preparingPreSend.clipboardAttempt)clipboardPreSendFlight.current=null;
    setPreparingPreSend(null);
    setMessageDraftNotice('预发送已取消：已切换档案，本次内容尚未提交。');
  },[profileId,preparingPreSend]);
  const attachmentsBusy=workspaceActive&&(
    !!draft?.files?.some(file=>file.state==='preparing'||file.state==='uploading')
    ||pending.some(item=>item.files?.some(file=>file.state==='preparing'||file.state==='uploading'))
  );
  const [attachmentNow,setAttachmentNow]=useState(Date.now);
  useEffect(()=>{if(!attachmentsBusy)return;setAttachmentNow(Date.now());const timer=setInterval(()=>setAttachmentNow(Date.now()),1000);return()=>clearInterval(timer);},[attachmentsBusy]);
  function restoreComposerFocus(){
    requestAnimationFrame(()=>{
      if(!alive.current||!workspaceActive||!visible)return;
      const element=textareaRef.current;
      if(!element?.isConnected)return;
      const active=document.activeElement as HTMLElement|null;
      const composer=element.closest('[data-testid="new-now-input-row"]');
      if(active&&active!==document.body&&active!==element&&!composer?.contains(active))return;
      element.focus({preventScroll:true});
      const end=element.value.length;
      element.setSelectionRange(end,end);
      resizeNowInputTextarea(element);
    });
  }
  function insertComposerNewline(){
    try{insertComposerText('\n');}
    catch(failure){setError(errorMessage(failure));}
  }
  function submitAndRestoreComposerFocus(){
    const blocked=clipboardFlight.current||(!draft?.text.trim()&&!draft?.files?.length)||busy||clipboardBusy||!!preparingPreSendCurrent||!!drafts.persistenceError;
    void submit();
    if(!blocked)restoreComposerFocus();
  }
  const currentCommitted = draft?.text === '' && drafts.confirmed.some(item => item.receipt.profile_id === profileId && item.draft_revision + 1 === draft.revision);
  const hasDraftContent = !!draft?.text.trim() || !!draft?.files?.length || !!draft?.tags?.length;
  const canQueueClipboardPreSend=!!clipboardFlight.current&&!busy&&!preparingPreSendCurrent&&!drafts.persistenceError;
  const captureStatus = drafts.persistenceState === 'failed' ? 'error' : clipboardBusy || drafts.persistenceState === 'pending' || pending.length || preparingPreSendCurrent ? 'pending' : currentCommitted ? 'committed' : hasDraftContent ? 'draft' : 'idle';
  const dropRoot=useRef<HTMLDivElement>(null);
  const mountDroppedFiles=useCallback(async(files:AttachmentSelection[])=>{if(!client.originals)throw new Error('当前服务尚不支持附件原件');await controller.addFiles(profileId,files);},[client,controller,profileId]);
  const dropError=useCallback((failure:unknown)=>{if(alive.current)setError(errorMessage(failure));},[]);
  const nativeDropOver=useNativeAttachmentDrop({root:dropRoot,active:workspaceActive,onFiles:mountDroppedFiles,onError:dropError});
  async function chooseFiles(target:string|null=null){
    reselectTarget.current=target;
    if(isTauri()&&!/Android|iPhone|iPad/i.test(navigator.userAgent)){
      try{const files=await pickNativeFiles(target===null);if(!alive.current||!files.length)return;reselectTarget.current=null;if(target)await controller.reselectFile(profileId,target,files[0]);else await controller.addFiles(profileId,files);}
      catch(failure){if(alive.current)setError(errorMessage(failure));}
    }else if(fileInput.current){fileInput.current.multiple=target===null;fileInput.current.click();}
  }
  function renderTimelineItem(item: BetaTimelineItem, revision: number, located=false) {
    return <BetaTimelineItemRow key={item.record.event_id} item={item} client={client}
      deviceId={deviceId} revision={revision} now={now} dateMode={mode} recordsActive={recordsActive}
      deviceLabel={deviceNames.label} onQuote={quoteMessage} onOpenReference={openMessageReference} rangeExport={rangeExportActions}
      exportMode={timelineMode === 'select-export'}
      located={located}
      onCorrect={client.recordOrganization?record=>setCorrectionTarget(record):undefined}
      sourceLabel={messageReferenceSourceLabel} onInspectSummary={record=>{setReviewTarget(record);setReviewsOpen(true);}}
      onOpenSource={sourceReader||correctionSourceReader?source=>setSummarySource({profileId,source}):undefined} />;
  }
  const locatedTimelineItem=messageLocation?.state.kind==='found'?messageLocation.item:null;
  const timelineItems=page?[...page.items]:[];
  if(locatedTimelineItem&&!timelineItems.some(item=>item.record.event_id===locatedTimelineItem.record.event_id&&item.kind===locatedTimelineItem.kind)){
    timelineItems.push(locatedTimelineItem);
  }
  timelineItems.sort((left,right)=>right.record.local_seq-left.record.local_seq);
  const timelineRevision=page?.highwater??(messageLocation?.state.kind==='found'?messageLocation.state.highwater??0:0);
  const messageLocationBoundary=messageLocation?<BetaMessageLocationBoundary
    state={messageLocation.state}
    onCancel={messageLocation.state.kind==='loading'?cancelMessageLocation:undefined}
    onRetry={()=>{void openMessageReference(messageLocation.reference);}}
    onLoadOlderAndRetry={messageLocation.state.kind==='not-found'&&messageLocation.state.limitReached&&page!==null&&page.next_before!==null&&!loading
      ?()=>{void loadOlderAndRetryMessageReference(messageLocation.reference);}:undefined}
    onReturnToReadingPosition={()=>closeMessageLocation('reading')}
    onReturnToLatest={()=>closeMessageLocation('latest')}
  />:null;
  return <div ref={dropRoot} data-beta-workspace className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
    onDragOver={event=>{if(workspaceActive&&Array.from(event.dataTransfer.types).includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=client.originals?'copy':'none';}}}
    onDrop={event=>{
      const files=clipboardImageFiles(event.dataTransfer);if(!files.length)return;
      event.preventDefault();event.stopPropagation();
      if(!workspaceActive)return;
      if(!client.originals){setError('当前服务尚不支持附件原件');return;}
      void controller.addFiles(profileId,files).catch(failure=>{if(alive.current)setError(errorMessage(failure));});
    }}>
    {nativeDropOver&&<div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-accent bg-page/90 text-sm font-medium text-brand-accent dark:bg-page-dark/90" role="status">松开以挂载附件 · 不会自动发送</div>}
    <div data-beta-workspace-content className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
    <MainOverlayBridge profileId={profileId} onCommitted={()=>setRevision(value=>value+1)}/>
    {focus&&<BetaWorkspacePane kind="focus" chrome={layout.focus!=='expanded'} state={layout.minimal ? 'hidden' : layout.focus} onToggle={()=>changeLayout({focus:layout.focus==='collapsed'?'expanded':'collapsed'})}><div><BetaFocusTimer controller={focus} client={client} profileId={profileId} visible={visible&&!layout.minimal&&layout.focus==='expanded'} onCollapse={()=>changeLayout({focus:'collapsed'})}
      onCommitted={()=>setRevision(value=>value+1)} onOpenSync={onOpenSync}
      handoffTarget={visible&&layout.focus==='expanded'&&deadlineLocation?.profileId===profileId?deadlineLocation:undefined}
      onHandoffReady={(id,hint,attempt)=>{
        const region=scroll.current?.closest('[data-beta-workspace]')?.querySelector<HTMLElement>('section[aria-label="时间块"]');
        if(region){
          region.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});
          onDeadlineLocated(id,hint,attempt);
        }
      }}/></div></BetaWorkspacePane>
    }
    {messageLocation?.state.kind==='profile-mismatch'&&messageLocationBoundary}
    <BetaWorkspacePane kind="records" state={layout.minimal ? 'expanded' : layout.records} chrome={!layout.minimal&&layout.records!=='expanded'} onToggle={()=>changeLayout({records:layout.records==='collapsed'?'expanded':'collapsed'})}>
    {rangeExportOwner && <BetaUserRangeExportControls owner={rangeExportOwner} state={rangeExportSnapshot}
      mode={timelineMode} onModeChange={setTimelineMode} profileNameFor={profileNameFor} />}
    {!periodViewActive&&!typedTimelineAvailable&&<p className="px-5 py-1 text-[11px] text-muted">此连接仅提供兼容记录历史，尚未提供完整时间线</p>}
    {periodUnavailable&&<p role="status" className="px-5 py-1 text-[11px] text-muted">{client.serviceScope==='tauri-native-beta-v1'?'此本机 Beta 版本尚不支持日／周／月范围浏览；现有历史仍可阅读。更新应用后可用。':'当前 Beta 服务尚不支持日／周／月范围浏览；现有历史仍可阅读。请更新服务后重试。'}</p>}
    {!layout.minimal&&<BetaHistoryToolbar onCollapse={()=>changeLayout({records:'collapsed'})} searchOpen={searchOpen||!!query||!!tagFilter} onSearch={()=>setSearchOpen(value=>!value)} onRefresh={()=>setRevision(value=>value+1)} onReview={()=>{setReviewTarget(null);setReviewsOpen(true);}}/>}
    {periodAvailable&&<div className="flex flex-wrap items-center gap-2 border-b border-border-page px-3 py-2">
      <div role="group" aria-label="浏览周期" className="flex items-center gap-1">
        <Button type="button" size="sm" variant={activePeriod==='all'?'secondary':'ghost'} aria-pressed={activePeriod==='all'} className="focus-visible:ring-1" onClick={()=>setTimelinePeriod('all')}>全部</Button>
        <Button type="button" size="sm" variant={activePeriod==='day'?'secondary':'ghost'} aria-pressed={activePeriod==='day'} className="focus-visible:ring-1" onClick={()=>setTimelinePeriod('day')}>日</Button>
        <Button type="button" size="sm" variant={activePeriod==='week'?'secondary':'ghost'} aria-pressed={activePeriod==='week'} className="focus-visible:ring-1" onClick={()=>setTimelinePeriod('week')}>周</Button>
        <Button type="button" size="sm" variant={activePeriod==='month'?'secondary':'ghost'} aria-pressed={activePeriod==='month'} className="focus-visible:ring-1" onClick={()=>setTimelinePeriod('month')}>月</Button>
      </div>
      {periodViewActive&&<>
        <Button type="button" size="sm" variant="ghost" aria-label="上一个周期" onClick={()=>setPeriodAnchor(anchor=>shiftBetaPeriodAnchor(anchor,periodType,-1))}><span aria-hidden="true">‹</span></Button>
        <Button type="button" size="sm" variant="ghost" aria-label="下一个周期" onClick={()=>setPeriodAnchor(anchor=>shiftBetaPeriodAnchor(anchor,periodType,1))}><span aria-hidden="true">›</span></Button>
        <span aria-live="polite" className="text-xs text-secondary">{formatBetaPeriodWindow(periodWindow,periodType)}</span>
      </>}
    </div>}
    {periodViewActive&&<p className="px-5 py-1 text-[11px] text-muted">时间块按生效时间归入范围，列表日期仍显示其记录时间。</p>}
    {layout.minimal&&<div className="flex items-center gap-2 px-3 py-1">
      <Button size="sm" variant={searchOpen||!!query||!!tagFilter?'secondary':'ghost'} aria-expanded={searchOpen||!!query||!!tagFilter} onClick={()=>setSearchOpen(value=>!value)}>检索记录</Button>
      {(query||tagFilter)&&<Button size="sm" variant="ghost" onClick={clearAllFilters}>清除筛选</Button>}
    </div>}
    <div hidden={!searchOpen&&!query&&!tagFilter} className={!searchOpen&&!query&&!tagFilter ? 'hidden' : 'flex flex-wrap gap-2 border-b border-border-page px-3 py-2'}>
      <form className="flex min-w-0 flex-1 basis-full gap-2 sm:basis-0" onSubmit={event => { event.preventDefault(); setQuery(search); }}>
        <Input aria-label="搜索记录" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索文字" />
        <Button variant="outline" type="submit">搜索</Button>
      </form>
      <BetaRecordTagFilter value={tagSearch} activeTag={tagFilter} onValueChange={setTagSearch}
        onApply={tag=>{applyTagFilter(tag);setSearchOpen(true);}}
        onClear={clearTagFilter} />
      {(query||tagFilter)&&<Button size="sm" variant="ghost" onClick={clearAllFilters}>清除筛选</Button>}
      <FieldSelect label="日期显示" value={mode} onValueChange={next => {
        const value = next as EventDateDisplayMode;
        try { setBetaDateDisplayMode(value); } catch { setError('日期偏好暂时无法保存'); }
      }} options={[{value:'compact',label:'简略日期'},{value:'full',label:'完整日期'},{value:'weekday',label:'星期日期'}]}/>
    </div>
    {historyError && <p role="alert" className="shrink-0 px-5 py-2 text-sm text-destructive">{historyError}</p>}
    {periodBudgetExceeded&&periodViewActive&&<div className="flex flex-wrap items-center gap-2 px-5 pb-2 text-xs text-muted">
      {activePeriod==='month'&&<Button size="sm" variant="outline" onClick={()=>setTimelinePeriod('week')}>缩小到周范围</Button>}
      {activePeriod==='week'&&<Button size="sm" variant="outline" onClick={()=>setTimelinePeriod('day')}>缩小到日范围</Button>}
      <Button size="sm" variant="outline" onClick={()=>setTimelinePeriod('all')}>返回全部历史</Button>
    </div>}
    {messageLocation&&messageLocation.state.kind!=='profile-mismatch'&&messageLocationBoundary}
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4" aria-label="记录历史" aria-busy={loading} onScroll={event=>{if(!recordsActive)return;const element=event.currentTarget;readingTop.current=element.scrollTop;followTail.current=element.scrollHeight-element.clientHeight-element.scrollTop<64;}}>
      {page?.next_before !== null && page && <div className="mb-4 text-center"><Button variant="ghost" disabled={loading} onClick={() => void older()}>加载更早记录</Button></div>}
      {loading && !page && <p role="status" className="text-center text-sm text-muted">正在读取…</p>}
      {page?.items.length === 0 && <p className="py-8 text-center text-sm text-muted">{periodViewActive?(query||tagFilter?'此时间范围没有匹配记录':'此时间范围没有记录'):(query||tagFilter?'没有匹配记录':'还没有记录')}</p>}
      {periodViewActive&&!!tagFilter&&<p className="pb-3 text-center text-[11px] text-muted">标签仅筛选记录；时间块与回顾仍按时间范围显示</p>}
      <div ref={historyContent} className="space-y-4">{timelineItems.reverse().map(item=>
        renderTimelineItem(item,timelineRevision,locatedTimelineItem?.record.event_id===item.record.event_id&&locatedTimelineItem.kind===item.kind)
      )}</div>
    </div>
    </BetaWorkspacePane>
    {!layout.minimal&&layout.records!=='expanded'&&<div className="flex min-h-0 flex-1 items-center justify-center px-5 py-6">{layout.records==='hidden'&&(!focus||layout.focus==='hidden')&&<p className="text-center text-sm text-muted">工作区已收起，仍可记录想法。上方可恢复视图。</p>}</div>}
    </div>
    {error && <p role="alert" className="shrink-0 px-5 py-2 text-sm text-destructive">{error}</p>}
    <BetaRecordCorrectionDialog open={!!correctionTarget} target={correctionTarget} profileId={profileId} client={client}
      highwater={page?.highwater} now={now} dateMode={mode} owner={correctionOwner} ownerError={correctionOwnerError} onOpenChange={open=>{if(!open)setCorrectionTarget(null);}}
      onChanged={()=>{if(alive.current)setRevision(value=>value+1);}} />
    <BetaSummaryTasksPanel open={reviewsOpen} onOpenChange={setReviewsOpen} client={client} deviceId={deviceId} profileId={profileId} target={reviewTarget} revision={page?.highwater??0} now={now} dateMode={mode} onConfigure={onConfigureSummary} onChanged={()=>{if(alive.current)setRevision(value=>value+1);}} onOpenSource={sourceReader||correctionSourceReader?source=>setSummarySource({profileId,source}):undefined} intentJournal={intentJournal} onOwner={owner=>{summaryOwner.current=owner;}}/>
    <BetaSummarySourceDialog profileId={profileId} sourceProfileId={summarySource?.profileId??null} source={summarySource?.source??null} reader={sourceReader} correctionReader={correctionSourceReader} onClose={()=>setSummarySource(null)} now={now} dateMode={mode}/>
    <NowInputRowView
      value={draft?.text ?? ''}
      placeholder="记录此刻的想法…"
      inputRef={textareaRef}
      textareaLabel="记录当下"
      voiceControl={client.originals ? <BetaAudioRecorder controller={audioRecorder} profileId={profileId} profileName={profileName} profileNameFor={profileNameFor} onAddFile={addRecordedFile} onReturnToProfile={onReturnToProfile}/> : false}
      sendLabel={preparingPreSendCurrent?'预发送已排队':clipboardBusy?'预发送':'发送'}
      onValueChange={(next, element) => { try {
        const cancelledPreparingPreSend=preparingPreSendCurrent;
        if(cancelledPreparingPreSend){
          if(completingPreSend.current===cancelledPreparingPreSend)completingPreSend.current=null;
          if(clipboardPreSendFlight.current?.flight===cancelledPreparingPreSend.clipboardAttempt)clipboardPreSendFlight.current=null;
          setPreparingPreSend(null);
        }
        const cancelledPreSend = controller.setDraft(profileId, next);
        const notice = '上一条预发送已取消；原文与附件已恢复到当前草稿，尚未提交。';
        setMessageDraftNotice(cancelledPreSend?notice:cancelledPreparingPreSend?'预发送已取消：当前输入未发送；可以继续编辑当前草稿。':'');
        resizeNowInputTextarea(element);
      } catch (failure) { setError(errorMessage(failure)); } }}
      onKeyDown={event => {
        if(event.nativeEvent.isComposing)return;
        if(shouldSubmitOnEnter(inputSendMode,event)){event.preventDefault();submitAndRestoreComposerFocus();return;}
        if(inputSendMode==='enter-send'&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey){
          event.preventDefault();insertComposerNewline();
        }
      }}
      onPaste={event => {
        const files = clipboardImageFiles(event.clipboardData);
        if (!files.length) {if(isTauri()){event.preventDefault();void pasteClipboard(readBetaClipboard);}return;}
        event.preventDefault();
        if (clipboardFlight.current) { setError('正在读取剪贴板，请稍候再试'); return; }
        const text = event.clipboardData.getData('text/plain');
        void pasteClipboard(async () => ({ files, text }));
      }}
      onPasteClick={() => pasteClipboard(readBetaClipboard)}
      pasteFeedback={pasteFeedback}
      pasteFailureLabel="未粘贴"
      onSend={submitAndRestoreComposerFocus}
      onAttachmentClick={client.originals ? () => {void chooseFiles();} : undefined}
      sendDisabled={((!draft?.text.trim() && !draft?.files?.length) && !canQueueClipboardPreSend) || busy || (clipboardBusy&&!canQueueClipboardPreSend) || !!preparingPreSendCurrent || !!drafts.persistenceError}
      beforeControls={<>
       {shareHandoffs&&(shareQueue.handoffs.length>0||shareQueue.loading||shareQueue.error)&&<BetaShareHandoffInbox
         client={shareHandoffs} queue={{...shareQueue,refresh:refreshShareHandoffs}} controller={controller} profileId={profileId} profileName={profileName} profileNameFor={profileNameFor} onSwitchProfile={onReturnToProfile}/>
       }
      <BetaCaptureTagsEditor tags={draft?.tags??[]} onChange={tags=>controller.setTags(profileId,tags)}/>
      <input ref={fileInput} type="file" multiple hidden aria-label="选择原件" onChange={event => {
        const selected = Array.from(event.target.files ?? []); event.target.value = '';
        const target = reselectTarget.current; reselectTarget.current = null;
        if (!selected.length) return;
        const operation = target ? controller.reselectFile(profileId, target, selected[0]) : controller.addFiles(profileId, selected);
        void operation.catch(failure => { if (alive.current) setError(errorMessage(failure)); });
      }} />
      <BetaMessageReferenceDraft value={draft?.text??''} onOpen={reference=>{void openMessageReference(reference);}} onRemove={removeDraftReference} sourceLabel={messageReferenceSourceLabel}/>
      {preparingPreSendCurrent&&<div role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border-card px-3 py-2 text-xs text-secondary">
        <span className="min-w-0 flex-1">预发送已排队；等待{preparingPreSendCurrent.clipboardAttempt?'剪贴板读取和附件校验':'附件本机校验'}完成。继续输入会取消这次预发送，当前内容尚未进入发送。</span>
        <Button type="button" size="sm" variant="outline" onClick={() => {if(completingPreSend.current===preparingPreSendCurrent)completingPreSend.current=null;if(clipboardPreSendFlight.current?.flight===preparingPreSendCurrent.clipboardAttempt)clipboardPreSendFlight.current=null;setPreparingPreSend(null);setMessageDraftNotice('预发送已取消；当前输入和附件保留，尚未发送。');}}>取消预发送</Button>
      </div>}
      {messageDraftNotice&&<p role="status" className="mb-2 text-xs text-secondary">{messageDraftNotice}</p>}
      {!!draft?.files?.length && <div className="mb-2 flex max-h-none flex-col gap-2 overflow-visible sm:max-h-[28dvh] sm:overflow-y-auto sm:overscroll-contain" aria-label="原件队列">
        {draft.files.length>1&&<p role="status" className="text-[11px] text-secondary">附件 {draft.files.filter(file=>file.state==='verified').length}/{draft.files.length} 件已校验；任何附件未就绪时，记录都不会提交。</p>}
        {draft.files.map(file => <div key={file.id} className="flex items-center gap-2 rounded-2xl border border-[#E7E5E4] bg-white/90 px-3 py-2 shadow-sm dark:border-[#292524] dark:bg-[#1C1917]">
          {file.original && <BetaImagePreview identity={`${deviceId}:${profileId}:${file.id}:${file.original.sha256}`} sourceScope={client} visible={workspaceActive} fileName={file.file_name} mediaType={file.media_type} byteLength={file.byte_length} load={() => controller.previewSource(profileId, file.id)} thumbnail />}
          {(!file.original || !file.media_type.startsWith('image/')) && <FileText size={16} className="shrink-0 text-[#C75B3A] dark:text-[#FDBA74]" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-stone-700 dark:text-stone-100">{file.file_name}</p>
            <p className="text-[10px] text-stone-500 dark:text-[#A8A29E]">{formatBytes(file.byte_length)} · {file.state === 'verified' ? '附件已校验就绪 · 记录尚未提交' : file.state === 'preparing' ? '正在复制并校验本机源…' : file.state === 'uploading' ? `正在暂存 ${formatBytes(file.next_offset)}` : file.state === 'source_missing' ? '本机源缺失，请重选' : '暂存未完成'}</p>
            {file.message && <p role={file.state==='preparing'||file.state==='uploading'?'status':'alert'} className={file.state==='preparing'||file.state==='uploading'?'text-xs text-secondary':'text-xs text-destructive'}>{file.message}</p>}
            <BetaAttachmentProgress name={file.file_name} progress={drafts.fileProgress[file.id]} now={attachmentNow} active={workspaceActive&&(file.state==='preparing'||file.state==='uploading')}/>
          </div>
          {(file.state === 'failed' || file.state === 'source_missing') && <>
            {(file.original||controller.hasRetainedFileSource(profileId,file.id)) && <Button size="sm" variant="ghost" onClick={() => {
              void controller.resumeFile(profileId, file.id).catch(failure => { if (alive.current) setError(errorMessage(failure)); });
            }}>重试上传</Button>}
            <Button size="sm" variant="ghost" onClick={() => {void chooseFiles(file.id);}}>重新选择</Button>
          </>}
          <Tooltip content={pending.some(item=>item.files?.some(selected=>selected.id===file.id))?'仅从下一份草稿移除；已提交的固定整组不受影响':file.state==='preparing'||file.state==='uploading'?'取消准备并移除附件（当前步骤完成后停止）':'移除附件'}><Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full text-muted [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            aria-label={`移除原件：${file.file_name}`}  onClick={() => { try { controller.removeFile(profileId, file.id); } catch (failure) { setError(errorMessage(failure)); } }}><X size={14} /></Button></Tooltip>
        </div>)}
      </div>}
      {drafts.persistenceError && <p role="alert" className="mb-2 text-xs text-destructive">{drafts.persistenceError}</p>}
      {drafts.persistenceState==='failed'&&<Button variant="outline" size="sm" className="mb-2" onClick={()=>{void controller.flush().catch(failure=>setError(errorMessage(failure)));}}>重试记录草稿暂存</Button>}
      {pending.map(item => <div key={item.command.command_id} className="mb-2 flex items-start gap-2 text-xs text-secondary">
        <div className="min-w-0 flex-1"><p role={item.state==='pending'?'status':'alert'}>{item.state === 'pending' ? item.capture_attempted === false ? item.files?.some(file=>file.state!=='verified') ? '已在本机排队；等待附件暂存完成，事件记录尚未提交' : '已在本机排队；事件记录尚未提交' : '正在发送事件记录并等待回执确认' : item.state === 'failed' ? item.capture_attempted===false&&item.error_code==='draft_cache_unavailable'?'本机命令暂存未确认，记录尚未发送':item.capture_attempted===false?'附件尚未全部就绪，记录未提交':'记录提交结果待查证' : `结果待确认${item.error_code ? `（${item.error_code}）` : ''}`}{item.message ? `：${item.message}` : ''}</p><p className="truncate">{item.command.text}</p>
        {item.files?.length ? <div className="mt-1 space-y-1" role="group" aria-label="待发送附件进度">{item.files.map(file=><div key={file.id} className="min-w-0">
          <p className="truncate text-[10px]">{file.file_name} · {file.state==='verified'?'附件已暂存，等待事件提交':file.state==='preparing'?'正在准备本机副本':file.state==='uploading'?`正在暂存 ${formatBytes(file.next_offset)} / ${formatBytes(file.byte_length)}`:file.state==='source_missing'?'本机源缺失':file.message??'暂存未完成'}</p>
          <BetaAttachmentProgress name={file.file_name} progress={drafts.fileProgress[file.id]} now={attachmentNow} active={workspaceActive&&(file.state==='preparing'||file.state==='uploading')}/>
        </div>)}</div> : !!item.command.originals?.length && <p className="truncate">{item.command.originals.map(file => file.file_name).join('、')}</p>}
        <p className="text-[10px] text-muted">{item.capture_attempted === false
          ? '尚未提交；继续输入会取消这次预发送，并把原文和附件恢复到当前草稿。'
          : '已进入发送或回执查证；继续输入会形成下一条草稿，不会改写原命令。'}</p></div>
        {item.state !== 'pending' && <Button variant="outline" size="sm" onClick={() => void submit(item.command.command_id)}>查证并重试</Button>}
      </div>)}
      </>}
      inputStatus={<BetaCaptureStatus state={captureStatus} message={preparingPreSendCurrent?.clipboardAttempt?'预发送排队 · 剪贴板读取中':clipboardBusy?'剪贴板读取中 · 可预发送':drafts.persistenceState==='pending'?'正在暂存记录草稿…':drafts.persistenceState==='failed'?'暂存失败，请保留窗口并重试':preparingPreSendCurrent?'预发送排队中；附件校验完成后提交，继续输入会取消':pending.some(item=>item.state==='pending'&&item.capture_attempted===false)?'上一条尚未提交；继续输入会取消预发送并恢复原文与附件':pending.some(item=>item.state==='pending')?'上一条已进入发送和回执确认；当前输入属于下一条记录':pending.length?'上一条提交仍待查证；当前输入不会改写原命令':currentCommitted ? '本机已保存' : hasDraftContent?'记录草稿已暂存 · 尚未提交':`${inputSendShortcutLabel(inputSendMode)} · 支持粘贴图片`}/> }
    />
  </div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
