import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type MutableRefObject } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Download, FileText, RefreshCw, X } from 'lucide-react';
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
import { collectOriginalDownload, MAX_BASIC_DOWNLOAD_BYTES } from './original-download';
import type { BetaOriginal } from './original-types';
import type { LocalIntentJournal,IntentPredecessor } from './local-intent-journal';
import type { BetaTimelinePage,BetaTimeblockNode } from './timeblocks-types';
import { BetaTimeblockController } from './timeblocks-controller';
import { BetaFocusTimer } from './BetaFocusTimer';
import { MainOverlayBridge } from './overlay/MainOverlayBridge';
import { keepBetaEditableInViewport } from './editable-viewport';

const SESSION_KEY = 'exomind:beta:connection';
const DATE_KEY = 'exomind:beta:date-display';
const selectClass = 'h-9 max-w-full rounded-md border border-input bg-page px-2 text-sm dark:bg-page-dark';

/** A separate entry: no legacy runtime/profile/event-store bootstrap. */
export function BetaApp({ client: injected, sourceStore, intentJournal, intentPredecessor }: { client?: BetaClient; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor }) {
  useEffect(() => keepBetaEditableInViewport(), []);
  const [native] = useState(() => isTauri());
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
  if (client) return <ConnectedBeta key={native ? 'native' : undefined} client={client} sourceStore={sourceStore} intentJournal={intentJournal} intentPredecessor={intentPredecessor}
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

function ConnectedBeta({ client, onDisconnect, sourceStore, intentJournal, intentPredecessor }: { client: BetaClient; onDisconnect?: () => void; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor }) {
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
  async function changeProfile(next:string){
    if(switchFlight.current||next===profileId||!prepareSwitch.current)return;
    const current=generation.current;const guard=prepareSwitch.current;
    switchFlight.current=true;setSwitching(true);setError('');
    try{await guard();if(current!==generation.current||guard!==prepareSwitch.current)return;setProfileId(next);}
    catch(failure){if(current===generation.current&&guard===prepareSwitch.current)setError(`当前草稿尚未暂存，未切换档案；请保留窗口并重试：${errorMessage(failure)}`);}
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
  return <PageShell title="当下" subtitle="Beta · 本机记录" contentClassName="flex flex-col"
    headerAction={onDisconnect && <Button variant="ghost" disabled={persistenceBusy} onClick={onDisconnect}>断开</Button>}
    headerBottom={status && <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="beta-profile">当前档案</label>
      <select id="beta-profile" className={selectClass} value={profileId} disabled={!prepareSwitch.current||switching||creating} onChange={event => {void changeProfile(event.target.value);}}>
        {!profiles.length && <option value="">请创建档案</option>}
        {profiles.map(item => <option key={item.profile_id} value={item.profile_id}>{item.display_name}</option>)}
      </select>
      <form onSubmit={create} className="flex min-w-0 flex-1 gap-2">
        <Input aria-label="新档案名称" className="min-w-0 max-w-48" placeholder="新档案名称" value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={creating} />
        <Button type="submit" variant="outline" disabled={creating || persistenceBusy || !name.trim()}>{creating ? '创建中…' : '创建档案'}</Button>
      </form>
    </div>}>
    {loading && <p role="status" className="p-5 text-sm text-muted">正在连接…</p>}
    {error && <div role="alert" className="flex items-center gap-2 px-5 py-3 text-sm text-destructive">{error}
      {!status && <Button variant="outline" onClick={() => setReload(value => value + 1)}>重新连接</Button>}</div>}
    {status && <DeviceWorkspace key={`${status.device_id}`} client={client} deviceId={status.device_id} profileId={profileId} sourceStore={sourceStore} intentJournal={intentJournal} intentPredecessor={intentPredecessor} onPersistenceBusy={setPersistenceBusy} prepareSwitch={prepareSwitch} />}
  </PageShell>;
}

function DeviceWorkspace({ client, deviceId, profileId, sourceStore, intentJournal, intentPredecessor, onPersistenceBusy, prepareSwitch }: { client: BetaClient; deviceId: string; profileId: string; sourceStore?: FileSourceStore; intentJournal?: LocalIntentJournal; intentPredecessor?:IntentPredecessor; onPersistenceBusy:(busy:boolean)=>void; prepareSwitch:MutableRefObject<(()=>Promise<void>)|null> }) {
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
  return <ProfileWorkspace key={profileId} client={client} controller={owners.capture} focus={owners.focus} profileId={profileId} />;
}

async function readTimeline(client:BetaClient,profileId:string,query:BetaQuery):Promise<BetaTimelinePage>{
  if(client.timelinePage)return client.timelinePage(profileId,query);
  const page=await client.eventsPage(profileId,query);return{...page,items:page.items.map(record=>({kind:'capture' as const,record}))};
}
function ProfileWorkspace({ client, controller, focus, profileId }: { client: BetaClient; controller: BetaDraftController; focus:BetaTimeblockController|null; profileId: string }) {
  const drafts = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [page, setPage] = useState<BetaTimelinePage | null>(null);
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const generation = useRef(0);
  const scroll = useRef<HTMLDivElement>(null); const olderHeight = useRef<number | null>(null);
  const alive = useRef(true); const now = useBetaNow();
  const [mode, setMode] = useState<EventDateDisplayMode>(() => {
    try { const stored = localStorage.getItem(DATE_KEY); return stored === 'full' || stored === 'weekday' ? stored : 'compact'; }
    catch { return 'compact'; }
  });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const current = ++generation.current; setPage(null); setLoading(true); setError('');
    void readTimeline(client,profileId, { limit: 100, ...(query ? { search: query } : {}) }).then(result => {
      if (current === generation.current) { olderHeight.current = null; setPage(result); }
    }).catch(failure => { if (current === generation.current) setError(errorMessage(failure)); })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => { ++generation.current; };
  }, [client, profileId, query, revision]);
  useLayoutEffect(() => {
    const element = scroll.current; if (!element) return;
    if (olderHeight.current !== null) element.scrollTop += element.scrollHeight - olderHeight.current;
    else element.scrollTop = element.scrollHeight;
    olderHeight.current = null;
  }, [page]);
  async function older() {
    if (!page || page.next_before === null || loading) return;
    const current = generation.current; setLoading(true); setError('');
    try {
      const result = await readTimeline(client,profileId, { before: page.next_before, through: page.highwater, limit: 100, ...(query ? { search: query } : {}) });
      if (current !== generation.current) return;
      olderHeight.current = scroll.current?.scrollHeight ?? null;
      setPage({ ...result, items: [...page.items, ...result.items] });
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
        const value = event.target.value as EventDateDisplayMode; setMode(value);
        try { localStorage.setItem(DATE_KEY, value); } catch { setError('日期偏好暂时无法保存'); }
      }}><option value="compact">简略日期</option><option value="full">完整日期</option><option value="weekday">星期日期</option></select>
      <Button variant="ghost" size="icon" aria-label="刷新记录" onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-4" /></Button>
    </div>
    {error && <p role="alert" className="px-5 py-2 text-sm text-destructive">{error}</p>}
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-label="记录历史" aria-busy={loading}>
      {page?.next_before !== null && page && <div className="mb-4 text-center"><Button variant="ghost" disabled={loading} onClick={() => void older()}>加载更早记录</Button></div>}
      {loading && <p role="status" className="text-center text-sm text-muted">正在读取…</p>}
      {page?.items.length === 0 && <p className="py-8 text-center text-sm text-muted">{query ? '没有匹配记录' : '还没有记录'}</p>}
      <div className="space-y-4">{page && [...page.items].reverse().map(item => item.kind==='timeblock'?<article key={item.record.event_id} data-timeline-kind="timeblock" className="flex flex-col items-start">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted"><span>{item.record.source.kind==='scheduler'?'计时服务':'我 · 时间块'}</span><EventTimestamp timestamp={item.record.occurred_at_ms} now={now} mode={mode}/></div>
        <p className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-muted/15 px-4 py-3 text-sm leading-relaxed text-foreground">{timeblockSummary(item.record)}</p>
      </article>:(()=>{const event=item.record;return <article key={event.event_id} data-timeline-kind="capture" className={`flex flex-col ${event.author_kind === 'human' ? 'items-end' : 'items-start'}`}>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted"><span>{event.author_kind === 'human' ? '我' : 'Agent 记录'}</span><EventTimestamp timestamp={event.occurred_at_ms} now={now} mode={mode} /></div>
        <p className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${event.author_kind === 'human' ? 'bg-active text-foreground' : 'bg-muted/15 text-foreground'}`}>{event.text}</p>
        {!!event.originals?.length && <OriginalDownloads client={client} profileId={profileId} originals={event.originals} />}
      </article>;})())}</div>
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
  if(node.payload.kind==='deadline_reached')return node.payload.end_mode==='hard'?'倒计时到点，行动结束待反馈':'倒计时到点，继续超时';
  const action=node.payload.action;
  switch(action.kind){case'start':return`开始时间块：${action.name}`;case'pause':return'暂停时间块';case'resume':return'继续时间块';case'rotate':return`切换时间块：${action.next.name}`;case'end_action':return'行动结束，待填写反馈';case'submit_feedback':return action.feedback.kind==='skipped'?'已明确跳过反馈':`反馈：${action.feedback.text}`;case'append_feedback':return`追加反馈：${action.text}`;}
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function OriginalDownloads({ client, profileId, originals }: { client: BetaClient; profileId: string; originals: BetaOriginal[] }) {
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState('');
  const active = useRef(true); useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function download(original: BetaOriginal) {
    setBusy(original.original_id); setError('');
    try {
      const blob = await collectOriginalDownload(client, profileId, original); if (!active.current) return;
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = original.file_name;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (failure) { if (active.current) setError(errorMessage(failure)); }
    finally { if (active.current) setBusy(null); }
  }
  return <div className="mt-2 max-w-[90%] space-y-1">{originals.map(original => <div key={original.original_id} className="flex items-center gap-2 rounded-2xl border border-[#E7E5E4] bg-white/90 px-3 py-2 dark:border-[#292524] dark:bg-[#1C1917]">
    <FileText size={16} className="shrink-0 text-[#C75B3A] dark:text-[#FDBA74]" />
    <div className="min-w-0 flex-1"><p className="break-all text-xs font-medium">{original.file_name}</p><p className="text-[10px] text-muted">{formatBytes(original.byte_length)}</p>{original.byte_length > MAX_BASIC_DOWNLOAD_BYTES && <p className="text-xs text-muted">当前下载入口支持 64 MiB 以内；更大原件的流式导出尚未接入</p>}</div>
    <Button variant="ghost" size="icon" aria-label={`下载 ${original.file_name}`} disabled={busy !== null || original.byte_length > MAX_BASIC_DOWNLOAD_BYTES} onClick={() => void download(original)}><Download size={14} /></Button>
  </div>)}{busy && <p role="status" className="text-xs text-muted">正在读取并校验原件…</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>;
}
