import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Link2, Plus, RefreshCw, ShieldOff, Waypoints } from 'lucide-react';
import { PageShell } from '@/ui/app/components/PageShell';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { Divider, SettingRow } from '@/ui/app/components/settings-shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import { useBetaNow } from './date-clock';
import { errorMessage } from './drafts';
import { useBetaDateDisplayMode } from './preferences';
import type { BetaInvitation, BetaInvitationPreview, BetaPeer, BetaPeerStatus, BetaPeersClient } from './peers-client';

type Life = { active: boolean };
function peerLabel(peer: BetaPeer): string { return `设备 ${peer.device_id.slice(0, 8)}`; }
function peerState(peer: BetaPeer): string {
  if (peer.member_state === 'revoked') return '授权已撤销';
  if (peer.member_state === 'pending') return '正在完成加入确认';
  if (peer.connection_state === 'connecting') return '正在连接';
  if (peer.connection_state === 'syncing') return '正在补齐记录';
  if (peer.connection_state === 'error') return '连接需要处理';
  if (peer.connection_state === 'waiting') return '等待设备恢复连接';
  if (peer.event_sync !== 'complete') return '记录待补齐';
  if (peer.originals_sync === 'complete') return '记录与原件已补齐';
  if (peer.originals_sync === 'pending') return '记录已补齐，原件按需';
  return '记录已补齐，原件状态待确认';
}
export function BetaPeersPage({ peers, profileId, profileName, runtimeId, deviceId, onJoined, onEventsChanged }: {
  peers: BetaPeersClient | null;
  profileId: string;
  profileName: string;
  runtimeId: string;
  deviceId: string;
  onJoined: (profileId: string) => Promise<void>;
  onEventsChanged?: (profileId: string) => void;
}) {
  const scope = useMemo(() => ({ peers, profileId, runtimeId, deviceId }), [peers, profileId, runtimeId, deviceId]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const lifecycle = useRef<Life | null>(null);
  const [status, setStatus] = useState<BetaPeerStatus | null>(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [notice, setNotice] = useState('');
  const [operation, setOperation] = useState<string | null>(null);
  const [created, setCreated] = useState<BetaInvitation | null>(null);
  const [invitationText, setInvitationText] = useState('');
  const [preview, setPreview] = useState<BetaInvitationPreview | null>(null);
  const [pendingJoin, setPendingJoin] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<BetaPeer | null>(null);
  const inputRevision = useRef(0);
  const operationFlight = useRef<Life | null>(null);
  const eventsChanged = useRef(onEventsChanged); eventsChanged.current = onEventsChanged;
  const observedSync = useRef<string | null>(null);
  const now = useBetaNow(); const dateMode = useBetaDateDisplayMode();
  const isCurrent = (life: Life) => life.active && lifecycle.current === life && currentScope.current === scope;
  async function refresh(life: Life) {
    if (!peers || !profileId) return;
    const result = await peers.status(profileId);
    if (!isCurrent(life)) return;
    if (result.device_id !== deviceId || result.runtime_id !== runtimeId) throw new Error('本机服务已切换，请重新连接后查看同步状态');
    setStatus(result);
    setStatusError('');
    const confirmed = result.peers.filter(peer => peer.event_sync === 'complete' && peer.last_sync_at_ms !== null)
      .map(peer => `${peer.device_id}:${peer.last_sync_at_ms}`).sort().join('|');
    if (confirmed && confirmed !== observedSync.current) eventsChanged.current?.(profileId);
    observedSync.current = confirmed;
  }
  useEffect(() => {
    const life: Life = { active: true }; lifecycle.current = life;
    setStatus(null); setError(''); setStatusError(''); setNotice(''); setOperation(null); setCreated(null); setPreview(null); setInvitationText(''); setPendingJoin(null); setRevoke(null); observedSync.current = null; inputRevision.current++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try { await refresh(life); }
      catch (failure) { if (isCurrent(life)) setStatusError(errorMessage(failure)); }
      if (isCurrent(life) && peers && profileId) timer = setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => { life.active = false; if (timer) clearTimeout(timer); if (operationFlight.current === life) operationFlight.current = null; };
    // The memoized scope is the complete request owner. Status updates do not
    // restart the lifecycle or move an old P response into Q.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);
  async function perform(label: string, action: (life: Life) => Promise<void>) {
    const life = lifecycle.current;
    if (!peers || !life || operationFlight.current === life || !isCurrent(life)) return;
    operationFlight.current = life;
    setOperation(label); setError(''); setNotice('');
    try { await action(life); }
    catch (failure) { if (isCurrent(life)) setError(errorMessage(failure)); }
    finally { if (isCurrent(life)) { operationFlight.current = null; setOperation(null); } }
  }
  async function join(life: Life) {
    if (!peers || !preview) return;
    const expected = preview; const text = invitationText.trim(); const revision = inputRevision.current;
    const result = await peers.joinInvitation(text);
    if (!isCurrent(life) || revision !== inputRevision.current) return;
    if (result.profile_id !== expected.profile_id || result.peer_device_id !== expected.issuer_device_id) throw new Error('加入结果与邀请不一致，未切换当前档案');
    if (result.state === 'pending') {
      setPendingJoin(result.profile_id); setNotice('加入尚待确认，当前档案保持不变。请保留完整邀请后继续查证。'); return;
    }
    setPendingJoin(null); setNotice('档案已加入，正在打开…');
    try { await onJoined(result.profile_id); }
    catch (failure) { if (isCurrent(life)) setNotice(`档案已加入，尚未切换：${errorMessage(failure)}`); }
  }
  if (!peers) return <PageShell title="设备同步" contentClassName="overflow-y-auto"><div className="mx-auto max-w-3xl px-5 py-8"><SettingsSection title="当前连接"><p className="px-4 py-4 text-sm text-secondary">此连接尚未提供设备同步管理。独立应用会使用本机服务连接设备。</p></SettingsSection></div></PageShell>;
  if (!runtimeId || !deviceId) return <PageShell title="设备同步"><p role="status" className="px-5 py-8 text-sm text-secondary">本机服务尚未就绪，请在当下页面完成连接后继续。</p></PageShell>;
  return <PageShell title="设备同步" contentClassName="overflow-y-auto" headerAction={profileId && <Button variant="ghost" size="icon" aria-label="刷新同步状态" disabled={!!operation} onClick={() => void perform('refresh', refresh)}><RefreshCw size={16}/></Button>}>
    <div className="mx-auto max-w-3xl space-y-5 px-5 pb-8 pt-5 md:px-8 md:py-8">
      <SettingsSection title={profileName || '加入档案'}>
        {status ? <SettingRow icon={<Waypoints className="size-4 text-muted"/>} label="设备同步" right={<Switch aria-label="设备同步" checked={status.network_enabled} disabled={!!operation || !!statusError} onCheckedChange={enabled => void perform('network', async life => {
          await peers.setEnabled(enabled); if (!isCurrent(life)) return; await refresh(life);
        })}/>}/> : <p role="status" className="px-4 py-4 text-sm text-secondary">{profileId ? '正在读取设备状态…' : '粘贴另一设备的邀请，加入已有档案；也可以先创建本机档案。'}</p>}
        {status && <p className="px-4 pb-4 text-xs leading-relaxed text-muted">{status.network_enabled ? '已授权设备会自动连接与补齐。记录和原件分别确认。' : '同步已关闭，本机记录仍可继续保存。'}</p>}
      </SettingsSection>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {statusError && <p role="alert" className="text-sm text-destructive">状态暂未更新：{statusError}{status ? '。以下保留上次确认结果。' : ''}</p>}
      {notice && <p role="status" className="text-sm text-secondary">{notice}</p>}
      {profileId && <SettingsSection title="邀请另一设备">
        <SettingRow icon={<Plus className="size-4 text-muted"/>} label="生成完整邀请" right={<Button variant="outline" size="sm" disabled={!!operation} onClick={() => void perform('create', async life => {
          const result = await peers.createInvitation(profileId); if (isCurrent(life)) setCreated(result);
        })}>{operation === 'create' ? '正在生成…' : '生成邀请'}</Button>}/>
        {created && <div className="space-y-3 px-4 pb-4">
          <Textarea aria-label="完整邀请" readOnly value={created.invitation_text} onFocus={event => event.currentTarget.select()} className="min-h-20 text-xs"/>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted">有效期至 {new Date(created.expires_at_ms).toLocaleString()}</span><Button variant="outline" size="sm" onClick={() => void perform('copy', async life => {
            if (!navigator.clipboard?.writeText) throw new Error('当前环境无法自动复制，请全选邀请文本后复制');
            await navigator.clipboard.writeText(created.invitation_text); if (isCurrent(life)) setNotice('完整邀请已复制');
          })}><Copy size={14}/>复制邀请</Button></div>
        </div>}
      </SettingsSection>}
      <SettingsSection title="加入已有档案">
        <div className="space-y-3 px-4 py-4">
          <label htmlFor="beta-peer-invitation" className="text-sm font-medium text-foreground">另一设备的完整邀请</label>
          <Textarea id="beta-peer-invitation" value={invitationText} maxLength={32768} placeholder="粘贴完整邀请" className="min-h-24 text-xs" onChange={event => { setInvitationText(event.target.value); setPreview(null); setPendingJoin(null); inputRevision.current++; }}/>
          <Button variant="outline" disabled={!!operation || !invitationText.trim()} onClick={() => void perform('inspect', async life => {
            const revision = inputRevision.current; const result = await peers.inspectInvitation(invitationText.trim());
            if (isCurrent(life) && revision === inputRevision.current) setPreview(result);
          })}><Link2 size={14}/>{operation === 'inspect' ? '正在检查…' : '检查邀请'}</Button>
          {preview && <div className="space-y-3 rounded-xl bg-surface p-3 text-sm">
            <p className="font-medium text-foreground">加入「{preview.profile_name}」</p>
            <p className="text-xs leading-relaxed text-secondary">{profileId && profileId !== preview.profile_id ? `当前「${profileName}」会保留，加入确认后才切换档案。` : '加入确认后，已授权设备将自动补齐此档案。'}</p>
            {preview.requires_replacement && <p className="text-xs leading-relaxed text-secondary">这次确认会替换原连接授权，保留档案和已保存记录。旧连接的请求将不再继续。</p>}
            <p className="text-xs text-muted">有效期至 {new Date(preview.expires_at_ms).toLocaleString()}</p>
            {!preview.compatible && <p className="text-sm text-destructive">两端版本暂不兼容，请更新后重新获取邀请。</p>}
            <Button disabled={!!operation || !preview.compatible} onClick={() => void perform('join', join)}><Check size={14}/>{operation === 'join' ? '正在确认…' : pendingJoin ? '继续查证加入' : preview.requires_replacement ? '确认替换连接并加入' : '确认加入档案'}</Button>
          </div>}
        </div>
      </SettingsSection>
      {status && <SettingsSection title="已授权设备">
        {status.peers.length === 0 ? <p className="px-4 py-4 text-sm text-secondary">还没有其他设备加入。</p> : status.peers.map((peer, index) => <div key={peer.device_id}>
          {index > 0 && <Divider/>}
          <div className="space-y-2 px-4 py-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-foreground">{peerLabel(peer)}</p><p className="mt-1 text-xs text-secondary">{peerState(peer)}</p></div>
              <Button variant="outline" size="sm" disabled={!!operation || !!statusError || !status.network_enabled || peer.member_state !== 'ready'} onClick={() => void perform('sync', async life => { await peers.sync(profileId, peer.device_id); if (isCurrent(life)) await refresh(life); })}>立即同步</Button></div>
            {peer.last_sync_at_ms !== null && <div className="flex items-center gap-1 text-xs text-muted"><span>上次确认</span><EventTimestamp timestamp={peer.last_sync_at_ms} now={now} mode={dateMode}/></div>}
            <details className="text-xs text-muted"><summary className="cursor-pointer py-1">连接详情</summary><dl className="space-y-2 py-2"><div><dt>设备身份</dt><dd className="break-all font-mono">{peer.device_id}</dd></div><div><dt>身份指纹</dt><dd className="break-all font-mono">{peer.fingerprint_sha256}</dd></div>{peer.last_error_code && <div><dt>最近错误</dt><dd className="break-all">{peer.last_error_code}</dd></div>}{!!peer.endpoints.length && <div><dt>连接地址</dt><dd className="break-all">{peer.endpoints.join('、')}</dd></div>}</dl>
              <Button variant="outline" size="sm" disabled={!!operation || !!statusError} onClick={() => void perform('replace', async life => { const result = await peers.createInvitation(profileId, peer.device_id); if (isCurrent(life)) setCreated(result); })}>重新授权此设备</Button>
              {peer.member_state !== 'revoked' && <Button variant="ghost" size="sm" disabled={!!operation} onClick={() => setRevoke(peer)}><ShieldOff size={14}/>撤销设备授权</Button>}
            </details>
          </div>
        </div>)}
      </SettingsSection>}
    </div>
    <Dialog open={!!revoke} onOpenChange={open => { if (!open && !operation) setRevoke(null); }}>
      <DialogContent><DialogHeader><DialogTitle>撤销此设备授权？</DialogTitle><DialogDescription>停止此设备后续的读取、追加和补齐。已经保存到其他设备的副本不会被远程抹除。</DialogDescription></DialogHeader>
        <p className="text-sm text-secondary">{revoke && peerLabel(revoke)} · {profileName}</p>
        <DialogFooter><Button variant="outline" disabled={!!operation} onClick={() => setRevoke(null)}>取消</Button><Button variant="destructive" disabled={!!operation} onClick={() => void perform('revoke', async life => {
          if (!revoke) return; await peers.revoke(profileId, revoke.device_id, revoke.member_generation); if (!isCurrent(life)) return; await refresh(life); if (isCurrent(life)) setRevoke(null);
        })}>撤销授权</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </PageShell>;
}
