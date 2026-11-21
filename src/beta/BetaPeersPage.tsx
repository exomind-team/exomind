import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Link2, Plus, RefreshCw, ShieldOff, Waypoints } from 'lucide-react';
import { PageShell } from '@/ui/app/components/PageShell';
import { SettingsSection } from '@/ui/app/components/settings/settings-section';
import { Divider, SettingRow } from '@/ui/app/components/settings-shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EventTimestamp } from '@/ui/app/components/EventTimestamp';
import { useBetaNow } from './date-clock';
import { useBetaViewActive } from './view-activity';
import { errorMessage } from './drafts';
import { useBetaDateDisplayMode } from './preferences';
import { BetaPeerJoinError, joinFailureEndpointReports } from './peers-client';
import type { BetaNearbyCandidate, BetaInvitation, BetaInvitationEndpointReport, BetaInvitationPreview, BetaJoinResult, BetaNetworkScan, BetaPeer, BetaPeerStatus, BetaPeersClient, BetaScanScope } from './peers-client';
import { BetaNearbyDevices } from './NearbyDeviceCandidates';
import { BetaDeviceName } from './BetaDeviceName';
import { useBetaDeviceNames } from './device-names';
import { writeBetaMessageClipboard } from './beta-message-clipboard';

type Life = { active: boolean };
type NearbySelection = { device_id: string; address: string };
type JoinFailureView = { message: string; endpoints: BetaInvitationEndpointReport[] };
function peerState(peer: BetaPeer): string {
  if (peer.member_state === 'revoked') return '同步已停止';
  if (peer.member_state === 'pending') return '尚未建立数据同步';
  if (peer.connection_state === 'connecting') return '正在连接';
  if (peer.connection_state === 'syncing') return '正在补齐记录';
  if (peer.connection_state === 'error') return '连接需要处理';
  if (peer.connection_state === 'waiting') return '等待设备恢复连接';
  if (peer.last_sync_at_ms === null) return '等待首次数据确认';
  if (peer.event_sync !== 'complete') return '记录待补齐';
  if (peer.originals_sync === 'complete') return '记录与原件已补齐';
  if (peer.originals_sync === 'pending') return '记录已补齐，原件按需';
  return '记录已补齐，原件状态待确认';
}
function membershipState(peer: BetaPeer): string {
  if (peer.member_state === 'revoked') return '成员资格已撤销';
  if (peer.member_state === 'pending') return '成员资格待确认';
  return '成员资格已接受';
}
const ENDPOINT_DISPOSITION_LABEL: Record<BetaInvitationEndpointReport['disposition'], string> = {
  attempted: '已尝试',
  skipped: '已跳过',
  reachable: '安全身份可达，尚未加入',
  identity_mismatch: '身份指纹不符，未加入',
  unreachable: '地址不可达',
  protocol_mismatch: '协议不兼容',
};
function invitationEndpointSummary(report: BetaInvitationEndpointReport): string {
  const label = report.disposition === 'protocol_mismatch' && report.error_code === 'tls_handshake_failed'
    ? '安全身份验证失败'
    : ENDPOINT_DISPOSITION_LABEL[report.disposition] ?? report.disposition;
  return report.error_code ? `${label}（${report.error_code}）` : label;
}
function buildInvitationDiagnostic(preview: BetaInvitationPreview, failure: JoinFailureView | null): string {
  const endpoints = failure?.endpoints.length ? failure.endpoints : preview.endpoints;
  const lines = [
    '邀请检查结果',
    '结构：邀请格式与签名有效',
    `协议/schema：${preview.compatible ? '兼容' : '不兼容'}`,
    '档案成员资格：尚未接受',
    ...(failure ? [`上次加入尝试：${failure.message}`] : []),
    ...endpoints.map(report => `${report.endpoint} ${invitationEndpointSummary(report)}`),
  ];
  return lines.join('\n');
}
const SCAN_SCOPE_KIND_LABEL: Record<BetaScanScope['kind'], string> = {
  physical_lan: '物理局域网',
  easytier: 'EasyTier',
  overlay: '覆盖网（未验证，可能为 EasyTier）',
  other: '其他接口',
  manual: '手动范围',
};
function scanScopeReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    loopback: '回环接口，默认不扫描',
    virtual_interface: '虚拟接口（WSL/容器/虚拟网卡），默认不扫描',
    link_local_address: '链路本地地址，默认不扫描',
    unspecified_address: '未指定地址',
    multicast_address: '组播地址',
    broadcast_address: '广播地址',
    ipv6_not_scanned: 'IPv6 保留，不参与有界扫描',
    scope_limit: '已达扫描接口上限（8 个）',
  };
  return labels[reason] ?? reason;
}
// Redaction contract: a scan diagnostic copies only bounded counts, the stage,
// cancellation state, a stable short scan prefix and whitelisted scope reason
// codes. Full scan ids, interface names, networks and open-port endpoints are
// never copied into clipboard diagnostics.
function buildScanDiagnostic(scan: BetaNetworkScan | null, scopes: readonly BetaScanScope[], error: string, networkError: string): string {
  const kindCount = (kind: BetaScanScope['kind']) =>
    scopes.filter(scope => scope.eligible && scope.kind === kind).length;
  const reasonCounts = new Map<string, number>();
  for (const scope of scopes) {
    if (!scope.eligible && scope.reason) {
      reasonCounts.set(scope.reason, (reasonCounts.get(scope.reason) ?? 0) + 1);
    }
  }
  const reasons = [...reasonCounts.entries()]
    .map(([reason, count]) => `${reason}×${count}`)
    .join('、') || '无';
  const lines = [
    '附近扫描诊断',
    ...(scan ? [
      `扫描标识：${scan.scan_id.slice(0, 8)}…`,
      `阶段：${scan.stage}`,
      `尝试：${scan.attempted} · 发现：${scan.discovered} · 跳过：${scan.skipped}`,
      `已取消：${scan.cancelled ? '是' : '否'}`,
      `开放端口候选：${scan.discovered_addresses.length} 个`,
    ] : ['扫描尚未完成']),
    `可选范围：${scopes.filter(scope => scope.eligible).length} 个（物理局域网 ${kindCount('physical_lan')}、EasyTier ${kindCount('easytier')}、覆盖网 ${kindCount('overlay')}、手动 ${kindCount('manual')}、其他 ${kindCount('other')}）`,
    `不可用范围原因：${reasons}`,
    ...(error ? [`错误：${error.slice(0, 200)}`] : []),
    ...(networkError ? [`设备同步状态：${networkError.slice(0, 200)}`] : []),
  ];
  return lines.join('\n');
}
export function BetaPeersPage({ peers, profileId, profileName, runtimeId, deviceId, onJoined, onEventsChanged, visible = true, copyText = writeBetaMessageClipboard }: {
  peers: BetaPeersClient | null;
  profileId: string;
  profileName: string;
  runtimeId: string;
  deviceId: string;
  onJoined: (profileId: string) => Promise<void>;
  onEventsChanged?: (profileId: string) => void;
  visible?: boolean;
  copyText?: (value: string) => Promise<void>;
}) {
  const scope = useMemo(() => ({ peers, profileId, runtimeId, deviceId }), [peers, profileId, runtimeId, deviceId]);
  const names=useBetaDeviceNames(deviceId),peerLabel=(peer:BetaPeer)=>names.label(peer.device_id);
  const currentScope = useRef(scope); currentScope.current = scope;
  const lifecycle = useRef<Life | null>(null);
  const [status, setStatus] = useState<BetaPeerStatus | null>(null);
  const [nearby, setNearby] = useState<BetaNearbyCandidate[]>([]);
  const [nearbyError, setNearbyError] = useState('');
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [notice, setNotice] = useState('');
  const [operation, setOperation] = useState<string | null>(null);
  const [created, setCreated] = useState<BetaInvitation | null>(null);
  const [invitationText, setInvitationText] = useState('');
  const [dialAddress, setDialAddress] = useState('');
  const [nearbySelection, setNearbySelection] = useState<NearbySelection | null>(null);
  const [showDialAddress, setShowDialAddress] = useState(false);
  const [preview, setPreview] = useState<BetaInvitationPreview | null>(null);
  const [joinFailure, setJoinFailure] = useState<JoinFailureView | null>(null);
  const [pendingJoin, setPendingJoin] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<BetaPeer | null>(null);
  const [copyingInvitationId, setCopyingInvitationId] = useState<string | null>(null);
  const inputRevision = useRef(0);
  const operationFlight = useRef<Life | null>(null);
  const copySequence = useRef(0);
  const eventsChanged = useRef(onEventsChanged); eventsChanged.current = onEventsChanged;
  const observedSync = useRef<string | null>(null);
  const readSequence = useRef(0);
  const nearbyReadSequence = useRef(0);
  const scanSequence = useRef(0);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scanFailuresRef = useRef(0);
  const scanScopesLoaded = useRef(false);
  const [scanScopes, setScanScopes] = useState<BetaScanScope[]>([]);
  const [scanScopesError, setScanScopesError] = useState('');
  const [selectedScopeIds, setSelectedScopeIds] = useState<string[]>([]);
  const [manualCidr, setManualCidr] = useState('');
  const [networkEnabled, setNetworkEnabled] = useState<boolean | null>(null);
  const [networkEnabledError, setNetworkEnabledError] = useState('');
  const [scan, setScan] = useState<BetaNetworkScan | null>(null);
  const [scanError, setScanError] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanPollPaused, setScanPollPaused] = useState(false);
  const observing = useBetaViewActive(visible);
  const now = useBetaNow(observing); const dateMode = useBetaDateDisplayMode();
  const isCurrent = (life: Life) => life.active && lifecycle.current === life && currentScope.current === scope;
  async function refresh(life: Life) {
    if (!peers || !profileId) return;
    const sequence = ++readSequence.current;
    let result: BetaPeerStatus;
    try { result = await peers.status(profileId); }
    catch (failure) { if (!isCurrent(life) || sequence !== readSequence.current) return; throw failure; }
    if (!isCurrent(life) || sequence !== readSequence.current) return;
    if (result.device_id !== deviceId || result.runtime_id !== runtimeId) throw new Error('本机服务已切换，请重新连接后查看同步状态');
    setStatus(result);
    setStatusError('');
    const confirmed = result.peers.filter(peer => peer.event_sync === 'complete' && peer.last_sync_at_ms !== null)
      .map(peer => `${peer.device_id}:${peer.last_sync_at_ms}`).sort().join('|');
    if (confirmed && confirmed !== observedSync.current) eventsChanged.current?.(profileId);
    observedSync.current = confirmed;
  }
  async function refreshNearby(life: Life) {
    if (!peers) return;
    const sequence = ++nearbyReadSequence.current;
    let result: BetaNearbyCandidate[];
    try { result = await peers.nearbyCandidates(); }
    catch (failure) { if (!isCurrent(life) || sequence !== nearbyReadSequence.current) return; throw failure; }
    if (!isCurrent(life) || sequence !== nearbyReadSequence.current) return;
    setNearby(result);
    setNearbyError('');
  }
  function selectNearbyCandidate(candidate: BetaNearbyCandidate, address: string) {
    setNearbySelection({ device_id: candidate.device_id, address });
    setDialAddress(address);
    setShowDialAddress(true);
    setPreview(null);
    setJoinFailure(null);
    setPendingJoin(null);
    inputRevision.current++;
    setNotice('候选地址只用于尝试连接；仍需检查完整邀请并明确确认加入。');
  }
  async function loadScanScopes(life: Life) {
    if (!peers || scanScopesLoaded.current) return;
    let result: BetaScanScope[];
    try { result = await peers.scanScopes(); }
    catch (failure) {
      if (isCurrent(life)) { scanScopesLoaded.current = false; setScanScopesError(errorMessage(failure)); }
      return;
    }
    if (!isCurrent(life)) return;
    scanScopesLoaded.current = true;
    setScanScopesError('');
    setScanScopes(result);
    setSelectedScopeIds(result.filter(scope => scope.eligible).map(scope => scope.scope_id));
  }
  async function refreshNetworkEnabled(life: Life) {
    if (!peers) return;
    try {
      const enabled = await peers.networkEnabled();
      if (isCurrent(life)) { setNetworkEnabled(enabled); setNetworkEnabledError(''); }
    } catch (failure) {
      // Keep the last known truth; a read failure must not silently unlock or
      // lock the scan gate.
      if (isCurrent(life)) setNetworkEnabledError(errorMessage(failure));
    }
  }
  function retryNetworkEnabled() {
    setNetworkEnabledError('');
    const life = lifecycle.current;
    if (life) void refreshNetworkEnabled(life);
  }
  function retryScanScopes() {
    scanScopesLoaded.current = false;
    setScanScopesError('');
    const life = lifecycle.current;
    if (life) void loadScanScopes(life);
  }
  function toggleScope(scopeId: string, selected: boolean) {
    setSelectedScopeIds(current => selected
      ? (current.includes(scopeId) ? current : [...current, scopeId])
      : current.filter(id => id !== scopeId));
  }
  function stopScanPolling() {
    if (scanTimer.current) { clearTimeout(scanTimer.current); scanTimer.current = undefined; }
  }
  async function pollScan(life: Life, scanId: string, sequence: number) {
    if (!isCurrent(life) || sequence !== scanSequence.current) return;
    let result: BetaNetworkScan;
    try { result = await peers!.scanStatus(scanId); }
    catch (failure) {
      if (!isCurrent(life) || sequence !== scanSequence.current) return;
      scanFailuresRef.current += 1;
      if (scanFailuresRef.current <= 3) {
        setScanError(`读取扫描进度失败（第 ${scanFailuresRef.current} 次重试）；后台扫描仍可能运行。`);
        setScanBusy(true);
        setScanPollPaused(false);
        scanTimer.current = setTimeout(() => { void pollScan(life, scanId, sequence); }, 400);
        return;
      }
      setScanError('扫描进度读取持续失败；后台扫描仍可能运行。可继续读取、取消扫描或复制诊断。');
      setScanBusy(true);
      setScanPollPaused(true);
      stopScanPolling();
      return;
    }
    if (!isCurrent(life) || sequence !== scanSequence.current) return;
    scanFailuresRef.current = 0;
    setScanError('');
    setScan(result);
    if (result.finished_at_ms === 0) {
      setScanBusy(true);
      setScanPollPaused(false);
      scanTimer.current = setTimeout(() => { void pollScan(life, scanId, sequence); }, 500);
    } else {
      setScanBusy(false);
      setScanPollPaused(false);
      stopScanPolling();
      if (result.discovered > 0) await refreshNearby(life);
    }
  }
  function resumeScanPolling() {
    if (!scan || scan.finished_at_ms !== 0) return;
    scanFailuresRef.current = 0;
    setScanError('');
    setScanPollPaused(false);
    const life = lifecycle.current;
    if (life) void pollScan(life, scan.scan_id, scanSequence.current);
  }
  async function startScan(life: Life) {
    if (!peers) return;
    if (networkEnabled === false) {
      setScanError('请先开启设备同步后才能扫描附近设备。');
      return;
    }
    const sequence = ++scanSequence.current;
    stopScanPolling();
    scanFailuresRef.current = 0;
    setScanError('');
    setScanPollPaused(false);
    const cidr = manualCidr.trim();
    let result: BetaNetworkScan;
    try {
      result = await peers.scanNearby({ scopeIds: selectedScopeIds, ...(cidr ? { manualCidrs: [cidr] } : {}) });
    } catch (failure) {
      if (!isCurrent(life) || sequence !== scanSequence.current) return;
      setScanError(errorMessage(failure));
      setScanBusy(false);
      return;
    }
    if (!isCurrent(life) || sequence !== scanSequence.current) return;
    setScan(result);
    setScanBusy(result.finished_at_ms === 0);
    setScanPollPaused(false);
    if (result.finished_at_ms === 0) void pollScan(life, result.scan_id, sequence);
  }
  async function cancelScan(life: Life) {
    if (!peers || !scan) return;
    const sequence = scanSequence.current;
    scanFailuresRef.current = 0;
    try {
      const result = await peers.cancelScan(scan.scan_id);
      if (!isCurrent(life) || sequence !== scanSequence.current) return;
      setScan(result);
      setScanBusy(result.finished_at_ms === 0);
      setScanPollPaused(false);
      if (result.finished_at_ms === 0) void pollScan(life, result.scan_id, sequence);
    } catch (failure) {
      if (isCurrent(life) && sequence === scanSequence.current) setScanError(errorMessage(failure));
    }
  }
  async function copyScanDiagnostic(life: Life) {
    setError('');
    setNotice('');
    try {
      await copyText(buildScanDiagnostic(scan, scanScopes, scanError, networkEnabledError));
      if (isCurrent(life)) setNotice('附近扫描诊断已复制');
    } catch (failure) {
      if (isCurrent(life)) setError(`扫描诊断复制失败：${errorMessage(failure)}。请重试；不会读取或保存剪贴板内容。`);
    }
  }
  useEffect(() => {
    const life: Life = { active: true }; lifecycle.current = life;
    setStatus(null); setNearby([]); setNearbyError(''); setNearbySelection(null); setError(''); setStatusError(''); setNotice(''); setOperation(null); setCreated(null); setPreview(null); setJoinFailure(null); setInvitationText(''); setDialAddress(''); setShowDialAddress(false); setPendingJoin(null); setRevoke(null); setCopyingInvitationId(null); observedSync.current = null; inputRevision.current++; copySequence.current++;
    scanSequence.current++; scanScopesLoaded.current = false; scanFailuresRef.current = 0; setScanScopes([]); setScanScopesError(''); setSelectedScopeIds([]); setManualCidr(''); setNetworkEnabled(null); setNetworkEnabledError(''); setScan(null); setScanError(''); setScanBusy(false); setScanPollPaused(false);
    if (scanTimer.current) { clearTimeout(scanTimer.current); scanTimer.current = undefined; }
    return () => { life.active = false; copySequence.current++; scanSequence.current++; if (scanTimer.current) { clearTimeout(scanTimer.current); scanTimer.current = undefined; } if (operationFlight.current === life) operationFlight.current = null; };
  }, [scope]);
  useEffect(() => {
    const life = lifecycle.current;
    if (!observing || !life) return;
    let timer: ReturnType<typeof setTimeout> | undefined; let stopped = false;
    const poll = async () => {
      void refreshNetworkEnabled(life);
      void loadScanScopes(life);
      if (profileId) {
        try { await refresh(life); }
        catch (failure) { if (isCurrent(life)) setStatusError(errorMessage(failure)); }
      }
      try { await refreshNearby(life); }
      catch (failure) { if (isCurrent(life)) setNearbyError(errorMessage(failure)); }
      if (!stopped && isCurrent(life) && peers) timer = setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
    // The memoized scope is the complete request owner. Status updates do not
    // restart the lifecycle or move an old P response into Q.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, observing]);
  async function perform(label: string, action: (life: Life) => Promise<void>) {
    const life = lifecycle.current;
    if (!peers || !life || operationFlight.current === life || !isCurrent(life)) return;
    operationFlight.current = life;
    setOperation(label); setError(''); setNotice('');
    try { await action(life); }
    catch (failure) { if (isCurrent(life)) setError(errorMessage(failure)); }
    finally { if (isCurrent(life)) { operationFlight.current = null; setOperation(null); } }
  }
  async function copyInvitation(life: Life, invitation: BetaInvitation, automatic: boolean) {
    const sequence = ++copySequence.current;
    setCopyingInvitationId(invitation.invitation_id);
    setError('');
    setNotice('');
    try {
      await copyText(invitation.invitation_text);
      if (!isCurrent(life) || sequence !== copySequence.current) return;
      setNotice(automatic ? '邀请已生成并复制到剪贴板' : '完整邀请已复制');
    } catch (failure) {
      if (!isCurrent(life) || sequence !== copySequence.current) return;
      setError(`${automatic ? '邀请已生成，但自动复制失败' : '邀请复制失败'}：${errorMessage(failure)}。完整邀请仍保留，请全选文本手动复制或重试。`);
    } finally {
      if (isCurrent(life) && sequence === copySequence.current) setCopyingInvitationId(null);
    }
  }
  function publishInvitation(life: Life, invitation: BetaInvitation) {
    setCreated(invitation);
    void copyInvitation(life, invitation, true);
  }
  async function join(life: Life) {
    if (!peers || !preview) return;
    const expected = preview; const text = invitationText.trim(); const revision = inputRevision.current;
    if (nearbySelection && nearbySelection.device_id !== expected.issuer_device_id) {
      throw new Error('所选设备与完整邀请中的身份不一致，未加入档案');
    }
    if (Date.now() >= expected.expires_at_ms) {
      throw new Error('邀请已过期，未执行加入；请重新获取邀请。');
    }
    const address = dialAddress.trim();
    setJoinFailure(null);
    let result: BetaJoinResult;
    try { result = await (address ? peers.joinInvitation(text, address) : peers.joinInvitation(text)); }
    catch (failure) {
      if (!isCurrent(life) || revision !== inputRevision.current) return;
      const reports = failure instanceof BetaPeerJoinError ? failure.endpoints : joinFailureEndpointReports(failure);
      if (reports && reports.length > 0) setJoinFailure({ message: errorMessage(failure), endpoints: reports });
      throw failure;
    }
    if (!isCurrent(life) || revision !== inputRevision.current) return;
    if (result.profile_id !== expected.profile_id || result.peer_device_id !== expected.issuer_device_id) throw new Error('加入结果与邀请不一致，未切换当前档案');
    if (result.state === 'pending') {
      setPendingJoin(result.profile_id); setNotice('成员资格尚未确认；加入尚待确认，当前档案保持不变。请保留完整邀请后继续查证。'); return;
    }
    setPendingJoin(null); setNotice('成员资格已确认，正在打开…');
    try { await onJoined(result.profile_id); }
    catch (failure) { if (isCurrent(life)) setNotice(`成员资格已确认，尚未切换：${errorMessage(failure)}`); }
  }
  const previewExpired = preview !== null && now >= preview.expires_at_ms;
  const shownEndpoints = joinFailure?.endpoints.length ? joinFailure.endpoints : preview?.endpoints ?? [];
  const endpointListLabel = joinFailure?.endpoints.length ? '上次加入尝试的连接来源' : '连接来源检查结果';
  const allUnreachable = shownEndpoints.length > 0
    && shownEndpoints.every(report => report.disposition === 'unreachable' || report.disposition === 'skipped')
    && shownEndpoints.some(report => report.disposition === 'unreachable');
  if (!peers) return <PageShell title="设备同步" contentClassName="overflow-y-auto"><div className="mx-auto max-w-3xl px-5 py-8"><SettingsSection title="当前连接"><p className="px-4 py-4 text-sm text-secondary">此连接尚未提供设备同步管理。独立应用会使用本机服务连接设备。</p></SettingsSection></div></PageShell>;
  if (!runtimeId || !deviceId) return <PageShell title="设备同步"><p role="status" className="px-5 py-8 text-sm text-secondary">本机服务尚未就绪，请在当下页面完成连接后继续。</p></PageShell>;
  return <PageShell title="设备同步" contentClassName="overflow-y-auto" headerAction={profileId && <Button variant="ghost" size="icon" aria-label="刷新同步状态" disabled={!!operation} onClick={() => void perform('refresh', refresh)}><RefreshCw size={16}/></Button>}>
    <div className="mx-auto max-w-3xl space-y-5 px-5 pb-8 pt-5 md:px-8 md:py-8">
      <SettingsSection title={profileName || '加入档案'}>
        {status ? <SettingRow icon={<Waypoints className="size-4 text-muted"/>} label="设备同步" right={<Switch aria-label="设备同步" checked={status.network_enabled} disabled={!!operation || !!statusError} onCheckedChange={enabled => void perform('network', async life => {
          await peers.setEnabled(enabled); if (!isCurrent(life)) return; await refresh(life); await refreshNetworkEnabled(life);
          if (enabled) await refreshNearby(life); else setNearby([]);
        })}/>}/> : <p role="status" className="px-4 py-4 text-sm text-secondary">{profileId ? '正在读取设备状态…' : '粘贴另一设备的邀请，加入已有档案；也可以先创建本机档案。'}</p>}
        {status && <p className="px-4 pb-4 text-xs leading-relaxed text-muted">{status.network_enabled ? '已授权设备会自动连接与补齐。记录和原件分别确认。' : '同步已关闭，本机记录仍可继续保存。'}</p>}
        {status && <details className="px-4 pb-4 text-xs text-muted"><summary className="cursor-pointer">本机设备与同步地址</summary><dl className="mt-3 space-y-3 select-text"><div><dt>设备身份</dt><dd className="break-all">{status.device_id}</dd></div><div><dt>当前同步地址</dt><dd data-testid="beta-local-sync-addresses" className="mt-1 space-y-1 break-all">{status.local_addresses.length ? status.local_addresses.map(address => <p key={address}>{address}</p>) : status.network_enabled ? '尚未确认可用的同步地址' : '设备同步已关闭'}</dd></div></dl><p className="mt-3">这些地址供已授权设备连接；本机 HTTP 服务地址可在「当下」标题上方查看。</p></details>}
      </SettingsSection>
      <SettingsSection title="潜在设备">
        <div className="space-y-3 px-4 pb-4">
          <p className="text-xs leading-relaxed text-secondary">
            扫描只发起一次有界探测。TCP 43344 开放端口只作为未验证地址候选，不会建立路由、成员授权或档案写入。
          </p>
          {scanScopesError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">扫描范围读取失败：{scanScopesError}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={retryScanScopes}>重新读取范围</Button>
                <Button variant="ghost" size="sm" onClick={() => void copyScanDiagnostic(lifecycle.current!)}>复制扫描诊断</Button>
              </div>
              <p className="text-xs leading-relaxed text-secondary">仍可手动填写 CIDR（例如 EasyTier 的 10.137.0.0/24）。</p>
            </div>
          )}
          {scanScopes.some(scope => scope.eligible) && (
            <div role="group" aria-label="扫描范围" className="space-y-1.5">
              {scanScopes.filter(scope => scope.eligible).map(scope => (
                <label key={scope.scope_id} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={selectedScopeIds.includes(scope.scope_id)}
                    onChange={event => toggleScope(scope.scope_id, event.target.checked)} />
                  <span className="min-w-0 break-all">
                    <span className="text-foreground">{SCAN_SCOPE_KIND_LABEL[scope.kind]}</span>
                    <span className="text-secondary"> · {scope.interface_name} · </span>
                    <span className="font-mono text-secondary">{scope.network}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {scanScopes.some(scope => !scope.eligible) && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">不可用范围（{scanScopes.filter(scope => !scope.eligible).length}）</summary>
              <ul className="mt-2 space-y-1">
                {scanScopes.filter(scope => !scope.eligible).map(scope => (
                  <li key={scope.scope_id}>{scope.interface_name} · {scope.reason ? scanScopeReasonLabel(scope.reason) : '不适用'}</li>
                ))}
              </ul>
            </details>
          )}
          <label htmlFor="beta-scan-manual-cidr" className="sr-only">手动扫描范围</label>
          <Input id="beta-scan-manual-cidr" value={manualCidr} maxLength={64} placeholder="手动 CIDR，如 10.137.0.0/24" className="w-full max-w-64"
            onChange={event => setManualCidr(event.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={scanBusy || networkEnabled !== true}
              onClick={() => void startScan(lifecycle.current!)}>
              扫描当前内网
            </Button>
            {scanBusy && <Button variant="ghost" size="sm" onClick={() => void cancelScan(lifecycle.current!)}>取消扫描</Button>}
            {scan && scan.finished_at_ms === 0 && scanPollPaused && (
              <Button variant="ghost" size="sm" onClick={resumeScanPolling}>继续读取</Button>
            )}
          </div>
          {networkEnabled === null && networkEnabledError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">设备同步状态读取失败：{networkEnabledError}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={retryNetworkEnabled}>重新读取状态</Button>
                <Button variant="ghost" size="sm" onClick={() => void copyScanDiagnostic(lifecycle.current!)}>复制扫描诊断</Button>
              </div>
            </div>
          )}
          {networkEnabled === null && !networkEnabledError && (
            <p role="status" className="text-xs text-secondary">正在读取设备同步状态…</p>
          )}
          {networkEnabled !== null && networkEnabledError && (
            <div className="space-y-2">
              <p role="status" className="text-xs text-secondary">设备同步状态读取失败；以下保留上次确认值：{networkEnabled ? '已开启' : '已关闭'}（{networkEnabledError}）。</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={retryNetworkEnabled}>重新读取状态</Button>
                <Button variant="ghost" size="sm" onClick={() => void copyScanDiagnostic(lifecycle.current!)}>复制扫描诊断</Button>
              </div>
            </div>
          )}
          {networkEnabled === false && (
            <p role="status" className="text-xs text-secondary">{profileId ? '请先开启上方“设备同步”后再扫描附近设备。' : '请先开启设备同步后再扫描附近设备。'}</p>
          )}
          {scanError && <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">{scanError}</p>
            <p className="text-xs leading-relaxed text-secondary">可重新扫描、勾选其他范围或手动填写 CIDR（例如 EasyTier 的 10.137.0.0/24）；若覆盖网 App 未暴露虚拟网卡，请手动添加该网段。</p>
            <Button variant="ghost" size="sm" onClick={() => void copyScanDiagnostic(lifecycle.current!)}>复制扫描诊断</Button>
          </div>}
          {scan && scan.finished_at_ms === 0 && (
            <p role="status" className="text-xs text-secondary">
              {scan.stage === 'cancelling' ? '正在取消扫描' : '正在扫描'} · 已尝试 {scan.attempted} · 已跳过 {scan.skipped}；开放端口将在扫描结束后汇总确认
            </p>
          )}
          {scan && scan.finished_at_ms > 0 && (
            <div className="space-y-2">
              <p role="status" className="text-xs text-secondary">
                扫描结束 · 已尝试 {scan.attempted} · 已发现 {scan.discovered} · 已跳过 {scan.skipped}{scan.cancelled ? ' · 已取消' : ''}
              </p>
              {scan.discovered_addresses.length > 0 && (
                <div className="space-y-1">
                  <ul aria-label="未验证地址候选" className="space-y-1">
                    {scan.discovered_addresses.map(address => (
                      <li key={address} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 break-all font-mono text-secondary">{address} · 开放端口，未验证身份</span>
                        <Button variant="outline" size="sm" disabled={!!operation}
                          onClick={() => { setDialAddress(address); setShowDialAddress(true); setNotice('该地址只是开放端口候选，仍需粘贴完整邀请并核对设备身份。'); }}>
                          使用地址
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {scan.discovered > scan.discovered_addresses.length && (
                    <p className="text-xs text-secondary">另有 {scan.discovered - scan.discovered_addresses.length} 个开放端口未展示（最多展示 64 个）。</p>
                  )}
                </div>
              )}
              {scan.discovered === 0 && (
                <p className="text-xs leading-relaxed text-secondary">
                  {scan.attempted === 0 && scan.skipped > 0
                    ? `所选范围没有可探测的其他主机（已跳过 ${scan.skipped}）。可勾选其他范围或手动填写 CIDR（例如 EasyTier 的 10.137.0.0/24）。`
                    : '没有发现开放端口。可重新扫描、勾选其他范围或手动填写 CIDR（例如 EasyTier 的 10.137.0.0/24）；若覆盖网 App 未暴露虚拟网卡，请手动添加该网段。'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" disabled={scanBusy || networkEnabled !== true} onClick={() => void startScan(lifecycle.current!)}>重新扫描</Button>
                <Button variant="ghost" size="sm" onClick={() => void copyScanDiagnostic(lifecycle.current!)}>复制扫描诊断</Button>
              </div>
            </div>
          )}
        </div>
        <BetaNearbyDevices
          candidates={nearby}
          emptyMessage="暂未发现附近设备"
          disabled={!!operation}
          onSelect={selectNearbyCandidate}
        />
        {nearbyError && <p role="alert" className="px-4 pb-4 text-sm text-destructive">附近设备状态暂未更新：{nearbyError}</p>}
        {!profileId && <div className="space-y-2 px-4 pb-4">
          {networkEnabled !== null && (
            <p role="status" className="text-xs text-secondary">{networkEnabled
              ? '设备同步已开启；附近发现可用，扫描不会授权任何档案。'
              : '设备同步已关闭；开启后可被动发现与扫描，不会授权任何档案。'}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!!operation || networkEnabled === true} onClick={() => void perform('network', async life => {
              await peers.setEnabled(true);
              if (!isCurrent(life)) return;
              await refreshNetworkEnabled(life);
              await refreshNearby(life);
              setNotice('设备同步与附近发现已开启；这不会授权其他设备。');
            })}>开启设备同步与发现</Button>
            <Button variant="outline" size="sm" disabled={!!operation || networkEnabled === false} onClick={() => void perform('network', async life => {
              await peers.setEnabled(false);
              if (!isCurrent(life)) return;
              await refreshNetworkEnabled(life);
              await refreshNearby(life);
              setNotice('设备同步与附近发现已关闭。');
            })}>关闭设备同步与发现</Button>
          </div>
        </div>}
      </SettingsSection>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {statusError && <p role="alert" className="text-sm text-destructive">状态暂未更新：{statusError}{status ? '。以下保留上次确认结果。' : ''}</p>}
      {notice && <p role="status" className="text-sm text-secondary">{notice}</p>}
      {profileId && <SettingsSection title="邀请另一设备">
        <SettingRow icon={<Plus className="size-4 text-muted"/>} label="生成完整邀请" right={<Button variant="outline" size="sm" disabled={!!operation || !!copyingInvitationId} onClick={() => void perform('create', async life => {
          const result = await peers.createInvitation(profileId); if (isCurrent(life)) publishInvitation(life,result);
        })}>{operation === 'create' ? '正在生成…' : '生成邀请'}</Button>}/>
        {created && <div className="space-y-3 px-4 pb-4">
          <Textarea aria-label="完整邀请" readOnly value={created.invitation_text} onFocus={event => event.currentTarget.select()} className="min-h-20 text-xs"/>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted">有效期至 {new Date(created.expires_at_ms).toLocaleString()}</span><Button variant="outline" size="sm" disabled={!!operation || !!copyingInvitationId} onClick={() => void perform('copy', async life => {
            await copyInvitation(life, created, false);
          })}><Copy size={14}/>{copyingInvitationId === created.invitation_id ? '正在复制…' : '复制邀请'}</Button></div>
        </div>}
      </SettingsSection>}
      <SettingsSection title="加入已有档案">
        <div className="space-y-3 px-4 py-4">
          <label htmlFor="beta-peer-invitation" className="text-sm font-medium text-foreground">另一设备的完整邀请</label>
          {nearbySelection && <p role="status" className="break-all text-xs text-secondary">{'已选择设备 ' + nearbySelection.device_id + ' · 候选地址 ' + nearbySelection.address + '。仍需检查完整邀请并明确确认加入。'}</p>}
          <Textarea id="beta-peer-invitation" value={invitationText} maxLength={32768} placeholder="粘贴完整邀请" className="min-h-24 text-xs" onChange={event => { setInvitationText(event.target.value); setPreview(null); setJoinFailure(null); setPendingJoin(null); if (!nearbySelection) { setDialAddress(''); setShowDialAddress(false); } inputRevision.current++; }}/>
          <Button variant="outline" disabled={!!operation || !invitationText.trim()} onClick={() => void perform('inspect', async life => {
            const revision = inputRevision.current;
            let result: BetaInvitationPreview;
            try { result = await peers.inspectInvitation(invitationText.trim()); }
            catch (failure) {
              if (!isCurrent(life) || revision !== inputRevision.current) return;
              throw failure;
            }
            if (!isCurrent(life) || revision !== inputRevision.current) return;
            if (nearbySelection && nearbySelection.device_id !== result.issuer_device_id) {
              setNearbySelection(null); setDialAddress(''); setShowDialAddress(false);
              setNotice('所选候选设备与完整邀请的身份不一致，已清除候选地址。');
            }
            setPreview(result);
            setJoinFailure(null);
          })}><Link2 size={14}/>{operation === 'inspect' ? '正在检查…' : '检查邀请'}</Button>
          {preview && <div className="space-y-3 rounded-xl bg-surface p-3 text-sm">
            <p className="font-medium text-foreground">加入「{preview.profile_name}」</p>
            <p className="text-xs leading-relaxed text-secondary">{profileId && profileId !== preview.profile_id ? `当前「${profileName}」会保留，加入确认后才切换档案。` : '加入成功后才会进入同步阶段；记录与原件是否完成以设备卡的最后确认为准。'}</p>
            {preview.requires_replacement && <p className="text-xs leading-relaxed text-secondary">这次确认会替换原连接授权，保留档案和已保存记录。旧连接的请求将不再继续。</p>}
            <p className="text-xs text-muted">有效期至 {new Date(preview.expires_at_ms).toLocaleString()}</p>
            <dl aria-label="邀请检查状态" className="space-y-1 text-xs">
              <div><dt className="font-medium text-foreground">邀请结构</dt><dd className="text-secondary">邀请格式与签名有效。</dd></div>
              <div><dt className="font-medium text-foreground">协议/schema</dt><dd className="text-secondary">{preview.compatible ? '协议/schema 兼容，可继续检查来源。' : '协议/schema 不兼容，不能加入此档案。'}</dd></div>
              <div><dt className="font-medium text-foreground">档案成员资格</dt><dd className="text-secondary">尚未接受；确认加入后才会建立或替换档案授权。</dd></div>
            </dl>
            {previewExpired && <p role="alert" className="text-sm text-destructive">邀请结构有效，但已过期。</p>}
            {shownEndpoints.length > 0 && <div className="space-y-1 rounded-md border border-border-card p-2">
              <p className="text-xs font-medium text-foreground">{endpointListLabel}</p>
              <ul role="list" aria-label={endpointListLabel} className="space-y-1">
                {shownEndpoints.map(report => <li key={report.endpoint} className="break-all text-xs text-secondary">{report.endpoint} · {invitationEndpointSummary(report)}</li>)}
              </ul>
            </div>}
            {shownEndpoints.length === 0 && <p className="text-xs text-secondary">暂无可检查的连接来源；可手动填写其他连接地址后重试。</p>}
            {allUnreachable && <p role="alert" className="text-sm text-destructive">所有可尝试的连接来源均不可达。请填写 EasyTier 或其他网络地址后重试；仍会核对原邀请的设备身份。</p>}
            {joinFailure && shownEndpoints.length === 0 && <p className="text-xs text-secondary">上次加入尝试没有可回显的逐地址结果。</p>}
            {pendingJoin && <p role="status" className="text-xs leading-relaxed text-secondary">档案成员资格尚未接受。当前档案保持不变；请保留完整邀请后继续查证。</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" aria-expanded={showDialAddress} aria-controls={showDialAddress ? 'beta-peer-dial-address' : undefined} onClick={()=>setShowDialAddress(true)}>更换连接地址</Button>
              <Button variant="ghost" size="sm" disabled={!!operation} onClick={() => void perform('diagnostic', async life => {
                await copyText(buildInvitationDiagnostic(preview, joinFailure));
                if (isCurrent(life)) setNotice('连接诊断已复制');
              })}>复制连接诊断</Button>
            </div>
            {showDialAddress && <div className="space-y-2">
              <label htmlFor="beta-peer-dial-address" className="text-xs font-medium">其他连接地址</label>
              <Input id="beta-peer-dial-address" value={dialAddress} maxLength={256} placeholder="设备 IP:端口" onChange={event=>{setNearbySelection(null);setDialAddress(event.target.value);inputRevision.current++;}}/>
              <p className="text-xs leading-relaxed text-secondary">邀请地址不可达时，可填写发起设备的 EasyTier 等网络地址。留空使用邀请地址；仍核对原邀请的设备身份与授权。</p>
            </div>}
            <Button disabled={!!operation || !preview.compatible || previewExpired} onClick={() => void perform('join', join)}><Check size={14}/>{operation === 'join' ? '正在确认…' : pendingJoin ? '继续查证加入' : preview.requires_replacement ? '确认替换连接并加入' : '确认加入档案'}</Button>
          </div>}
        </div>
      </SettingsSection>
      {status && <SettingsSection title="已授权设备">
        {status.peers.length === 0 ? <p className="px-4 py-4 text-sm text-secondary">还没有其他设备加入。</p> : status.peers.map((peer, index) => <div key={peer.device_id}>
          {index > 0 && <Divider/>}
          <div className="space-y-2 px-4 py-4">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-sm font-medium text-foreground"><BetaDeviceName localDeviceId={deviceId} deviceId={peer.device_id}/></div><p className="mt-1 text-xs text-secondary">{membershipState(peer)}</p><p className="mt-1 text-xs text-secondary">{peerState(peer)}</p></div>
              <Button variant="outline" size="sm" disabled={!!operation || !!statusError || !status.network_enabled || peer.member_state !== 'ready'} onClick={() => void perform('sync', async life => { await peers.sync(profileId, peer.device_id); if (isCurrent(life)) await refresh(life); })}>立即同步</Button></div>
            <p className="flex items-center gap-1 text-xs text-muted">数据同步：{peer.last_sync_at_ms === null ? (peer.member_state === 'ready' ? '尚未确认' : peer.member_state === 'pending' ? '等待成员资格确认' : '已停止') : <><span>上次数据同步确认 </span><EventTimestamp timestamp={peer.last_sync_at_ms} now={now} mode={dateMode}/></>}</p>
            {!!peer.history_gaps?.length&&<details className="space-y-2 text-xs text-secondary"><summary className="cursor-pointer">部分历史还不能完整中转（{peer.history_gaps.length} 项）</summary><p>上次同步发现：部分已保存历史的可验证转发前缀尚未补齐。请让仍持有原身份的来源设备用新版上线，或核对来源授权；现有资料保留。已知附件可独立获取。</p>{peer.history_gaps.map(gap=><div key={`${gap.direction}:${gap.origin_device_id}`} className="rounded-lg border border-border-card p-2"><BetaDeviceName localDeviceId={deviceId} deviceId={gap.origin_device_id}/><p>{gap.direction==='to_peer'?'本机 → 对方':'对方 → 本机'} · 保存位置 {gap.materialized_seq} · 可验证转发位置 {gap.available_seq??'尚未建立'}</p></div>)}</details>}
            <details className="text-xs text-muted"><summary className="cursor-pointer py-1">连接详情</summary><dl className="space-y-2 py-2"><div><dt>设备身份</dt><dd className="break-all font-mono">{peer.device_id}</dd></div><div><dt>身份指纹</dt><dd className="break-all font-mono">{peer.fingerprint_sha256}</dd></div>{peer.last_error_code && <div><dt>最近错误</dt><dd className="break-all">{peer.last_error_code}</dd></div>}{!!peer.endpoints.length && <div><dt>连接地址</dt><dd className="break-all">{peer.endpoints.join('、')}</dd></div>}</dl>
              <Button variant="outline" size="sm" disabled={!!operation || !!statusError || !!copyingInvitationId} onClick={() => void perform('replace', async life => { const result = await peers.createInvitation(profileId, peer.device_id); if (isCurrent(life)) publishInvitation(life,result); })}>重新授权此设备</Button>
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
