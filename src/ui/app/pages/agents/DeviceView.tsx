import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Link2, Monitor, ShieldCheck, Wifi } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import type { AgentDeviceGroup, RuntimeServiceStatus } from '@/lib/types/agent-hub';
import {
  resolveTopologyDevice,
  resolveTopologyHostId,
  resolveTopologyRuntimeHost,
} from '@/lib/types/runtime-topology';
import type { RuntimeDeviceSnapshot, RuntimeHostSnapshot } from '@/services/runtime-manager';
import {
  DEFAULT_EXTERNAL_RUNTIME_PORT,
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  type EmbeddedRuntimeNetworkMode,
  type RuntimeTargetMode,
} from '@/config/runtime-target';
import {
  formatHostMemory,
  formatHostUptime,
  getHostStatusBadgeClass,
  getEmbeddedRuntimeModeLabel,
  getDeviceTypeIcon,
} from './agents-utils';

export interface DeviceViewProps {
  groups: AgentDeviceGroup[];
  runtimeDeviceSnapshots: RuntimeDeviceSnapshot[];
  runtimeHostSnapshots: RuntimeHostSnapshot[];
  runtimeServiceStatus: RuntimeServiceStatus | null;
  peerConnectivityDrafts: Record<string, boolean>;
  peerConnectivityPendingHostIds: string[];
  syncAutomationEnabled: boolean;
  runtimeHostError: string;
  embeddedRuntimeNetworkMode: EmbeddedRuntimeNetworkMode;
  embeddedRuntimeBindAddress: string;
  runtimeNeedsRebind: boolean;
  runtimeTargetMode: RuntimeTargetMode;
  runtimeTargetAddress: string;
  runtimeTargetError: string;
  runtimeExternalAddressDraft: string;
  runtimeExternalAuthTokenDraft: string;
  onSyncAutomationEnabledChange: (enabled: boolean) => Promise<void>;
  onRuntimeHostProbe: (hostId: string) => Promise<void>;
  onVerifyPeer: (hostId: string) => Promise<void>;
  onTogglePeerConnectivity: (hostId: string, enabled: boolean) => Promise<void>;
  onEmbeddedRuntimeNetworkModeChange: (mode: EmbeddedRuntimeNetworkMode) => void;
  onRuntimeStart: () => Promise<void>;
  onRuntimeStop: () => Promise<void>;
  onRuntimeTargetModeChange: (mode: RuntimeTargetMode) => void;
  onRuntimeExternalAddressDraftChange: (value: string) => void;
  onRuntimeExternalAuthTokenDraftChange: (value: string) => void;
  onApplyRuntimeExternalAddress: () => void;
  onOpenHostManager: () => void;
  onOpenPeerPairing: () => void;
}

type DeviceViewSnapshot = RuntimeDeviceSnapshot & {
  primaryHostSnapshot?: RuntimeHostSnapshot;
};

function renderSectionSummary(count: number, label: string): string {
  if (count <= 0) {
    return `暂无${label}`;
  }
  return `${count} 个${label}`;
}

function formatVerificationTriggerLabel(trigger: string | undefined): string | null {
  if (trigger === 'pairing_auto') {
    return '自动配对';
  }
  if (trigger === 'manual_retry') {
    return '手动测试互联';
  }
  return null;
}

function formatVerificationTimeLabel(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new Date(value).toLocaleString('zh-CN', {
      hour12: false,
    });
  } catch {
    return value;
  }
}

function resolveVerificationPresentation(item: RuntimeHostSnapshot): {
  status: 'idle' | 'running' | 'verified' | 'failed';
  label: string;
  detail: string;
  toneClass: string;
} {
  const verificationStatus = item.host.verificationStatus ?? 'idle';

  if (verificationStatus === 'running') {
    return {
      status: 'running',
      label: '正在验证互通',
      detail: '正在执行链路验证协议，请等待双方结果返回。',
      toneClass: 'text-[#C75B3A]',
    };
  }

  if (verificationStatus === 'verified') {
    return {
      status: 'verified',
      label: '已验证互通',
      detail: '最近一次双向互通验证已完成，可继续发送业务信号。',
      toneClass: 'text-[#16A34A]',
    };
  }

  if (verificationStatus === 'failed') {
    return {
      status: 'failed',
      label: item.connectionState === 'online' ? '在线，但互通验证失败' : '离线，最近验证失败',
      detail: '请查看最近错误并重新执行测试互联。',
      toneClass: 'text-[#DC2626]',
    };
  }

  return {
    status: 'idle',
    label: '未验证互通',
    detail: '在线 ≠ 已验证',
    toneClass: 'text-[#B45309]',
  };
}

/** Reticulum mesh networking peer section. */
type ReticulumPeer = {
  host_id: string;
  node_name: string;
  port: number;
  online: boolean;
  last_seen_ms: number;
  identity_hex?: string;
  peer_id?: string;
  trust_state?: string;
  connection_state?: 'discovered' | 'connected_unauthorized' | 'connected_authorized' | 'trusted' | 'blocked';
  authorized?: boolean;
  rtt_ms?: number | null;
};

function ReticulumPeerSection({ runtimeBaseUrl }: { runtimeBaseUrl?: string }) {
  const [peers, setPeers] = useState<ReticulumPeer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pairingHostId, setPairingHostId] = useState<string | null>(null);
  const [unpairingHostId, setUnpairingHostId] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pinDialogPeerId, setPinDialogPeerId] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinDisplay, setPinDisplay] = useState<{ peerId: string; pin: string } | null>(null);
  const [status, setStatus] = useState<{
    mesh_enabled: boolean;
    announce_mode: 'off' | 'passive' | 'active';
    local_host_id: string;
    local_port: number;
    discovered_count: number;
    authorized_count: number;
    announce_period_ms: number;
  } | null>(null);
  const lastAnnounceTsRef = useRef(Date.now());
  const [interfaces, setInterfaces] = useState<{ name: string; active: boolean }[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!runtimeBaseUrl) return;
    mountedRef.current = true;

    // Initial fetch for peers list (one-shot)
    fetch(`${runtimeBaseUrl}/mesh/ret/peers`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (mountedRef.current) { setPeers(data); setError(null); } })
      .catch(() => {});

    // SSE for continuous state updates (graceful fallback if unavailable)
    let evtSource: EventSource | null = null;
    try {
      evtSource = new EventSource(`${runtimeBaseUrl}/mesh/ret/events`);
      evtSource.addEventListener('ret_mesh_snapshot', (e) => {
        if (!mountedRef.current) return;
        try {
          const { payload } = JSON.parse(e.data);
          if (payload.status) setStatus(payload.status);
          if (payload.peers) setPeers(payload.peers);
          if (payload.interfaces) setInterfaces(payload.interfaces);
        } catch { /* ignore malformed events */ }
      });
      evtSource.onerror = () => {
        if (mountedRef.current) setError('Reticulum SSE disconnected');
      };
    } catch {
      // EventSource not available (test environment, etc.)
    }

    return () => { mountedRef.current = false; evtSource?.close(); };
  }, [runtimeBaseUrl]);

  // Auto-close PIN display dialog when pairing completes (peer becomes authorized).
  useEffect(() => {
    if (!pinDisplay) return;
    const matched = peers.find((p) => {
      const pid = p.peer_id || p.identity_hex || p.host_id;
      return pid === pinDisplay.peerId && (p.authorized === true || p.connection_state === 'connected_authorized' || p.connection_state === 'trusted');
    });
    if (matched) {
      setPinDisplay(null);
    }
  }, [peers, pinDisplay]);

  // Local 1s tick for smooth countdown (no extra polling).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!runtimeBaseUrl) return;
    const t = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, [runtimeBaseUrl]);

  const updatePeerFromResponse = (updatedPeer: ReticulumPeer) => {
    setPeers((current) => current.map((peer) => {
      const peerIdentity = peer.peer_id || peer.identity_hex || peer.host_id;
      const updatedIdentity = updatedPeer.peer_id || updatedPeer.identity_hex || updatedPeer.host_id;
      return peerIdentity === updatedIdentity ? { ...peer, ...updatedPeer } : peer;
    }));
  };

  const handlePairPeer = async (hostId: string, pin: string) => {
    if (!runtimeBaseUrl || pairingHostId || unpairingHostId) return;
    setPairingHostId(hostId);
    setPairingError(null);
    try {
      const res = await fetch(`${runtimeBaseUrl}/mesh/ret/peers/${encodeURIComponent(hostId)}/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        throw new Error(`Reticulum pairing failed (${res.status})`);
      }
      const data = await res.json() as { peer_state?: ReticulumPeer; peer?: ReticulumPeer };
      const updatedPeer = data.peer_state ?? data.peer;
      if (mountedRef.current && updatedPeer) {
        updatePeerFromResponse(updatedPeer);
      }
    } catch (err) {
      if (mountedRef.current) {
        setPairingError(err instanceof Error ? err.message : 'Reticulum pairing failed');
      }
    } finally {
      if (mountedRef.current) {
        setPairingHostId(null);
      }
    }
  };

  const handleUnpairPeer = async (hostId: string) => {
    if (!runtimeBaseUrl || pairingHostId || unpairingHostId) return;
    setUnpairingHostId(hostId);
    setPairingError(null);
    try {
      const res = await fetch(`${runtimeBaseUrl}/mesh/ret/peers/${encodeURIComponent(hostId)}/pair`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(`Reticulum unpair failed (${res.status})`);
      }
      const data = await res.json() as { peer_state?: ReticulumPeer; peer?: ReticulumPeer };
      const updatedPeer = data.peer_state ?? data.peer;
      if (mountedRef.current && updatedPeer) {
        updatePeerFromResponse(updatedPeer);
      }
    } catch (err) {
      if (mountedRef.current) {
        setPairingError(err instanceof Error ? err.message : 'Reticulum unpair failed');
      }
    } finally {
      if (mountedRef.current) {
        setUnpairingHostId(null);
      }
    }
  };

  const handleInitiatePair = async (hostId: string) => {
    if (!runtimeBaseUrl || pairingHostId || unpairingHostId) return;
    setPairingHostId(hostId);
    setPairingError(null);
    try {
      const res = await fetch(`${runtimeBaseUrl}/mesh/ret/peers/${encodeURIComponent(hostId)}/initiate-pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        // If initiate fails (peer offline, etc.), fall back to PIN input dialog
        if (mountedRef.current) {
          setPinDialogPeerId(hostId);
        }
        return;
      }
      const data = await res.json() as { pin: string; peer_id: string };
      if (mountedRef.current && data.pin) {
        setPinDisplay({ peerId: hostId, pin: data.pin });
      }
    } catch (err) {
      if (mountedRef.current) {
        setPairingError(err instanceof Error ? err.message : 'Failed to initiate pairing');
        // Fall back to PIN input dialog on network error
        setPinDialogPeerId(hostId);
      }
    } finally {
      if (mountedRef.current) {
        setPairingHostId(null);
      }
    }
  };

  const handleAnnounceModeChange = async (newMode: 'off' | 'passive' | 'active') => {
    if (!runtimeBaseUrl) return;
    try {
      await fetch(`${runtimeBaseUrl}/mesh/ret/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch { /* SSE will correct on next tick */ }
  };

  if (error && peers.length === 0) return null;

  const meshActive = status?.mesh_enabled ?? false;
  const announcePeriodSec = status ? Math.round(status.announce_period_ms / 1000) : 10;
  const currentMode = status?.announce_mode ?? 'active';
  void tick; // trigger re-render every 1s for countdown
  const elapsedSec = Math.floor((Date.now() - lastAnnounceTsRef.current) / 1000);
  const nextAnnounceSec = Math.max(0, announcePeriodSec - (elapsedSec % announcePeriodSec));

  return (
    <article className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]">
      {/* ── Header — Status Dashboard ── */}
      <div className="flex items-start gap-2">
        <Wifi size={14} className={`mt-0.5 shrink-0 ${meshActive ? 'text-[#0D9488]' : 'text-[#A8A29E]'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              Reticulum 网络
            </h3>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              meshActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}>
              {meshActive ? '已启用' : '未启用'}
            </span>
            {meshActive && status && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                status.announce_mode === 'active' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' :
                status.announce_mode === 'passive' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                {status.announce_mode === 'active' ? `宣告 ${announcePeriodSec}s` :
                 status.announce_mode === 'passive' ? '隐匿 (仅收)' : '已关闭'}
              </span>
            )}
          </div>
          {meshActive && status && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
              <span>ID: {status.local_host_id.slice(0, 12)}</span>
              <span>RT:{status.local_port}</span>
              <span>已发现 {status.discovered_count}</span>
              <span>已授权 {status.authorized_count}</span>
              {status.announce_mode === 'active' && (
                <span>下次宣告 <span className="tabular-nums">{nextAnnounceSec}s</span></span>
              )}
            </div>
          )}
          {!meshActive && (
            <p className="text-[10px] text-[#A8A29E]">
              Reticulum 组网未启动
            </p>
          )}
        </div>
        {/* ── Connection Mode Selector — top-right ── */}
        {meshActive && (
          <div className="inline-flex rounded-lg border border-[#D6D3D1] bg-[#FAF7F5] dark:border-[#57534E] dark:bg-[#292524] overflow-hidden shrink-0">
            {(['off', 'passive', 'active'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={!runtimeBaseUrl}
                onClick={() => { void handleAnnounceModeChange(mode); }}
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  currentMode === mode
                    ? mode === 'active' ? 'bg-[#0D9488] text-white' :
                      mode === 'passive' ? 'bg-[#2563EB] text-white' :
                      'bg-[#57534E] text-white'
                    : 'text-[#78716C] dark:text-[#A8A29E] hover:bg-[#E7E5E4] dark:hover:bg-[#44403C]'
                }`}
              >
                {mode === 'active' ? '活动' : mode === 'passive' ? '隐匿' : '关闭'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Interfaces ── */}
      {(meshActive || interfaces.length > 0) && (
        <div className="rounded-xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="font-medium text-[#1C1917] dark:text-[#FAFAF9]">下层接口</span>
            <span className="text-[10px] text-[#A8A29E]">{interfaces.length} 个</span>
          </div>
          <div className="space-y-1">
            {interfaces.length === 0 ? (
              <div className="text-[10px] text-[#A8A29E]">无接口信息</div>
            ) : (
              interfaces.map((iface) => (
                <div key={iface.name} className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${iface.active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                  <span className="text-[#44403C] dark:text-[#D6D3D1]">{iface.name}</span>
                  <span className="ml-auto text-[10px] text-[#A8A29E]">{iface.active ? '运行中' : '未连接'}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Peer List ── */}
      {!meshActive && peers.length === 0 ? null : peers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
          等待 Reticulum 发现节点...
        </div>
      ) : (
        <div className="space-y-2">
          {pairingError && (
            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[11px] text-[#DC2626] dark:border-[#7F1D1D] dark:bg-[#2A1515] dark:text-[#FCA5A5]">
              {pairingError}
            </div>
          )}
          {peers.map((p) => {
            const peerIdentity = p.peer_id || p.identity_hex || p.host_id;
            const lastSeen = new Date(p.last_seen_ms).toLocaleTimeString('zh-CN', { hour12: false });
            const trustLabel = p.connection_state === 'connected_authorized' || p.trust_state === 'Paired' ? '已授权' :
              p.connection_state === 'trusted' || p.trust_state === 'Trusted' ? '可信' :
              p.connection_state === 'blocked' || p.trust_state === 'Blocked' ? '已屏蔽' :
              p.connection_state === 'connected_unauthorized' ? '已连接未授权' : '已发现';
            const trustColor = p.connection_state === 'connected_authorized' || p.trust_state === 'Paired' ? 'text-[#16A34A]' :
              p.connection_state === 'trusted' || p.trust_state === 'Trusted' ? 'text-[#2563EB]' :
              p.connection_state === 'connected_unauthorized' ? 'text-[#C75B3A]' : 'text-[#A8A29E]';
            const isAuthorized = p.authorized === true || p.connection_state === 'connected_authorized' || p.connection_state === 'trusted' || p.trust_state === 'Paired' || p.trust_state === 'Trusted';
            const isBlocked = p.connection_state === 'blocked' || p.trust_state === 'Blocked';
            const canPair = p.online && !isAuthorized && !isBlocked;
            const canUnpair = isAuthorized;
            const isPairing = pairingHostId === peerIdentity;
            const isUnpairing = unpairingHostId === peerIdentity;
            return (
              <div key={peerIdentity}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#E7E5E4] bg-[#FAFAF9] px-3 py-2 text-sm dark:border-[#292524] dark:bg-[#1C1917]"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${p.online ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <span className="text-[12px] text-[#44403C] dark:text-[#D6D3D1] break-all">
                      {p.host_id}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-[#A8A29E]">
                    <span>{p.node_name || 'ExoMind Runtime'}</span>
                    <span>·</span>
                    <span>RT {p.port}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] whitespace-nowrap flex items-center gap-1">
                    <span className={trustColor}>{trustLabel}</span>
                    <span className="text-[#A8A29E]">·</span>
                    {p.rtt_ms != null && (
                      <><span className="text-[#A8A29E]">{p.rtt_ms}ms</span><span className="text-[#A8A29E]">·</span></>
                    )}
                    <span className="text-[#A8A29E]">{p.online ? '在线' : '离线'}</span>
                    <span className="text-[#A8A29E]">· {lastSeen}</span>
                  </span>
                  {canPair && (
                    <button
                      type="button"
                      data-testid={`reticulum-peer-pair-${peerIdentity}`}
                      onClick={() => { void handleInitiatePair(peerIdentity); }}
                      disabled={isPairing || pairingHostId !== null || unpairingHostId !== null}
                      className="rounded-lg bg-[#0D9488] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isPairing ? '授权中' : '授权'}
                    </button>
                  )}
                  {canUnpair && (
                    <button
                      type="button"
                      data-testid={`reticulum-peer-unpair-${peerIdentity}`}
                      onClick={() => void handleUnpairPeer(peerIdentity)}
                      disabled={isUnpairing || pairingHostId !== null || unpairingHostId !== null}
                      className="rounded-lg border border-[#D6D3D1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#78716C] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#57534E] dark:bg-[#292524] dark:text-[#D6D3D1]"
                    >
                      {isUnpairing ? '撤销中' : '撤销授权'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── PIN Display Dialog (Initiator) ── */}
      {pinDisplay != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-xl dark:bg-[#1C1917]">
            <h4 className="mb-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              配对码
            </h4>
            <p className="mb-4 text-xs text-[#A8A29E]">
              在另一台设备上点击「授权」，然后输入此配对码
            </p>
            <div className="mb-4 flex justify-center gap-2">
              {pinDisplay.pin.split('').map((digit, i) => (
                <div
                  key={i}
                  className="flex h-14 w-11 items-center justify-center rounded-xl border-2 border-[#C75B3A] bg-[#FAF7F5] text-2xl font-bold tabular-nums text-[#1C1917] dark:bg-[#292524] dark:text-[#FAFAF9]"
                >
                  {digit}
                </div>
              ))}
            </div>
            <div className="mb-4 flex items-center justify-center gap-2 text-xs text-[#A8A29E]">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              等待对方输入配对码...
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const peerId = pinDisplay.peerId;
                  setPinDisplay(null);
                  setPinInput('');
                  setPinDialogPeerId(peerId);
                }}
                className="w-full rounded-lg border border-[#D6D3D1] bg-white px-3 py-2 text-xs font-semibold text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#57534E] dark:bg-[#292524] dark:text-[#D6D3D1] dark:hover:bg-[#44403C]"
              >
                我已在他方看到配对码 → 输入配对码
              </button>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setPinDisplay(null)}
                  className="text-xs text-[#A8A29E] hover:text-[#78716C] dark:hover:text-[#D6D3D1]"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PIN Input Dialog (Responder) ── */}
      {pinDialogPeerId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-2xl bg-white p-6 shadow-xl dark:bg-[#1C1917]">
            <h4 className="mb-1 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              输入 Reticulum PIN
            </h4>
            <p className="mb-4 text-xs text-[#A8A29E]">
              请在对方设备上查看 PIN 码，然后输入到此处
            </p>
            <div className="mb-4 flex justify-center gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <input
                  key={i}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={pinInput[i] ?? ''}
                  onChange={(e) => {
                    const digit = e.target.value.replace(/[^0-9]/g, '').slice(-1);
                    const chars = pinInput.split('');
                    while (chars.length < 6) chars.push('');
                    chars[i] = digit;
                    setPinInput(chars.join('').slice(0, 6));
                    if (digit && i < 5) {
                      const inputs = document.querySelectorAll<HTMLInputElement>('[data-pin-index]');
                      inputs[i + 1]?.focus();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !pinInput[i] && i > 0) {
                      const inputs = document.querySelectorAll<HTMLInputElement>('[data-pin-index]');
                      inputs[i - 1]?.focus();
                    }
                  }}
                  data-pin-index={i}
                  className="h-12 w-10 rounded-xl border border-[#F0ECE8] bg-white text-center text-xl font-bold tabular-nums text-[#1C1917] outline-none focus:border-[#C75B3A] focus:ring-1 focus:ring-[#C75B3A] dark:border-[#292524] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
                />
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setPinDialogPeerId(null); setPinInput(''); }}
                className="rounded-xl border border-[#F0ECE8] px-4 py-2 text-xs font-medium text-[#78716C] hover:bg-[#FAF7F5] dark:border-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={pinInput.length !== 6}
                onClick={() => {
                  const hostId = pinDialogPeerId;
                  const pin = pinInput;
                  setPinDialogPeerId(null);
                  setPinInput('');
                  void handlePairPeer(hostId, pin);
                }}
                className="rounded-xl bg-[#0D9488] px-4 py-2 text-xs font-medium text-white hover:bg-[#0F7666] disabled:cursor-not-allowed disabled:opacity-40"
              >
                确认配对
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export function DeviceView({
  groups,
  runtimeDeviceSnapshots,
  runtimeHostSnapshots,
  runtimeServiceStatus,
  peerConnectivityDrafts,
  peerConnectivityPendingHostIds,
  syncAutomationEnabled,
  runtimeHostError,
  embeddedRuntimeNetworkMode,
  embeddedRuntimeBindAddress,
  runtimeNeedsRebind,
  runtimeTargetMode,
  runtimeTargetAddress,
  runtimeTargetError,
  runtimeExternalAddressDraft,
  runtimeExternalAuthTokenDraft,
  onSyncAutomationEnabledChange,
  onRuntimeHostProbe,
  onVerifyPeer,
  onTogglePeerConnectivity,
  onEmbeddedRuntimeNetworkModeChange,
  onRuntimeStart,
  onRuntimeStop,
  onRuntimeTargetModeChange,
  onRuntimeExternalAddressDraftChange,
  onRuntimeExternalAuthTokenDraftChange,
  onApplyRuntimeExternalAddress,
  onOpenHostManager,
  onOpenPeerPairing,
}: DeviceViewProps) {
  const displayDeviceSnapshots: DeviceViewSnapshot[] = runtimeDeviceSnapshots.length > 0
    ? runtimeDeviceSnapshots.map((device) => ({
        ...device,
        primaryHostSnapshot: device.hosts.find((item) => (
          resolveTopologyHostId(item.topology) === device.primaryRuntimeHostId
          || item.host.hostId === device.primaryRuntimeHostId
          || item.host.id === device.primaryRuntimeHostId
        )) ?? device.hosts[0],
      }))
    : runtimeHostSnapshots.map((item) => {
        const topologyDevice = resolveTopologyDevice(item.topology);
        const runtimeHostId = resolveTopologyHostId(item.topology) ?? item.host.hostId ?? item.host.id;
        return {
          id: topologyDevice?.id ?? item.host.deviceId ?? runtimeHostId,
          name: topologyDevice?.name ?? item.host.name,
          kind: topologyDevice?.kind ?? 'unknown',
          primaryRuntimeHostId: topologyDevice?.primary_runtime_host_id ?? runtimeHostId,
          connectionState: item.connectionState,
          hosts: [item],
          components: item.topology?.device_components ?? [],
          links: item.topology?.device_links ?? [],
          primaryHostSnapshot: item,
        };
      });
  const hostCard = groups.flatMap((group) => group.cards).find((card) => card.isHost) ?? groups[0]?.cards[0];
  const isEmbeddedTarget = runtimeTargetMode === 'embedded';
  const currentRuntimeAddress = runtimeServiceStatus?.running
    ? `${runtimeServiceStatus.host}:${runtimeServiceStatus.port}`
    : 'not running（未运行）';
  const lastAttemptAddress = runtimeServiceStatus && !runtimeServiceStatus.running
    ? `${runtimeServiceStatus.host}:${runtimeServiceStatus.port}`
    : null;
  const discoveredPeers = displayDeviceSnapshots.filter((item) => item.primaryHostSnapshot?.host.trustState === 'discovered_candidate');
  const confirmedPeers = displayDeviceSnapshots.filter((item) => item.primaryHostSnapshot?.host.trustState === 'confirmed_peer');
  const advancedHosts = displayDeviceSnapshots.filter((item) => (
    item.primaryHostSnapshot?.host.trustState !== 'discovered_candidate'
    && item.primaryHostSnapshot?.host.trustState !== 'confirmed_peer'
  ));
  const localNodeName = hostCard?.name ?? '当前设备';
  const localNodeSummary = runtimeServiceStatus?.running
    ? '内嵌 RT 已运行，可参与发现、配对与复制。'
    : '先启动内嵌 RT，再把这台设备加入你的 ExoMind-Net。';
  const localNodeId = runtimeServiceStatus?.hostId ?? 'pending（待登记）';
  const canOpenPeerPairing = Boolean(runtimeServiceStatus?.running);
  const canUsePeerPairing = canOpenPeerPairing && syncAutomationEnabled;
  const canVerifyConfirmedPeer = Boolean(runtimeServiceStatus?.running);
  const overviewGridClassName = hostCard
    ? 'grid gap-3 lg:grid-cols-2'
    : 'grid gap-3';

  const renderRuntimePeerCard = (
    item: DeviceViewSnapshot,
    mode: 'discovered' | 'confirmed' | 'advanced',
  ) => {
    const primaryHostSnapshot = item.primaryHostSnapshot ?? item.hosts[0];
    if (!primaryHostSnapshot) {
      return null;
    }
    const primaryHost = primaryHostSnapshot.host;
    const trustLabel = mode === 'confirmed'
      ? '已确认 peer'
      : mode === 'discovered'
        ? '待配对节点'
        : '兼容 / 手工节点';
    const addressText = primaryHost.lastSuccessfulDialAddress
      ?? primaryHost.manualOverride
      ?? `${primaryHost.host}:${primaryHost.port}`;
    const peerConnectivityDraft = mode === 'confirmed'
      ? peerConnectivityDrafts[primaryHost.id]
      : undefined;
    const effectiveMeshPeerEnabled = typeof peerConnectivityDraft === 'boolean'
      ? peerConnectivityDraft
      : primaryHost.meshPeerEnabled;
    const isPeerPaused = mode === 'confirmed' && effectiveMeshPeerEnabled === false;
    const isPeerConnectivityPending = mode === 'confirmed'
      && peerConnectivityPendingHostIds.includes(primaryHost.id);
    const replicationStatus = mode === 'confirmed'
      ? isPeerConnectivityPending
        ? isPeerPaused
          ? '暂停中...'
          : '恢复中...'
        : isPeerPaused
        ? '已暂停'
        : item.connectionState === 'online'
        ? '已连接'
        : item.connectionState === 'offline'
          ? '离线'
          : '异常 / 待重试'
      : null;
    const verificationPresentation = mode === 'confirmed'
      ? resolveVerificationPresentation(primaryHostSnapshot)
      : null;
    const verificationTriggerLabel = formatVerificationTriggerLabel(primaryHost.lastVerificationTrigger);
    const verificationTimeLabel = formatVerificationTimeLabel(primaryHost.lastVerifiedAt);
    const verifyButtonLabel = isPeerConnectivityPending
      ? '处理中...'
      : isPeerPaused
      ? '已暂停'
      : verificationPresentation?.status === 'running'
        ? '验证中...'
        : '测试互联';
    const topologyRuntimeHost = resolveTopologyRuntimeHost(primaryHostSnapshot.topology);
    const topologyHostId = resolveTopologyHostId(primaryHostSnapshot.topology);

    return (
      <div
        key={item.id}
        data-testid={`runtime-host-device-card-${primaryHost.id}`}
        className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2.5 dark:border-[#292524] dark:bg-[#292524]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0D948820] text-[#0D9488]">
                <Monitor size={13} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{item.name}</p>
                <p className="truncate text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                  {primaryHost.host}:{primaryHost.port}
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
              <span className="rounded bg-white px-1.5 py-0.5 dark:bg-[#1C1917]">{trustLabel}</span>
              <span>dial: {addressText}</span>
              <span>device_id: {item.id}</span>
              {topologyHostId && <span>host_id: {topologyHostId}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              data-testid={`runtime-host-status-${primaryHost.id}`}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getHostStatusBadgeClass(item.connectionState)}`}
            >
              {item.connectionState}
            </span>
            <button
              type="button"
              data-testid={`runtime-host-probe-${primaryHost.id}`}
              onClick={() => {
                void onRuntimeHostProbe(primaryHost.id);
              }}
              className="rounded bg-[#F5F0ED] px-2 py-1 text-[10px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]"
            >
              重试
            </button>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">设备名称</p>
            <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
              {item.name}
            </p>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">系统</p>
            <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
              {topologyRuntimeHost?.os ?? '--'}
            </p>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">设备类型</p>
            <p className="truncate text-[11px] font-medium capitalize text-[#1C1917] dark:text-[#FAFAF9]">
              {item.kind}
            </p>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">宿主 / 部件</p>
            <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
              {item.hosts.length} / {item.components.length}
            </p>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">延迟</p>
            <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
              {primaryHostSnapshot.latencyMs ? `${primaryHostSnapshot.latencyMs} ms` : '--'}
            </p>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">在线时长</p>
            <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
              {formatHostUptime(topologyRuntimeHost?.uptime_secs)}
            </p>
          </div>
        </div>

        {replicationStatus && (
          <div className="mt-2 rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">复制状态</p>
            <p className="text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">{replicationStatus}</p>
          </div>
        )}

        {verificationPresentation && (
          <div
            data-testid={`runtime-host-verification-panel-${primaryHost.id}`}
            className="mt-2 rounded-lg border border-[#D6D3D1] bg-white px-2 py-2 dark:border-[#44403C] dark:bg-[#1C1917]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-[#A8A29E]">互通验证</p>
                <p
                  data-testid={`runtime-host-verification-status-${primaryHost.id}`}
                  className={`text-[11px] font-semibold ${verificationPresentation.toneClass}`}
                >
                  {verificationPresentation.label}
                </p>
                <p className="mt-0.5 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                  {isPeerConnectivityPending
                    ? '正在更新连通状态，请稍候。'
                    : isPeerPaused
                      ? '当前节点已暂停连通。恢复后再执行测试互联。'
                      : verificationPresentation.detail}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex items-center gap-1.5 rounded-md bg-[#FAF7F5] px-2 py-1 dark:bg-[#292524]">
                  <span className="text-[10px] text-[#78716C] dark:text-[#A8A29E]">连通</span>
                  <Switch
                    aria-label={`${item.name} 连通开关`}
                    checked={!isPeerPaused}
                    disabled={!canVerifyConfirmedPeer || isPeerConnectivityPending}
                    data-testid={`runtime-host-peer-toggle-${primaryHost.id}`}
                    onCheckedChange={(checked: boolean) => {
                      void onTogglePeerConnectivity(primaryHost.id, checked);
                    }}
                  />
                </div>
                <button
                  type="button"
                  data-testid={`runtime-host-verify-${primaryHost.id}`}
                  onClick={() => {
                    void onVerifyPeer(primaryHost.id);
                  }}
                  disabled={
                    !canVerifyConfirmedPeer
                    || isPeerConnectivityPending
                    || verificationPresentation.status === 'running'
                    || isPeerPaused
                  }
                  className="rounded bg-[#0D9488] px-2 py-1 text-[10px] text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {verifyButtonLabel}
                </button>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-md bg-[#FAF7F5] px-2 py-1 dark:bg-[#292524]">
                <p
                  data-testid={`runtime-host-local-rtt-${primaryHost.id}`}
                  className="text-[10px] font-medium text-[#1C1917] dark:text-[#FAFAF9]"
                >
                  {typeof primaryHost.localInitiatedRttMs === 'number'
                    ? `本端 RTT ${primaryHost.localInitiatedRttMs} ms`
                    : '本端 RTT --'}
                </p>
              </div>
              <div className="rounded-md bg-[#FAF7F5] px-2 py-1 dark:bg-[#292524]">
                <p
                  data-testid={`runtime-host-peer-rtt-${primaryHost.id}`}
                  className="text-[10px] font-medium text-[#1C1917] dark:text-[#FAFAF9]"
                >
                  {typeof primaryHost.peerInitiatedRttMs === 'number'
                    ? `对端 RTT ${primaryHost.peerInitiatedRttMs} ms`
                    : '对端 RTT --'}
                </p>
              </div>
            </div>

            {(verificationTriggerLabel || verificationTimeLabel) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                {verificationTriggerLabel && <span>触发：{verificationTriggerLabel}</span>}
                {verificationTimeLabel && <span>最近验证：{verificationTimeLabel}</span>}
              </div>
            )}

            {primaryHost.lastVerificationError && verificationPresentation.status === 'failed' && (
              <p
                data-testid={`runtime-host-verification-error-${primaryHost.id}`}
                className="mt-2 text-[10px] text-[#DC2626]"
              >
                {primaryHost.lastVerificationError}
              </p>
            )}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
          <span>runtime: {topologyRuntimeHost?.version ?? '--'}</span>
          <span>links: {item.links.length}</span>
          <span>memory: {formatHostMemory(topologyRuntimeHost?.used_memory_mb, topologyRuntimeHost?.total_memory_mb)}</span>
        </div>

        {primaryHost.lastCheckedAt && (
          <p className="mt-1 text-[10px] text-[#A8A29E]">last: {primaryHost.lastCheckedAt}</p>
        )}
        {primaryHostSnapshot.error && (
          <p className="mt-1 text-[10px] text-[#DC2626]">{primaryHostSnapshot.error}</p>
        )}
      </div>
    );
  };

  return (
    <section data-testid="agent-device-view" className="space-y-4">
      <article className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">设备网络视图</h3>
            <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">{localNodeSummary}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="inline-flex items-center gap-2 rounded-lg border border-[#E7E5E4] bg-[#FAF7F5] px-2.5 py-1 dark:border-[#292524] dark:bg-[#292524]">
              <span className="text-[11px] font-medium text-[#57534E] dark:text-[#D6D3D1]">
                自动配对/同步
              </span>
              <Switch
                aria-label="自动配对与自动同步"
                checked={syncAutomationEnabled}
                data-testid="device-sync-automation-switch"
                onCheckedChange={(checked: boolean) => {
                  void onSyncAutomationEnabledChange(checked);
                }}
              />
            </div>
            <button
              type="button"
              data-testid="device-open-peer-pairing"
              onClick={onOpenPeerPairing}
              disabled={!canUsePeerPairing}
              title={!syncAutomationEnabled ? '自动配对/同步已关闭，暂不可发起设备配对。' : undefined}
              className="inline-flex items-center gap-1 rounded-lg bg-[#0D9488] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Link2 size={13} />
              设备配对
            </button>
          </div>
        </div>

        <div data-testid="runtime-device-overview-grid" className={overviewGridClassName}>
          <div className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-3 dark:border-[#292524] dark:bg-[#292524]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{localNodeName}</p>
                <p className="mt-0.5 text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                  node id: <span data-testid="runtime-local-host-id">{localNodeId}</span>
                </p>
              </div>
              <span
                data-testid="runtime-local-status"
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  runtimeServiceStatus?.running
                    ? 'bg-[#22C55E20] text-[#16A34A]'
                    : 'bg-[#E7E5E4] text-[#57534E]'
                }`}
              >
                {runtimeServiceStatus?.running ? 'running' : 'stopped'}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
                <p className="text-[10px] text-[#A8A29E]">当前运行</p>
                <p data-testid="runtime-current-address" className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                  {currentRuntimeAddress}
                </p>
              </div>
              <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
                <p className="text-[10px] text-[#A8A29E]">目标监听</p>
                <p data-testid="runtime-local-bind-address" className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                  {embeddedRuntimeBindAddress}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-lg bg-white p-2 dark:bg-[#1C1917]">
              <div className="flex items-center gap-2">
                <Wifi size={14} className="text-[#0D9488]" />
                <div>
                  <p className="text-[10px] font-medium text-[#44403C] dark:text-[#E7E5E4]">节点可达性（Bind mode）</p>
                  <p className="text-[10px] text-[#A8A29E]">
                    {embeddedRuntimeNetworkMode === 'lan'
                      ? '允许其他设备发现并访问这台节点'
                      : '仅当前设备可访问这台内嵌节点'}
                  </p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  data-testid="runtime-network-mode-local"
                  aria-pressed={embeddedRuntimeNetworkMode === 'local'}
                  onClick={() => onEmbeddedRuntimeNetworkModeChange('local')}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    embeddedRuntimeNetworkMode === 'local'
                      ? 'bg-[#0D948820] text-[#0D9488]'
                      : 'text-[#78716C] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]'
                  }`}
                >
                  仅本机
                </button>
                <button
                  type="button"
                  data-testid="runtime-network-mode-lan"
                  aria-pressed={embeddedRuntimeNetworkMode === 'lan'}
                  onClick={() => onEmbeddedRuntimeNetworkModeChange('lan')}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    embeddedRuntimeNetworkMode === 'lan'
                      ? 'bg-[#C75B3A20] text-[#C75B3A]'
                      : 'text-[#78716C] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]'
                  }`}
                >
                  局域网
                </button>
              </div>
              <p data-testid="runtime-local-share-hint" className="mt-2 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                {embeddedRuntimeNetworkMode === 'lan'
                  ? 'LAN 模式会监听 0.0.0.0；其他设备可通过局域网 IP + 端口发现或连接。'
                  : 'Local only 模式只监听 127.0.0.1；其他设备无法直接连接。'}
              </p>
            </div>

            {lastAttemptAddress && (
              <p data-testid="runtime-last-attempt-address" className="mt-2 text-[10px] text-[#A8A29E]">
                最近尝试（Last attempted）：{lastAttemptAddress}
              </p>
            )}
            {runtimeServiceStatus?.pid && (
              <p className="mt-1 text-[10px] text-[#A8A29E]">pid: {runtimeServiceStatus.pid}</p>
            )}
            {runtimeNeedsRebind && (
              <p
                data-testid="runtime-local-rebind-hint"
                className="mt-2 rounded-md bg-[#C75B3A10] px-2 py-1 text-[10px] text-[#C75B3A]"
              >
                当前正在运行的监听地址与 {getEmbeddedRuntimeModeLabel(embeddedRuntimeNetworkMode)} 不一致，点击 Start 会自动重启并切换到目标监听地址。
              </p>
            )}
            {runtimeServiceStatus?.error && (
              <p className="mt-2 text-[10px] text-[#DC2626]">{runtimeServiceStatus.error}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                data-testid="runtime-local-start-button"
                onClick={() => {
                  void onRuntimeStart();
                }}
                disabled={!isEmbeddedTarget}
                className="rounded bg-[#C75B3A] px-2 py-1 text-[10px] text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start
              </button>
              <button
                type="button"
                data-testid="runtime-local-stop-button"
                onClick={() => {
                  void onRuntimeStop();
                }}
                disabled={!isEmbeddedTarget}
                className="rounded bg-[#F5F0ED] px-2 py-1 text-[10px] text-[#57534E] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#292524] dark:text-[#D6D3D1]"
              >
                Stop
              </button>
            </div>
            {!isEmbeddedTarget && (
              <p className="mt-2 text-[10px] text-[#A8A29E]">
                当前正在使用兼容模式目标；Start/Stop 仍只控制本地内嵌 Runtime。
              </p>
            )}
          </div>

          {hostCard && (
            <article
              data-testid="agent-device-overview-card"
              className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-3 dark:border-[#292524] dark:bg-[#292524]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{hostCard.name}</p>
                  <p className="mt-0.5 text-xs text-[#A8A29E] dark:text-[#78716C]">{hostCard.summary}</p>
                </div>
                <span className="rounded bg-[#C75B3A15] px-2 py-0.5 text-[11px] text-[#C75B3A]">本机</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {hostCard.metrics.slice(0, 3).map((metric) => (
                  <div key={metric.label} className="rounded-lg bg-white px-2 py-1.5 text-center dark:bg-[#1C1917]">
                    <p className="text-[10px] text-[#A8A29E] dark:text-[#78716C]">{metric.label}</p>
                    <p className="text-[12px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{metric.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {hostCard.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-md px-2 py-0.5 text-[11px]"
                    style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            </article>
          )}
        </div>
      </article>

      <article
        data-testid="runtime-peer-section-discovered"
        className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]"
      >
        <div className="flex items-center gap-2">
          <Wifi size={14} className="text-[#0D9488]" />
          <div>
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">已发现节点</h3>
            <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">
              {renderSectionSummary(discoveredPeers.length, '待配对节点')}
            </p>
          </div>
        </div>
        {discoveredPeers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
            还没有发现候选节点。请先让其他设备启动 embedded RT，并把本机切到局域网模式。
          </div>
        ) : (
          <div className="space-y-2">
            {discoveredPeers.map((item) => renderRuntimePeerCard(item, 'discovered'))}
          </div>
        )}
      </article>

      {/* Reticulum mesh peers */}
      <ReticulumPeerSection runtimeBaseUrl={runtimeServiceStatus?.host ? `http://${runtimeServiceStatus.host}:${runtimeServiceStatus.port}` : undefined} />

      <article
        data-testid="runtime-peer-section-confirmed"
        className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-[#0D9488]" />
          <div>
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">已确认节点</h3>
            <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">
              {renderSectionSummary(confirmedPeers.length, '可信 peer')}
            </p>
          </div>
        </div>
        {confirmedPeers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
            还没有已确认节点。完成一次设备配对后，可信 peer 会出现在这里。
          </div>
        ) : (
          <div className="space-y-2">
            {confirmedPeers.map((item) => renderRuntimePeerCard(item, 'confirmed'))}
          </div>
        )}
      </article>

      <article
        data-testid="runtime-peer-section-advanced"
        className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]"
      >
        <div
          data-testid="runtime-host-panel"
          className="flex items-start justify-between gap-3 rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-3 dark:border-[#292524] dark:bg-[#292524]"
        >
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">高级 / 兼容模式</h3>
            <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">
              external RT、手工 host、兼容桥接与诊断入口统一放在这里。
            </p>
          </div>
          <button
            type="button"
            data-testid="runtime-host-manage-button"
            onClick={onOpenHostManager}
            className="rounded-lg bg-[#C75B3A] px-2.5 py-1 text-[11px] font-semibold text-white"
          >
            管理主机
          </button>
        </div>

        <div className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2 dark:border-[#292524] dark:bg-[#292524]">
          <div className="mb-2 rounded-lg bg-white p-1 dark:bg-[#1C1917]">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                data-testid="runtime-target-mode-embedded"
                aria-pressed={runtimeTargetMode === 'embedded'}
                onClick={() => onRuntimeTargetModeChange('embedded')}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  runtimeTargetMode === 'embedded'
                    ? 'bg-[#0D948820] text-[#0D9488]'
                    : 'text-[#78716C] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]'
                }`}
              >
                内嵌 RT（{DEFAULT_EMBEDDED_RUNTIME_PORT}）
              </button>
              <button
                type="button"
                data-testid="runtime-target-mode-external"
                aria-pressed={runtimeTargetMode === 'external'}
                onClick={() => onRuntimeTargetModeChange('external')}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  runtimeTargetMode === 'external'
                    ? 'bg-[#C75B3A20] text-[#C75B3A]'
                    : 'text-[#78716C] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]'
                }`}
              >
                外部 RT
              </button>
            </div>
          </div>

          <p className="text-[10px] text-[#78716C] dark:text-[#A8A29E]">
            当前链路（Active target）：<span data-testid="runtime-target-active-address">{runtimeTargetAddress}</span>
          </p>

          {!isEmbeddedTarget && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  data-testid="runtime-target-external-address-input"
                  value={runtimeExternalAddressDraft}
                  onChange={(event) => onRuntimeExternalAddressDraftChange(event.target.value)}
                  placeholder={`host:port（例如 127.0.0.1:${DEFAULT_EXTERNAL_RUNTIME_PORT}）`}
                  className="h-7 flex-1 rounded border border-[#E7E5E4] bg-white px-2 text-[11px] text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
                />
                <button
                  type="button"
                  data-testid="runtime-target-external-apply-button"
                  onClick={onApplyRuntimeExternalAddress}
                  className="rounded bg-[#C75B3A] px-2 py-1 text-[10px] text-white"
                >
                  应用
                </button>
              </div>
              <input
                data-testid="runtime-target-external-auth-token-input"
                type="password"
                value={runtimeExternalAuthTokenDraft}
                onChange={(event) => onRuntimeExternalAuthTokenDraftChange(event.target.value)}
                placeholder="Bearer Token（远端启用 EXOMIND_RT_SECRET 时必填）"
                className="h-7 w-full rounded border border-[#E7E5E4] bg-white px-2 text-[11px] text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              />
              <p className="text-[10px] text-[#A8A29E]">
                外部模式下，SSE / history / PTY / timeblock 发布都会走该地址；若远端开启 `EXOMIND_RT_SECRET`，这里要填写同一 token。
              </p>
            </div>
          )}

          {runtimeTargetError && (
            <p className="mt-2 rounded-md bg-[#EF444410] px-2 py-1 text-[10px] text-[#DC2626]">
              {runtimeTargetError}
            </p>
          )}
        </div>

        {runtimeHostError && (
          <p className="rounded-md bg-[#EF444410] px-2 py-1 text-[11px] text-[#DC2626]">{runtimeHostError}</p>
        )}

        {advancedHosts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
            暂无兼容模式节点。需要手工录入 host:port 或桥接旧链路时，再使用这里的入口。
          </div>
        ) : (
          <div className="space-y-2">
            {advancedHosts.map((item) => renderRuntimePeerCard(item, 'advanced'))}
          </div>
        )}
      </article>

      {groups.map((group) => (
        <article key={group.id} className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-[#78716C] dark:text-[#A8A29E]">{group.title}</h3>
            <span className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">{group.summary}</span>
          </div>
          <div className="space-y-2">
            {group.cards.map((card) => {
              const DeviceIcon = getDeviceTypeIcon(group.id);
              return (
                <div key={card.id} className="rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                        <DeviceIcon size={14} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{card.name}</p>
                        <p className="text-xs text-[#A8A29E] dark:text-[#78716C]">{card.summary}</p>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-[#D6D3D1] dark:text-[#57534E]" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {card.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="rounded-md px-2 py-0.5 text-[11px]"
                        style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </section>
  );
}
