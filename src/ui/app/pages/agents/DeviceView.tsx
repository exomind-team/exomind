import { ChevronRight, Copy, Link2, Monitor, RadioTower, ShieldCheck, Wifi } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast-hook';
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
  formatHostForUrl,
  type EmbeddedRuntimeNetworkMode,
  type RuntimeTargetMode,
} from '@/config/runtime-target';
import {
  getRuntimeEnsService,
  type EnsDeliverySnapshot,
  type EnsInterfaceTopology,
  type EnsInterfaceMedium,
  type EnsOperationSnapshot,
  type EnsPeerSnapshot,
  type EnsTransportSnapshot,
} from '@/lib/services/runtime-ens.service';
import { getClipboardService } from '@/lib/services/clipboard.service';
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

const ENS_TOPOLOGY_OPTIONS: EnsInterfaceTopology[] = ['off', 'passive', 'active'];

function isEnsTopology(value: unknown): value is EnsInterfaceTopology {
  return value === 'off' || value === 'passive' || value === 'active';
}

function formatEnsTopologyLabel(topology: EnsInterfaceTopology): string {
  if (topology === 'active') {
    return 'Active';
  }
  if (topology === 'passive') {
    return 'Passive';
  }
  return 'Off';
}

function formatOptionalEnsTopologyLabel(topology: EnsInterfaceTopology | null): string {
  return topology ? formatEnsTopologyLabel(topology) : '未知';
}

function isEnsHealthStatus(value: unknown): value is EnsTransportSnapshot['health']['status'] {
  return value === 'healthy' || value === 'degraded' || value === 'error' || value === 'disabled';
}

function formatEnsHealthLabel(status: EnsTransportSnapshot['health']['status'] | null): string {
  if (!status) {
    return '未知';
  }
  if (status === 'healthy') {
    return '健康';
  }
  if (status === 'degraded') {
    return '降级';
  }
  if (status === 'error') {
    return '错误';
  }
  return '未启用';
}

function ensTopologyDotClass(topology: EnsInterfaceTopology | null): string {
  if (topology === 'active') {
    return 'bg-[#16A34A]';
  }
  if (topology === 'passive') {
    return 'bg-[#2563EB]';
  }
  if (topology === 'off') {
    return 'bg-[#A8A29E]';
  }
  return 'bg-[#D6D3D1] dark:bg-[#57534E]';
}

function formatEnsOperationKindLabel(kind: EnsOperationSnapshot['kind']): string {
  if (kind === 'pairing_offer') {
    return '配对请求';
  }
  if (kind === 'pairing_response') {
    return '配对响应';
  }
  if (kind === 'pairing_complete') {
    return '配对完成';
  }
  return '配对取消';
}

function formatEnsOperationStatusLabel(status: EnsOperationSnapshot['status']): string {
  if (status === 'pending') {
    return '进行中';
  }
  if (status === 'completed') {
    return '已完成';
  }
  if (status === 'cancelled') {
    return '已取消';
  }
  if (status === 'failed') {
    return '失败';
  }
  return '已超时';
}

function ensOperationStatusClass(status: EnsOperationSnapshot['status']): string {
  if (status === 'completed') {
    return 'bg-[#22C55E20] text-[#16A34A]';
  }
  if (status === 'pending') {
    return 'bg-[#F59E0B20] text-[#B45309]';
  }
  if (status === 'failed' || status === 'timed_out') {
    return 'bg-[#EF444420] text-[#DC2626]';
  }
  return 'bg-[#E7E5E4] text-[#57534E] dark:bg-[#44403C] dark:text-[#D6D3D1]';
}

function formatEnsOperationDirectionLabel(direction: EnsOperationSnapshot['direction']): string {
  if (direction === 'inbound') {
    return '入站';
  }
  if (direction === 'outbound') {
    return '出站';
  }
  return '方向未知';
}

function isEnsDeliveryStatus(value: unknown): value is EnsDeliverySnapshot['status'] {
  return value === 'sent' || value === 'failed' || value === 'skipped';
}

function formatEnsDeliveryStatusLabel(status: EnsDeliverySnapshot['status'] | null): string {
  if (!status) {
    return '状态未知';
  }
  if (status === 'sent') {
    return '已记录';
  }
  if (status === 'failed') {
    return '失败';
  }
  return '已跳过';
}

function ensDeliveryStatusClass(status: EnsDeliverySnapshot['status'] | null): string {
  if (status === 'sent') {
    return 'bg-[#22C55E20] text-[#16A34A]';
  }
  if (status === 'failed') {
    return 'bg-[#EF444420] text-[#DC2626]';
  }
  return 'bg-[#E7E5E4] text-[#57534E] dark:bg-[#44403C] dark:text-[#D6D3D1]';
}

function ensDebugTestIdSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function formatReticulumIdentityPreview(identityHex: string): string {
  const normalized = identityHex.trim();
  if (!normalized || normalized === '--') {
    return '--';
  }
  if (normalized.length <= 24) {
    return normalized;
  }
  return `${normalized.slice(0, 12)}...${normalized.slice(-8)}`;
}

function formatEnsPeerName(peer: EnsPeerSnapshot): string {
  return peer.identity.display_name
    ?? peer.identity.host_id
    ?? peer.endpoint?.host_id
    ?? peer.identity.identity_hex;
}

function getEnsPeerPairingFacts(peer: EnsPeerSnapshot): { authorized: boolean; pairingPending: boolean } | null {
  if (typeof peer.authorized !== 'boolean' || typeof peer.pairing_pending !== 'boolean') {
    return null;
  }

  return {
    authorized: peer.authorized,
    pairingPending: peer.pairing_pending,
  };
}

function ensPeerPairingStatusClass(
  facts: { authorized: boolean; pairingPending: boolean } | null,
): string {
  if (!facts) {
    return 'bg-[#E7E5E4] text-[#57534E] dark:bg-[#44403C] dark:text-[#D6D3D1]';
  }
  if (facts.authorized) {
    return 'bg-[#22C55E20] text-[#16A34A]';
  }
  if (facts.pairingPending) {
    return 'bg-[#F59E0B20] text-[#B45309]';
  }
  return 'bg-[#E7E5E4] text-[#57534E] dark:bg-[#44403C] dark:text-[#D6D3D1]';
}

function formatEnsPeerPairingStatus(
  facts: { authorized: boolean; pairingPending: boolean } | null,
): string {
  if (!facts) {
    return '状态未知';
  }
  if (facts.authorized) {
    return '已授权';
  }
  return facts.pairingPending ? '配对中' : '待配对';
}

function formatEnsInterfaceMediumLabel(medium: EnsInterfaceMedium | undefined): string {
  if (medium === 'local_dev') {
    return 'local-dev';
  }
  return medium ? medium.toUpperCase() : '';
}

function formatEnsEndpointRoute(peer: EnsPeerSnapshot): string {
  const endpoint = peer.endpoint;
  if (!endpoint) {
    return 'no endpoint';
  }

  const gateway = endpoint.gateway === 'reticulum' ? 'Reticulum' : endpoint.gateway;
  const medium = endpoint.via_medium ? formatEnsInterfaceMediumLabel(endpoint.via_medium) : null;
  const via = [
    endpoint.via_interface,
    medium,
  ].filter(Boolean).join(' / ');
  const route = via ? `${gateway} via ${via}` : gateway;
  const address = endpoint.interface_address ?? endpoint.reticulum_destination ?? endpoint.runtime_base_url;

  return address ? `${route} · ${address}` : route;
}

function resolveRuntimeBaseUrl(status: RuntimeServiceStatus | null): string | null {
  if (!status?.running || !status.port) {
    return null;
  }
  const host = status.host === '0.0.0.0' ? '127.0.0.1' : status.host;
  return `http://${formatHostForUrl(host)}:${status.port}`;
}

function ReticulumDebugPanel({
  runtimeServiceStatus,
}: {
  runtimeServiceStatus: RuntimeServiceStatus | null;
}) {
  const runtimeBaseUrl = useMemo(
    () => resolveRuntimeBaseUrl(runtimeServiceStatus),
    [runtimeServiceStatus],
  );
  const [snapshot, setSnapshot] = useState<EnsTransportSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [operationPins, setOperationPins] = useState<Record<string, string>>({});
  const ensService = useMemo(() => getRuntimeEnsService(), []);

  const refresh = useCallback(async () => {
    if (!runtimeBaseUrl) {
      setSnapshot(null);
      setError(null);
      setIsRefreshing(false);
      return;
    }

    setIsRefreshing(true);
    try {
      const nextSnapshot = await ensService.getSnapshot(runtimeBaseUrl);
      setSnapshot(nextSnapshot);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Reticulum 状态读取失败');
    } finally {
      setIsRefreshing(false);
    }
  }, [ensService, runtimeBaseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSetInterfaceTopology = async (
    interfaceName: string,
    topology: EnsInterfaceTopology,
  ) => {
    if (!runtimeBaseUrl) {
      return;
    }
    setPendingKey(`interface:${interfaceName}`);
    try {
      await ensService.setInterfaceTopology(runtimeBaseUrl, interfaceName, topology);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Reticulum 接口状态更新失败');
    } finally {
      setPendingKey(null);
    }
  };

  const handleSetGlobalTopology = async (topology: EnsInterfaceTopology) => {
    if (!runtimeBaseUrl) {
      return;
    }
    setPendingKey('global-topology');
    try {
      await ensService.setGlobalTopology(runtimeBaseUrl, topology);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Reticulum 全局接口状态更新失败');
    } finally {
      setPendingKey(null);
    }
  };

  const handleInitiatePairing = async (identityHex: string) => {
    if (!runtimeBaseUrl) {
      return;
    }
    setPendingKey(`pair:${identityHex}`);
    try {
      await ensService.initiatePairingWithDiscoveredPeer(runtimeBaseUrl, identityHex);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Reticulum 配对发起失败');
    } finally {
      setPendingKey(null);
    }
  };

  const handleRefreshPairingOperation = async (operationId: string) => {
    if (!runtimeBaseUrl) {
      return;
    }
    setPendingKey(`operation-status:${operationId}`);
    try {
      await ensService.getPairingOperationStatus(runtimeBaseUrl, operationId);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Reticulum 配对状态读取失败');
    } finally {
      setPendingKey(null);
    }
  };

  const handleAcceptPairingOperation = async (operationId: string) => {
    if (!runtimeBaseUrl) {
      return;
    }
    const pin = operationPins[operationId]?.trim() ?? '';
    if (!pin) {
      setError('请输入 Reticulum 配对 PIN');
      return;
    }

    setPendingKey(`operation-accept:${operationId}`);
    try {
      await ensService.acceptPairingOperation(runtimeBaseUrl, operationId, pin);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Reticulum 配对接受失败');
    } finally {
      setPendingKey(null);
    }
  };

  const handleCancelPairingOperation = async (operationId: string) => {
    if (!runtimeBaseUrl) {
      return;
    }
    setPendingKey(`operation-cancel:${operationId}`);
    try {
      await ensService.cancelPairingOperation(
        runtimeBaseUrl,
        operationId,
        'cancelled from DeviceView Reticulum debug panel',
      );
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Reticulum 配对取消失败');
    } finally {
      setPendingKey(null);
    }
  };

  const interfaces = Array.isArray(snapshot?.interfaces) ? snapshot.interfaces : [];
  const peers = Array.isArray(snapshot?.peers) ? snapshot.peers : [];
  const operations = Array.isArray(snapshot?.operations) ? snapshot.operations : [];
  const deliveries = Array.isArray(snapshot?.deliveries) ? snapshot.deliveries : [];
  const healthStatus = isEnsHealthStatus(snapshot?.health?.status) ? snapshot.health.status : null;
  const globalTopology = isEnsTopology(snapshot?.global_topology) ? snapshot.global_topology : null;
  const localIdentityHex = snapshot?.local_identity?.identity_hex ?? snapshot?.local_endpoint?.identity_hex ?? '--';
  const localIdentityPreview = formatReticulumIdentityPreview(localIdentityHex);
  const canCopyLocalIdentity = localIdentityPreview !== '--';
  const authorizedPeers = peers.filter((peer) => getEnsPeerPairingFacts(peer)?.authorized === true);
  const pairingPeers = peers.filter((peer) => {
    const facts = getEnsPeerPairingFacts(peer);
    return facts?.authorized === false && facts.pairingPending;
  });
  const pairablePeers = peers.filter((peer) => {
    const facts = getEnsPeerPairingFacts(peer);
    return facts?.authorized === false && !facts.pairingPending;
  });
  const unknownPairingPeers = peers.filter((peer) => !getEnsPeerPairingFacts(peer));
  const lastConfirmedAt = snapshot?.updated_at ?? null;
  const isStale = Boolean(error && snapshot);

  const handleCopyLocalIdentity = useCallback(async () => {
    if (!canCopyLocalIdentity) {
      return;
    }

    const result = await getClipboardService().writeText(localIdentityHex);
    if (result.ok) {
      toast({ title: '已复制本机身份' });
      return;
    }

    toast({
      title: result.title,
      description: result.description,
      variant: 'destructive',
    });
  }, [canCopyLocalIdentity, localIdentityHex]);

  return (
    <article
      data-testid="reticulum-debug-panel"
      className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <RadioTower size={14} className="mt-0.5 text-[#0D9488]" />
          <div>
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">Reticulum 调试</h3>
            <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">
              ENS provider、接口 topology 与发现节点状态。
            </p>
          </div>
        </div>
        <button
          type="button"
          data-testid="reticulum-refresh-button"
          onClick={() => {
            void refresh();
          }}
          disabled={!runtimeBaseUrl || isRefreshing}
          className="rounded-lg bg-[#F5F0ED] px-2.5 py-1 text-[11px] font-semibold text-[#57534E] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#292524] dark:text-[#D6D3D1]"
        >
          {isRefreshing ? '刷新中' : '刷新'}
        </button>
      </div>

      {!runtimeBaseUrl ? (
        <div className="rounded-xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
          启动本地 embedded RT 后，这里会显示 Reticulum/ENS 调试状态。
        </div>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-4">
            <div className="rounded-xl bg-[#FAF7F5] px-3 py-2 dark:bg-[#292524]">
              <p className="text-[10px] text-[#A8A29E]">Provider</p>
              <p data-testid="reticulum-provider-id" className="truncate text-[12px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                {snapshot?.provider_id ?? '--'}
              </p>
            </div>
            <div className="rounded-xl bg-[#FAF7F5] px-3 py-2 dark:bg-[#292524]">
              <p className="text-[10px] text-[#A8A29E]">健康状态</p>
              <p data-testid="reticulum-health-status" className="text-[12px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                {formatEnsHealthLabel(healthStatus)}
              </p>
            </div>
            <div
              data-testid="reticulum-local-identity"
              title={canCopyLocalIdentity ? localIdentityHex : undefined}
              className="rounded-xl bg-[#FAF7F5] px-3 py-2 dark:bg-[#292524]"
            >
              <p className="text-[10px] text-[#A8A29E]">本机身份</p>
              <button
                type="button"
                data-testid="reticulum-local-identity-copy"
                title={canCopyLocalIdentity ? localIdentityHex : undefined}
                aria-label={canCopyLocalIdentity ? '复制本机 Reticulum 身份 ID' : '本机 Reticulum 身份 ID 未就绪'}
                onClick={() => {
                  void handleCopyLocalIdentity();
                }}
                disabled={!canCopyLocalIdentity}
                className="mt-1 flex w-full min-w-0 items-center gap-1 rounded-md text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span
                  data-testid="reticulum-local-identity-id"
                  className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]"
                >
                  {localIdentityPreview}
                </span>
                {canCopyLocalIdentity && <Copy size={12} className="shrink-0 text-[#A8A29E]" aria-hidden="true" />}
              </button>
            </div>
            <div className="rounded-xl bg-[#FAF7F5] px-3 py-2 dark:bg-[#292524]">
              <p className="text-[10px] text-[#A8A29E]">节点</p>
              <p className="text-[12px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
                {authorizedPeers.length} 已授权 / {pairingPeers.length} 配对中 / {pairablePeers.length} 待配对
                {unknownPairingPeers.length > 0 ? ` / ${unknownPairingPeers.length} 状态未知` : ''}
              </p>
            </div>
          </div>

          {snapshot?.health?.message && (
            <p className="rounded-md bg-[#F5F0ED] px-2 py-1 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
              {snapshot.health.message}
            </p>
          )}

          {lastConfirmedAt && (
            <p
              data-testid="reticulum-last-confirmed-at"
              className="rounded-md bg-[#F5F0ED] px-2 py-1 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
            >
              最后确认：{lastConfirmedAt}
            </p>
          )}

          {isStale && (
            <p
              data-testid="reticulum-stale-snapshot"
              className="rounded-md bg-[#F59E0B10] px-2 py-1 text-[10px] text-[#B45309] dark:text-[#FBBF24]"
            >
              刷新失败，保留上一份后端快照；当前显示可能滞后于 Reticulum runtime。
            </p>
          )}

          <div className="space-y-2 rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-3 dark:border-[#292524] dark:bg-[#292524]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">接口 topology</p>
                <p className="text-[10px] text-[#A8A29E]">
                  全局上限与单接口配置取较小值后生效。
                </p>
              </div>
              <div className="inline-flex overflow-hidden rounded-lg border border-[#D6D3D1] bg-white dark:border-[#57534E] dark:bg-[#1C1917]">
                {ENS_TOPOLOGY_OPTIONS.map((topology) => (
                  <button
                    key={topology}
                    type="button"
                    data-testid={`reticulum-global-topology-${topology}`}
                    aria-pressed={globalTopology === topology}
                    onClick={() => {
                      void handleSetGlobalTopology(topology);
                    }}
                    disabled={!snapshot || !globalTopology || pendingKey === 'global-topology'}
                    className={`px-2 py-1 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                      globalTopology === topology
                        ? topology === 'active'
                          ? 'bg-[#0D9488] text-white'
                          : topology === 'passive'
                            ? 'bg-[#2563EB] text-white'
                            : 'bg-[#57534E] text-white'
                        : 'text-[#78716C] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]'
                    }`}
                  >
                    全局 {formatEnsTopologyLabel(topology)}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-white px-2 py-1.5 text-[10px] text-[#78716C] dark:bg-[#1C1917] dark:text-[#A8A29E]">
              全局状态：
              <span
                data-testid="reticulum-global-topology-status"
                className="ml-1 font-semibold text-[#1C1917] dark:text-[#FAFAF9]"
              >
                {formatOptionalEnsTopologyLabel(globalTopology)}
              </span>
            </div>

            {interfaces.length > 0 ? (
              <div className="space-y-1.5">
                {interfaces.map((item) => {
                  const configuredTopology = isEnsTopology(item.topology) ? item.topology : null;
                  const effectiveTopology = isEnsTopology(item.effective_topology) ? item.effective_topology : null;
                  const interfaceTestId = ensDebugTestIdSegment(item.name);
                  return (
                    <div
                      key={item.name}
                      data-testid={`reticulum-interface-${interfaceTestId}`}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${ensTopologyDotClass(effectiveTopology)}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">{item.name}</p>
                        <p className="text-[10px] text-[#A8A29E]">
                          {item.type} · {item.online ? 'online' : 'offline'} · {item.outgoing ? 'outgoing' : 'incoming'}
                        </p>
                        {item.interface_address && (
                          <p
                            data-testid={`reticulum-interface-${interfaceTestId}-endpoint`}
                            className="truncate text-[10px] text-[#78716C] dark:text-[#A8A29E]"
                          >
                            endpoint {item.interface_address}
                          </p>
                        )}
                        <p className="text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                          配置
                          <span data-testid={`reticulum-interface-${interfaceTestId}-configured`} className="mx-1 font-semibold">
                            {formatOptionalEnsTopologyLabel(configuredTopology)}
                          </span>
                          / 生效
                          <span data-testid={`reticulum-interface-${interfaceTestId}-effective`} className="ml-1 font-semibold">
                            {formatOptionalEnsTopologyLabel(effectiveTopology)}
                          </span>
                        </p>
                      </div>
                      <div className="inline-flex overflow-hidden rounded-md border border-[#D6D3D1] bg-[#FAF7F5] dark:border-[#57534E] dark:bg-[#292524]">
                        {ENS_TOPOLOGY_OPTIONS.map((topology) => (
                          <button
                            key={topology}
                            type="button"
                            data-testid={`reticulum-interface-${interfaceTestId}-${topology}`}
                            aria-pressed={configuredTopology === topology}
                            disabled={pendingKey === `interface:${item.name}`}
                            onClick={() => {
                              void handleSetInterfaceTopology(item.name, topology);
                            }}
                            className={`px-2 py-0.5 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                              configuredTopology === topology
                                ? topology === 'active'
                                  ? 'bg-[#0D9488] text-white'
                                  : topology === 'passive'
                                    ? 'bg-[#2563EB] text-white'
                                    : 'bg-[#57534E] text-white'
                                : 'text-[#78716C] hover:bg-[#E7E5E4] dark:text-[#A8A29E] dark:hover:bg-[#44403C]'
                            }`}
                          >
                            {formatEnsTopologyLabel(topology)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#D6D3D1] bg-white px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#1C1917] dark:text-[#A8A29E]">
                暂无 ENS interface snapshot。
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-3 dark:border-[#292524] dark:bg-[#292524]">
            <p className="text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">ENS 发现节点</p>
            {peers.length > 0 ? (
              <div className="space-y-1.5">
                {peers.map((peer) => {
                  const identityHex = peer.identity.identity_hex;
                  const pairingFacts = getEnsPeerPairingFacts(peer);
                  return (
                    <div
                      key={identityHex}
                      data-testid={`reticulum-peer-${identityHex}`}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                          {formatEnsPeerName(peer)}
                        </p>
                        <p
                          data-testid={`reticulum-peer-${identityHex}-endpoint`}
                          className="truncate text-[10px] text-[#A8A29E]"
                        >
                          {identityHex} · {formatEnsEndpointRoute(peer)}
                        </p>
                        {peer.last_error && (
                          <p
                            data-testid={`reticulum-peer-${identityHex}-last-error`}
                            className="mt-0.5 text-[10px] text-[#DC2626]"
                          >
                            最近错误：{peer.last_error}
                          </p>
                        )}
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ensPeerPairingStatusClass(pairingFacts)}`}>
                        {formatEnsPeerPairingStatus(pairingFacts)}
                      </span>
                      {pairingFacts && !pairingFacts.authorized && !pairingFacts.pairingPending && (
                        <button
                          type="button"
                          data-testid={`reticulum-peer-pair-${identityHex}`}
                          onClick={() => {
                            void handleInitiatePairing(identityHex);
                          }}
                          disabled={pendingKey === `pair:${identityHex}`}
                          className="rounded-lg bg-[#0D9488] px-2 py-1 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          发起配对
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#D6D3D1] bg-white px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#1C1917] dark:text-[#A8A29E]">
                暂无 ENS discovered peers。
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-3 dark:border-[#292524] dark:bg-[#292524]">
            <div>
              <p className="text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">ENS 操作状态</p>
              <p className="text-[10px] text-[#A8A29E]">
                配对控制面状态与错误证据来自后端 snapshot。
              </p>
            </div>
            {operations.length > 0 ? (
              <div className="space-y-1.5">
                {operations.map((operation) => {
                  const operationTestId = ensDebugTestIdSegment(operation.id);
                  const isPendingOperation = operation.status === 'pending';
                  const canAcceptPairingOffer = isPendingOperation
                    && operation.kind === 'pairing_offer'
                    && operation.direction === 'inbound';
                  const pinValue = operationPins[operation.id] ?? '';
                  const peerLabel = operation.peer_identity
                    ? formatEnsPeerName({
                        identity: operation.peer_identity,
                        authorized: false,
                        pairing_pending: false,
                      })
                    : '--';
                  return (
                    <div
                      key={operation.id}
                      data-testid={`reticulum-operation-${operationTestId}`}
                      className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                            {formatEnsOperationKindLabel(operation.kind)}
                          </p>
                          <p className="truncate text-[10px] text-[#A8A29E]">
                            {operation.id} · peer {peerLabel}
                          </p>
                        </div>
                        <span
                          data-testid={`reticulum-operation-${operationTestId}-status`}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ensOperationStatusClass(operation.status)}`}
                        >
                          {formatEnsOperationStatusLabel(operation.status)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                        {operation.session_id && <span>session {operation.session_id}</span>}
                        <span>{formatEnsOperationDirectionLabel(operation.direction)}</span>
                        <span>{operation.updated_at}</span>
                      </div>
                      {isPendingOperation && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {canAcceptPairingOffer && (
                            <>
                              <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                data-testid={`reticulum-operation-${operationTestId}-pin`}
                                value={pinValue}
                                onChange={(event) => {
                                  const nextPin = event.currentTarget.value;
                                  setOperationPins((previous) => ({
                                    ...previous,
                                    [operation.id]: nextPin,
                                  }));
                                }}
                                placeholder="PIN"
                                className="h-7 w-24 rounded-lg border border-[#D6D3D1] bg-white px-2 text-[11px] text-[#1C1917] outline-none focus:border-[#0D9488] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#57534E] dark:bg-[#292524] dark:text-[#FAFAF9]"
                                disabled={pendingKey !== null}
                              />
                              <button
                                type="button"
                                data-testid={`reticulum-operation-${operationTestId}-accept`}
                                onClick={() => {
                                  void handleAcceptPairingOperation(operation.id);
                                }}
                                disabled={pendingKey !== null || !pinValue.trim()}
                                className="h-7 rounded-lg bg-[#0D9488] px-2 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                接受
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            data-testid={`reticulum-operation-${operationTestId}-refresh-status`}
                            onClick={() => {
                              void handleRefreshPairingOperation(operation.id);
                            }}
                            disabled={pendingKey !== null}
                            className="h-7 rounded-lg bg-[#F5F0ED] px-2 text-[10px] font-semibold text-[#57534E] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#292524] dark:text-[#D6D3D1]"
                          >
                            刷新状态
                          </button>
                          <button
                            type="button"
                            data-testid={`reticulum-operation-${operationTestId}-cancel`}
                            onClick={() => {
                              void handleCancelPairingOperation(operation.id);
                            }}
                            disabled={pendingKey !== null}
                            className="h-7 rounded-lg bg-[#EF444410] px-2 text-[10px] font-semibold text-[#DC2626] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            取消
                          </button>
                        </div>
                      )}
                      {operation.error && (
                        <p
                          data-testid={`reticulum-operation-${operationTestId}-error`}
                          className="mt-1 text-[10px] text-[#DC2626]"
                        >
                          {operation.error}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#D6D3D1] bg-white px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#1C1917] dark:text-[#A8A29E]">
                暂无 ENS operation snapshot。
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-3 dark:border-[#292524] dark:bg-[#292524]">
            <div>
              <p className="text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">ENS 投递状态</p>
              <p className="text-[10px] text-[#A8A29E]">
                SignalEvent data-plane 投递记录来自后端 snapshot，不等同于业务层已应用确认。
              </p>
            </div>
            {deliveries.length > 0 ? (
              <div className="space-y-1.5">
                {deliveries.map((delivery) => {
                  const deliveryTestId = ensDebugTestIdSegment(delivery.event_id);
                  const deliveryStatus = isEnsDeliveryStatus(delivery.status) ? delivery.status : null;
                  return (
                    <div
                      key={`${delivery.event_id}:${delivery.route_id}:${delivery.finished_at}`}
                      data-testid={`reticulum-delivery-${deliveryTestId}`}
                      className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                            {delivery.event_id}
                          </p>
                          <p className="truncate text-[10px] text-[#A8A29E]">
                            {delivery.route_id} · peer {delivery.peer_identity_hex}
                          </p>
                        </div>
                        <span
                          data-testid={`reticulum-delivery-${deliveryTestId}-status`}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ensDeliveryStatusClass(deliveryStatus)}`}
                        >
                          {formatEnsDeliveryStatusLabel(deliveryStatus)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                        <span>开始 {delivery.started_at}</span>
                        <span>结束 {delivery.finished_at}</span>
                      </div>
                      {delivery.reason && (
                        <p
                          data-testid={`reticulum-delivery-${deliveryTestId}-reason`}
                          className="mt-1 text-[10px] text-[#DC2626]"
                        >
                          {delivery.reason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#D6D3D1] bg-white px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#1C1917] dark:text-[#A8A29E]">
                暂无 ENS delivery snapshot。
              </div>
            )}
          </div>

          {error && (
            <p data-testid="reticulum-debug-error" className="rounded-md bg-[#EF444410] px-2 py-1 text-[10px] text-[#DC2626]">
              {error}
            </p>
          )}
        </>
      )}
    </article>
  );
}

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

      <ReticulumDebugPanel runtimeServiceStatus={runtimeServiceStatus} />

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
