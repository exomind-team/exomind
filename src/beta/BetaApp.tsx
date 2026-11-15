import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type MutableRefObject } from 'react';
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
import type { BetaTimelinePage,BetaTimeblockNode } from './timeblocks-types';
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

const SESSION_KEY = 'exomind:beta:connection';
const selectClass = 'h-9 max-w-full rounded-md border border-input bg-page px-2 text-sm dark:bg-page-dark';

/** A separate entry: no legacy runtime/profile/event-store bootstrap. */
export function BetaApp({ client: injected, sourceStore, intentJournal, intentPredecessor, peers: injectedPeers }: { client?: BetaClient; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor; peers?:BetaPeersClient|null }) {
  useEffect(() => keepBetaEditableInViewport(), []);
  useBetaThemePresentation();
  const [native] = useState(() => isTauri());
  const [nativePeers] = useState(() => native ? nativeBetaPeersClient() : null);
  const peers = injectedPeers === undefined ? injected ? null : nativePeers : injectedPeers;
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
  if (client) return <ConnectedBeta key={native ? 'native' : undefined} client={client} peers={peers} sourceStore={sourceStore} intentJournal={intentJournal} intentPredecessor={intentPredecessor}
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

function ConnectedBeta({ client, peers, onDisconnect, sourceStore, intentJournal, intentPredecessor }: { client: BetaClient; peers:BetaPeersClient|null; onDisconnect?: () => void; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor }) {
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
  const sectionRef=useRef(section);sectionRef.current=section;
  const [eventRevision,setEventRevision]=useState(0);
  const [profileDialog,setProfileDialog]=useState(false);
  const prepareSwitch=useRef<(()=>Promise<void>)|null>(null);
  const switchFlight=useRef(false);
  const creation = useRef<{ name: string; id: string; client: BetaClient } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setStatus(null); setLoading(true); setError(''); setProfiles([]); setProfileId('');
    switchFlight.current=false;setSwitching(false);setCreating(false);
    void (async () => {
      try {
        const hello = await client.status(); const list = await client.profiles();
        if (current !== generation.current) return;
        setStatus(hello); setProfiles(list); setProfileId(list[0]?.profile_id ?? '');
      } catch (failure) { if (current === generation.current) setError(errorMessage(failure)); }
      finally { if (current === generation.current) setLoading(false); }
    })();
    return () => { ++generation.current; };
  }, [client, reload]);
  async function changeProfile(next:string,stillWanted:()=>boolean=()=>true){
    if(next===profileId)return true;
    if(switchFlight.current||!prepareSwitch.current)return false;
    const current=generation.current;const guard=prepareSwitch.current;
    switchFlight.current=true;setSwitching(true);setError('');
    try{await guard();if(current!==generation.current||guard!==prepareSwitch.current||!stillWanted())return false;setProfileId(next);return true;}
    catch(failure){if(current===generation.current&&guard===prepareSwitch.current)setError(`当前草稿尚未暂存，未切换档案；请保留窗口并重试：${errorMessage(failure)}`);return false;}
    finally{if(current===generation.current){switchFlight.current=false;setSwitching(false);}}
  }
  async function create(event: FormEvent) {
    event.preventDefault(); if (!name.trim() || creating || persistenceBusy) return;
    const current = generation.current;
    const guard=prepareSwitch.current;if(!guard)return;
    try { if (creation.current?.name !== name.trim() || creation.current?.client!==client) creation.current = { name: name.trim(), id: betaUuid(), client }; }
    catch (failure) { setError(errorMessage(failure)); return; }
    const request = creation.current;
    if (!request) return;
    setCreating(true); setError('');
    try {
      await guard();
      if(current!==generation.current||guard!==prepareSwitch.current)return;
      const result = await client.provisionProfile(request.id, request.name);
      if (current !== generation.current || guard!==prepareSwitch.current) return;
      await guard();
      if(current!==generation.current||guard!==prepareSwitch.current)return;
      setProfiles(previous => [...previous.filter(item => item.profile_id !== result.profile_id), result]);
      setProfileId(result.profile_id); setName(''); creation.current = null;
    } catch (failure) { if (current === generation.current) setError(errorMessage(failure)); }
    finally { if (current === generation.current) setCreating(false); }
  }
  const profileName=profiles.find(profile=>profile.profile_id===profileId)?.display_name??'';
  async function joined(nextProfile:string){
    const current=generation.current;
    const list=await client.profiles();
    if(current!==generation.current)throw new Error('本机服务已变化，请重新打开已加入的档案');
    if(!list.some(profile=>profile.profile_id===nextProfile))throw new Error('已加入档案尚未出现在本机列表，请刷新后打开');
    setProfiles(list);
    if(sectionRef.current!=='sync')throw new Error('当前页面已切换，请从档案菜单打开已加入的档案');
    if(!(await changeProfile(nextProfile,()=>sectionRef.current==='sync')))throw new Error('请等待当前草稿暂存后，再选择已加入的档案');
    if(current===generation.current)setSection('now');
  }
  return <><BetaAppShell section={section} onSectionChange={setSection} profileName={profileName} onProfileClick={()=>setProfileDialog(true)}
    sync={<BetaPeersPage peers={peers} profileId={profileId} profileName={profileName} runtimeId={status?.runtime_id??''} deviceId={status?.device_id??''} onJoined={joined} onEventsChanged={changed=>{if(changed===profileId)setEventRevision(value=>value+1);}}/>}
    settings={<BetaSettingsPage profileName={profileName} onDisconnect={persistenceBusy?undefined:onDisconnect}/>}
    now={<PageShell title="当下" className="min-h-0 overflow-y-auto" headerClassName="shrink-0" contentClassName="flex flex-col"
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
    {loading && <p role="status" className="p-5 text-sm text-muted">正在连接…</p>}
    {error && <div role="alert" className="flex items-center gap-2 px-5 py-3 text-sm text-destructive">{error}
      {!status && <Button variant="outline" onClick={() => setReload(value => value + 1)}>重新连接</Button>}</div>}
    {status && <DeviceWorkspace key={`${status.device_id}`} active={section==='now'} eventRevision={eventRevision} client={client} deviceId={status.device_id} profileId={profileId} sourceStore={sourceStore} intentJournal={intentJournal} intentPredecessor={intentPredecessor} onPersistenceBusy={setPersistenceBusy} prepareSwitch={prepareSwitch} />}
  </PageShell>}/><BetaProfileDialog open={profileDialog} onOpenChange={setProfileDialog} profiles={profiles} profileId={profileId} loading={loading} disabled={persistenceBusy||switching||!prepareSwitch.current} creating={creating} name={name} onNameChange={setName} onCreate={create} onSelect={changeProfile} error={error}/></>;
}

function DeviceWorkspace({ client, deviceId, profileId, sourceStore, intentJournal, intentPredecessor, onPersistenceBusy, prepareSwitch, active, eventRevision }: { client: BetaClient; deviceId: string; profileId: string; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor; onPersistenceBusy:(busy:boolean)=>void; prepareSwitch:MutableRefObject<(()=>Promise<void>)|null>; active:boolean;eventRevision:number }) {
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
              for(let attempt=0;attempt<8;attempt++){
                if(cancelled)throw new Error('当前草稿窗口已关闭');
                await Promise.all([capture!.flush(),focus?.flush()]);
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
            for(const unsubscribe of unsubscribers)unsubscribe();capture?.dispose();focus?.dispose();
            // The Web Lock callback does not settle while an accepted local
            // transaction is still draining, including StrictMode late opens.
            await Promise.all([capture?.close(),focus?.close()]);
          }
        });
      })();
      lockRequest.current = operation;
      void operation.catch(failure => { if (!cancelled) {setError(errorMessage(failure));setRecoveryRequired(!!failure&&typeof failure==='object'&&'code'in failure&&failure.code==='intent_recovery_required');onPersistenceBusy(false);} });
    }
    else {setError('当前浏览器不支持安全的草稿窗口锁，请使用支持 Web Locks 的浏览器');onPersistenceBusy(false);}
    return () => { cancelled = true;if(prepareSwitch.current===switchGuard)prepareSwitch.current=null;capture?.dispose();focus?.dispose();release?.();setOwners(null); };
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
  return <ProfileWorkspace key={profileId} visible={active} externalRevision={eventRevision} client={client} controller={owners.capture} focus={owners.focus} profileId={profileId} />;
}

async function readTimeline(client:BetaClient,profileId:string,query:BetaQuery):Promise<BetaTimelinePage>{
  if(client.timelinePage)return client.timelinePage(profileId,query);
  const page=await client.eventsPage(profileId,query);return{...page,items:page.items.map(record=>({kind:'capture' as const,record}))};
}
function ProfileWorkspace({ client, controller, focus, profileId, visible, externalRevision }: { client: BetaClient; controller: BetaDraftController; focus:BetaTimeblockController|null; profileId: string; visible:boolean;externalRevision:number }) {
  const drafts = useSyncExternalStore(controller.subscribe, controller.snapshot);
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
    setError('');
    try {
      const receipt = commandId ? await controller.retry(commandId) : await controller.submit(profileId);
      if (receipt && alive.current) setRevision(value => value + 1);
    } catch (failure) { if (alive.current) setError(errorMessage(failure)); }
  }
  const draft = drafts.drafts[profileId];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const reselectTarget = useRef<string | null>(null);
  useEffect(() => { void controller.resumeFiles(profileId); }, [controller, profileId]);
  useLayoutEffect(() => resizeNowInputTextarea(textareaRef.current), [draft?.text]);
  const pending = drafts.pending.filter(item => item.command.profile_id === profileId && item.state !== 'committed');
  const busy = pending.some(item => item.state === 'pending' && item.draft_revision === draft?.revision);
  const preparing = draft?.files?.some(file => !file.original || file.state === 'preparing') ?? false;
  return <>
    {focus&&<MainOverlayBridge client={client} capture={controller} focus={focus} profileId={profileId} onCommitted={()=>setRevision(value=>value+1)}/>}
    {focus&&<BetaFocusTimer controller={focus} client={client} profileId={profileId} onCommitted={()=>setRevision(value=>value+1)}/>}
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
    </div>
    {error && <p role="alert" className="px-5 py-2 text-sm text-destructive">{error}</p>}
    <div ref={scroll} className="min-h-[8rem] flex-1 overflow-y-auto px-5 py-4" aria-label="记录历史" aria-busy={loading} onScroll={event=>{if(!visible)return;const element=event.currentTarget;readingTop.current=element.scrollTop;followTail.current=element.scrollHeight-element.clientHeight-element.scrollTop<64;}}>
      {page?.next_before !== null && page && <div className="mb-4 text-center"><Button variant="ghost" disabled={loading} onClick={() => void older()}>加载更早记录</Button></div>}
      {loading && <p role="status" className="text-center text-sm text-muted">正在读取…</p>}
      {page?.items.length === 0 && <p className="py-8 text-center text-sm text-muted">{query ? '没有匹配记录' : '还没有记录'}</p>}
      <div className="space-y-4">{page && [...page.items].reverse().map(item => item.kind==='timeblock'?<ChatMessageRowView key={item.record.event_id} eventId={item.record.event_id} timelineKind="timeblock" tone="system"
        avatar={<Avatar className="mt-0.5 h-8 w-8 shrink-0"><AvatarFallback className="bg-surface text-brand-accent"><Timer size={16}/></AvatarFallback></Avatar>}
        metadata={<><span className="text-xs font-semibold text-strong">{item.record.source.kind==='scheduler'?'计时服务':'我 · 时间块'}</span><EventTimestamp timestamp={item.record.occurred_at_ms} now={now} mode={mode}/></>}
        content={<p className="whitespace-pre-wrap break-words">{timeblockSummary(item.record)}</p>}/>
      :(()=>{const event=item.record;return <ChatMessageRowView key={event.event_id} eventId={event.event_id} timelineKind="capture" tone={event.author_kind==='human'?'user':'system'}
        avatar={<Avatar className={`${event.author_kind==='human'?'':'mt-0.5 '}h-8 w-8 shrink-0`}><AvatarFallback className={event.author_kind==='human'?'rounded-full bg-orange-100 text-[11px] font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-100':'bg-surface text-brand-accent'}>{event.author_kind==='human'?'我':<Bot size={16}/>}</AvatarFallback></Avatar>}
        metadata={<><span className="text-muted">设备 {event.device_id.slice(0,8)}</span><EventTimestamp timestamp={event.occurred_at_ms} now={now} mode={mode}/><span className="text-xs font-semibold text-strong">{event.author_kind==='human'?'我':'Agent 记录'}</span></>}
        content={event.text?<p className="whitespace-pre-wrap break-words">{event.text}</p>:null}
        afterBubble={!!event.originals?.length&&<OriginalDownloads client={client} profileId={profileId} originals={event.originals}/>}/>;})())}</div>
    </div>
    <NowInputRowView
      value={draft?.text ?? ''}
      placeholder="记录此刻的想法…"
      inputRef={textareaRef}
      textareaLabel="记录当下"
      sendLabel="发送"
      onValueChange={(next, element) => { try { controller.setDraft(profileId, next); resizeNowInputTextarea(element); } catch (failure) { setError(errorMessage(failure)); } }}
      onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}
      onSend={() => submit()}
      onAttachmentClick={client.originals ? () => { reselectTarget.current = null; if (fileInput.current) { fileInput.current.multiple = true; fileInput.current.click(); } } : undefined}
      sendDisabled={(!draft?.text.trim() && !draft?.files?.length) || preparing || busy || !!drafts.persistenceError}
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
          <FileText size={16} className="shrink-0 text-[#C75B3A] dark:text-[#FDBA74]" />
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
      afterControls={<p role="status" className="mt-2 text-[11px] text-muted">{drafts.persistenceState==='pending'?'正在暂存记录草稿…':drafts.persistenceState==='failed'?'暂存失败，请保留窗口并重试':pending.length ? '待确认的提交会保留原文与原命令' : draft?.text === '' && drafts.confirmed.some(item => item.receipt.profile_id === profileId && item.draft_revision + 1 === draft.revision) ? '本机已保存' : draft?.text.trim()||draft?.files?.length?'记录草稿已暂存 · 尚未提交':'Ctrl / ⌘ + Enter 发送'}</p>}
    />
  </>;
}

function timeblockSummary(node:BetaTimeblockNode):string{
  if(node.payload.kind==='deadline_reached'||node.payload.kind==='run_deadline_reached')return node.payload.end_mode==='hard'?'倒计时到点，行动结束待反馈':'倒计时到点，继续超时';
  const action=node.payload.action;
  switch(action.kind){case'start':return`开始时间块：${action.name}`;case'pause':return'暂停时间块';case'resume':return'继续时间块';case'rotate':return`切换时间块：${action.next.name}`;case'end_action':return'行动结束，待填写反馈';case'submit_feedback':return action.feedback.kind==='skipped'?'已明确跳过反馈':`反馈：${action.feedback.text}`;case'append_feedback':return`追加反馈：${action.text}`;}
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
