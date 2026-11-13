import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { ArrowUp, RefreshCw } from 'lucide-react';
import { PageShell } from '@/ui/app/components/PageShell';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';
import { nativeBetaClient, webBetaClient, type BetaClient, type BetaProfile, type BetaStatus, type BetaPage } from './client';
import { BetaDraftController, errorMessage } from './drafts';
import { betaUuid } from './initialization';
import { useBetaNow } from './date-clock';

const SESSION_KEY = 'exomind:beta:connection';
const DATE_KEY = 'exomind:beta:date-display';
const selectClass = 'h-9 max-w-full rounded-md border border-input bg-page px-2 text-sm dark:bg-page-dark';

/** A separate entry: no legacy runtime/profile/event-store bootstrap. */
export function BetaApp({ client: injected }: { client?: BetaClient }) {
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
  if (client) return <ConnectedBeta key={native ? 'native' : undefined} client={client}
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

function ConnectedBeta({ client, onDisconnect }: { client: BetaClient; onDisconnect?: () => void }) {
  const [status, setStatus] = useState<BetaStatus | null>(null);
  const [profiles, setProfiles] = useState<BetaProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  const creation = useRef<{ name: string; id: string } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setStatus(null); setLoading(true); setError(''); setProfiles([]); setProfileId('');
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
  async function create(event: FormEvent) {
    event.preventDefault(); if (!name.trim() || creating) return;
    const current = generation.current;
    try { if (creation.current?.name !== name.trim()) creation.current = { name: name.trim(), id: betaUuid() }; }
    catch (failure) { setError(errorMessage(failure)); return; }
    const request = creation.current;
    if (!request) return;
    setCreating(true); setError('');
    try {
      const result = await client.provisionProfile(request.id, request.name);
      if (current !== generation.current) return;
      setProfiles(previous => [...previous.filter(item => item.profile_id !== result.profile_id), result]);
      setProfileId(result.profile_id); setName(''); creation.current = null;
    } catch (failure) { if (current === generation.current) setError(errorMessage(failure)); }
    finally { if (current === generation.current) setCreating(false); }
  }
  return <PageShell title="当下" subtitle="Beta · 本机记录" contentClassName="flex flex-col"
    headerAction={onDisconnect && <Button variant="ghost" onClick={onDisconnect}>断开</Button>}
    headerBottom={status && <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="beta-profile">当前档案</label>
      <select id="beta-profile" className={selectClass} value={profileId} onChange={event => setProfileId(event.target.value)}>
        {!profiles.length && <option value="">请创建档案</option>}
        {profiles.map(item => <option key={item.profile_id} value={item.profile_id}>{item.display_name}</option>)}
      </select>
      <form onSubmit={create} className="flex min-w-0 flex-1 gap-2">
        <Input aria-label="新档案名称" className="min-w-0 max-w-48" placeholder="新档案名称" value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={creating} />
        <Button type="submit" variant="outline" disabled={creating || !name.trim()}>{creating ? '创建中…' : '创建档案'}</Button>
      </form>
    </div>}>
    {loading && <p role="status" className="p-5 text-sm text-muted">正在连接…</p>}
    {error && <div role="alert" className="flex items-center gap-2 px-5 py-3 text-sm text-destructive">{error}
      {!status && <Button variant="outline" onClick={() => setReload(value => value + 1)}>重新连接</Button>}</div>}
    {status && <DeviceWorkspace key={`${status.device_id}`} client={client} deviceId={status.device_id} profileId={profileId} />}
  </PageShell>;
}

function DeviceWorkspace({ client, deviceId, profileId }: { client: BetaClient; deviceId: string; profileId: string }) {
  const [controller, setController] = useState<BetaDraftController | null>(null);
  const [error, setError] = useState('');
  const [lockAttempt, setLockAttempt] = useState(0);
  const lockRequest = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let owner: BetaDraftController | undefined; let cancelled = false; let release: (() => void) | undefined;
    const acquire = () => {
      if (cancelled) return;
      try { owner = new BetaDraftController(client, deviceId, localStorage); setController(owner); }
      catch { setError('当前环境无法访问草稿缓存，尚未启用发送'); }
    };
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
          if (!lock) { setError('另一窗口正在编辑此设备的草稿，请先关闭该窗口，再重试草稿锁'); return; }
          acquire(); if (!cancelled) await new Promise<void>(resolve => { release = resolve; });
        });
      })();
      lockRequest.current = operation;
      void operation.catch(failure => { if (!cancelled) setError(errorMessage(failure)); });
    }
    else setError('当前浏览器不支持安全的草稿窗口锁，请使用支持 Web Locks 的浏览器');
    return () => { cancelled = true; owner?.dispose(); release?.(); setController(null); };
  }, [client, deviceId, lockAttempt]);
  if (error) return <div className="space-y-3 p-5">
    <p role="alert" className="text-sm text-destructive">{error}</p>
    {typeof navigator.locks?.request === 'function' && <Button variant="outline" onClick={() => {
      controller?.dispose(); setController(null); setError(''); setLockAttempt(value => value + 1);
    }}>重试草稿锁</Button>}
  </div>;
  if (!controller || !profileId) return null;
  return <ProfileWorkspace key={profileId} client={client} controller={controller} profileId={profileId} />;
}

function ProfileWorkspace({ client, controller, profileId }: { client: BetaClient; controller: BetaDraftController; profileId: string }) {
  const drafts = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [page, setPage] = useState<BetaPage | null>(null);
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
    void client.eventsPage(profileId, { limit: 100, ...(query ? { search: query } : {}) }).then(result => {
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
      const result = await client.eventsPage(profileId, { before: page.next_before, through: page.highwater, limit: 100, ...(query ? { search: query } : {}) });
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
  const pending = drafts.pending.filter(item => item.command.profile_id === profileId && item.state !== 'committed');
  const busy = pending.some(item => item.state === 'pending' && item.draft_revision === draft?.revision);
  return <>
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
      <div className="space-y-4">{page && [...page.items].reverse().map(event => <article key={event.event_id} className={`flex flex-col ${event.author_kind === 'human' ? 'items-end' : 'items-start'}`}>
        <div className="mb-1 flex items-center gap-2 text-xs text-muted"><span>{event.author_kind === 'human' ? '我' : 'Agent 记录'}</span><EventTimestamp timestamp={event.occurred_at_ms} now={now} mode={mode} /></div>
        <p className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-relaxed ${event.author_kind === 'human' ? 'bg-active text-foreground' : 'bg-muted/15 text-foreground'}`}>{event.text}</p>
      </article>)}</div>
    </div>
    <div className="shrink-0 border-t border-border-page px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {drafts.persistenceError && <p role="alert" className="mb-2 text-xs text-destructive">{drafts.persistenceError}</p>}
      {pending.map(item => <div key={item.command.command_id} className="mb-2 flex items-center gap-2 text-xs text-secondary">
        <div className="min-w-0 flex-1"><p>{item.state === 'pending' ? '正在确认保存…' : `结果待确认${item.error_code ? `（${item.error_code}）` : ''}`}</p><p className="truncate">{item.command.text}</p>{item.message && <p>{item.message}</p>}</div>
        {item.state !== 'pending' && <Button variant="outline" size="sm" onClick={() => void submit(item.command.command_id)}>查证并重试</Button>}
      </div>)}
      <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Textarea aria-label="记录当下" placeholder="记录此刻的想法…" className="max-h-40 min-h-12 resize-y rounded-2xl" value={draft?.text ?? ''}
          onChange={event => { try { controller.setDraft(profileId, event.target.value); } catch (failure) { setError(errorMessage(failure)); } }}
          onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
        <Button type="submit" size="icon" className="shrink-0 rounded-full" aria-label="发送" disabled={!draft?.text.trim() || busy || !!drafts.persistenceError}><ArrowUp className="size-5" /></Button>
      </form>
      <p role="status" className="mt-2 text-[11px] text-muted">{pending.length ? '待确认的提交会保留原文与原命令' : draft?.text === '' && drafts.confirmed.some(item => item.receipt.profile_id === profileId && item.draft_revision + 1 === draft.revision) ? '本机已保存' : 'Ctrl / ⌘ + Enter 发送'}</p>
    </div>
  </>;
}
