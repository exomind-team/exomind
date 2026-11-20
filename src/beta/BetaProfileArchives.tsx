import { useEffect, useRef, useState } from 'react';
import { Archive, ChevronDown, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ProfileArchiveCapabilities, ProfileArchiveClient, ProfileArchivePhase, ProfileArchiveTask } from './profile-archive-client';

const PHASE: Record<ProfileArchivePhase, string> = {
  preparing: '正在准备', awaiting_source: '等待选择备份文件', spooling: '正在读取备份文件',
  preview_ready: '等待确认导入', importing: '正在导入', exporting: '正在整理备份',
  awaiting_destination: '等待选择保存位置', writing: '正在写入文件', verifying: '正在核对文件',
  cancel_requested: '正在取消，等待任务确认', succeeded: '已完成', cancelled: '已取消',
  failed: '操作未完成', interrupted: '上次操作已中断',
};
const TERMINAL = new Set<ProfileArchivePhase>(['succeeded', 'cancelled', 'failed', 'interrupted']);
function ongoing(row: ProfileArchiveTask) { return !TERMINAL.has(row.phase); }
function message(error: unknown) { return error instanceof Error ? error.message : '无法确认档案操作，请刷新操作历史核对结果。'; }
function finishedLabel(row: ProfileArchiveTask) {
  if (row.phase === 'failed' && row.failure_code === 'archive_destination_unsupported') {
    return '此保存位置不受支持，请通过系统文档选择器重新选择位置。';
  }
  if (row.phase !== 'succeeded') return PHASE[row.phase];
  const result = row.direction === 'import' ? '导入完成' : '备份已保存';
  return row.archive_complete === false ? `${result}，内容不完整` : result;
}

export function BetaProfileArchiveEntry({ client, profileId, profileName, onProfilesChanged }: {
  client?: ProfileArchiveClient;
  profileId: string;
  profileName: string;
  onProfilesChanged?: (profileId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<ProfileArchiveCapabilities | null>(null);
  const [rows, setRows] = useState<ProfileArchiveTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [details, setDetails] = useState<ReadonlySet<string>>(() => new Set());
  const [abandon, setAbandon] = useState<ProfileArchiveTask | null>(null);
  const epoch = useRef(0);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const notified = useRef(new Set<string>());
  const imported = useRef(onProfilesChanged);
  imported.current = onProfilesChanged;
  const changeOpen = (next: boolean) => { epoch.current++; if (!next) setAbandon(null); setOpen(next); };

  useEffect(() => {
    if (!open) return;
    const current = ++epoch.current;
    let alive = true, reading = false;
    let descriptor: ProfileArchiveCapabilities | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const valid = () => alive && current === epoch.current;
    const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    setRows([]); setCapabilities(null); setError(''); setNotice(''); setActing(false);
    async function read() {
      if (!valid() || reading || document.visibilityState === 'hidden') return;
      clear();
      if (!client) { setError('请在支持档案往返的桌面或安卓客户端中使用此功能。'); return; }
      reading = true; setLoading(true);
      try {
        descriptor ??= await client.capabilities();
        if (!valid()) return;
        setCapabilities(descriptor);
        const next = await client.history();
        if (!valid()) return;
        setRows(next); setError('');
        const retained = new Set(next.map(row => row.request_id));
        notified.current = new Set([...notified.current].filter(id => retained.has(id)));
        let changedProfile: string | undefined;
        for (const row of next) {
          if (row.direction === 'import' && TERMINAL.has(row.phase) && row.profile_id && !notified.current.has(row.request_id)) {
            notified.current.add(row.request_id);
            changedProfile = row.profile_id;
          }
        }
        if (changedProfile) imported.current?.(changedProfile);
        if (next.some(row => ongoing(row) && row.phase !== 'preview_ready')) timer = setTimeout(() => { void read(); }, 1000);
      } catch (failure) { if (valid()) setError(message(failure)); }
      finally { reading = false; if (valid()) setLoading(false); }
    }
    function visibility() { clear(); if (document.visibilityState !== 'hidden') void read(); }
    refresh.current = read;
    document.addEventListener('visibilitychange', visibility);
    void read();
    return () => { alive = false; clear(); refresh.current = async () => {}; document.removeEventListener('visibilitychange', visibility); };
  }, [open, client]);

  async function action(run: () => Promise<unknown>) {
    if (acting) return;
    const current = epoch.current;
    setActing(true); setError(''); setNotice('');
    try {
      const accepted = await run();
      if (current !== epoch.current) return;
      setNotice(accepted === false ? '取消请求未被受理，已刷新操作历史。' : '操作已受理，具体进度与结果见下方。');
      await refresh.current();
    } catch (failure) {
      if (current === epoch.current) {
        await refresh.current();
        if (current === epoch.current) setError(message(failure));
      }
    } finally { if (current === epoch.current) setActing(false); }
  }
  const busy = acting || rows.some(ongoing);
  return <>
    <Button type="button" variant="outline" className="gap-2" onClick={() => changeOpen(true)}><Archive size={16} />档案备份与导入</Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent hideCloseButton className="beta-ui max-h-[85dvh] overflow-y-auto">
        <DialogHeader className="pr-9 text-left">
          <DialogTitle>档案备份与导入</DialogTitle>
          <DialogDescription>备份保留记录与原件。导入前先预览；设备身份和授权分别保留。</DialogDescription>
        </DialogHeader>
        <Button type="button" variant="ghost" size="icon" className="absolute right-3 top-3" aria-label="关闭档案备份与导入" onClick={() => changeOpen(false)}><X size={16} /></Button>
        {capabilities && client && <div className="space-y-3">
          {profileId && capabilities.supports_export && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-card p-3">
            <span className="min-w-0 break-words text-sm">{profileName || profileId}</span>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { void action(() => client.exportProfile(profileId, crypto.randomUUID())); }}>备份当前档案</Button>
          </div>}
          {capabilities.supports_import && <Button type="button" disabled={busy} onClick={() => { void action(() => client.previewImport(crypto.randomUUID())); }}>选择备份文件</Button>}
          {!capabilities.supports_import && !capabilities.supports_export && <p className="text-sm text-muted">此客户端尚未开放档案备份与导入。</p>}
        </div>}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">本机操作历史</span>
          {client && <Button type="button" variant="ghost" size="sm" className="gap-2" disabled={loading} onClick={() => { void refresh.current(); }}><RefreshCw size={14} />刷新操作历史</Button>}
        </div>
        {loading && rows.length === 0 && <p role="status" className="text-sm text-muted">正在读取…</p>}
        {notice && <p role="status" className="text-sm text-secondary">{notice}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {rows.map(row => <article key={row.request_id} className="space-y-3 rounded-lg border border-border-card p-3 text-sm">
          <div className="flex items-start justify-between gap-3"><p className="font-medium">{row.direction === 'import' ? '导入档案' : '备份档案'}</p><p role={ongoing(row) ? 'status' : undefined}>{finishedLabel(row)}</p></div>
          {row.preview && <div className="space-y-2">
            <p className="break-words font-medium">{row.preview.source_display_name || row.profile_id}</p>
            <p className="tabular-nums">{row.preview.fact_count} 条记录 · {row.preview.original_count} 个原件</p>
            {row.preview.missing_original_count > 0 && <p>缺失 {row.preview.missing_original_count} 个原件，现有记录仍可保留。</p>}
            {row.preview.unverified_origin_count > 0 && <p>{row.preview.unverified_origin_count} 个来源尚未验证。</p>}
            {row.preview.conflict_count > 0 && <p className="text-destructive">{row.preview.conflict_count} 处冲突；请核对备份与本机档案，现有内容不会被覆盖。</p>}
            {row.phase === 'preview_ready' && row.preview.can_import && client && <>
              <p className="text-xs text-muted">将按原档案身份创建或合并记录；不会启动旧计时或复制设备、Agent 授权。</p>
              <Button type="button" disabled={acting} onClick={() => { void action(() => client.confirmImport(row.request_id)); }}>确认导入</Button>
            </>}
          </div>}
          {ongoing(row) && <p className="tabular-nums text-xs text-muted">已处理 {row.facts_processed} 条记录 · {row.bytes_processed.toLocaleString()} 字节</p>}
          {row.partial_output && <p className="text-xs text-secondary">可能已保留部分记录或目的文件，请先核对结果。</p>}
          {(row.phase === 'interrupted' || row.phase === 'failed') && <p className="text-xs text-muted">重新选择文件或保存位置会创建新操作；导入仍需重新预览和确认。</p>}
          <div className="text-xs text-muted">
            <Button type="button" variant="ghost" size="sm" className="gap-1 px-1" aria-expanded={details.has(row.request_id)} aria-controls={`archive-details-${row.request_id}`} onClick={() => setDetails(previous => {
              const next = new Set(previous); if (next.has(row.request_id)) next.delete(row.request_id); else next.add(row.request_id); return next;
            })}>操作详情<ChevronDown size={14} className={details.has(row.request_id) ? 'rotate-180' : ''} /></Button>
            <div id={`archive-details-${row.request_id}`} hidden={!details.has(row.request_id)} className="mt-2 space-y-1 break-all"><p>{row.request_id}</p>{row.profile_id && <p>档案：{row.profile_id}</p>}{row.archive_sha256 && <p>SHA-256：{row.archive_sha256}</p>}{row.failure_code && <p>原因：{row.failure_code}</p>}</div>
          </div>
          {ongoing(row) && row.phase !== 'cancel_requested' && client && <Button type="button" variant="outline" size="sm" disabled={acting} onClick={() => { void action(() => client.cancel(row.request_id)); }}>取消此操作</Button>}
          {(row.phase === 'failed' || row.phase === 'interrupted') && client && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setAbandon(row)}>放弃此操作</Button>}
        </article>)}
        {capabilities && !loading && rows.length === 0 && <p className="text-sm text-muted">暂无本机档案操作。选择文件后会先显示预览。</p>}
      </DialogContent>
    </Dialog>
    <Dialog open={open && abandon !== null} onOpenChange={next => { if (!next) setAbandon(null); }}>
      <DialogContent className="beta-ui">
        <DialogHeader><DialogTitle>放弃此次档案操作？</DialogTitle><DialogDescription>将清除此操作的本机暂存。已导入的记录和目的文件保留；之后需要重新选择来源或重新生成备份。</DialogDescription></DialogHeader>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setAbandon(null)}>返回</Button>
          <Button type="button" disabled={acting || !client} onClick={() => {
            if (!client || !abandon) return;
            const request = abandon.request_id, current = epoch.current;
            void action(async () => {
              const accepted = await client.cancel(request);
              if (current === epoch.current) setAbandon(null);
              return accepted;
            });
          }}>放弃并清理暂存</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
