import { ChevronRight, Link2, Monitor, ShieldCheck, Wifi } from 'lucide-react';
import type { AgentDeviceGroup, RuntimeServiceStatus } from '@/lib/types/agent-hub';
import type { RuntimeHostSnapshot } from '@/services/runtime-manager';
import {
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
  runtimeHostSnapshots: RuntimeHostSnapshot[];
  runtimeServiceStatus: RuntimeServiceStatus | null;
  runtimeHostError: string;
  embeddedRuntimeNetworkMode: EmbeddedRuntimeNetworkMode;
  embeddedRuntimeBindAddress: string;
  runtimeNeedsRebind: boolean;
  runtimeTargetMode: RuntimeTargetMode;
  runtimeTargetAddress: string;
  runtimeTargetError: string;
  runtimeExternalAddressDraft: string;
  onRuntimeHostProbe: (hostId: string) => Promise<void>;
  onEmbeddedRuntimeNetworkModeChange: (mode: EmbeddedRuntimeNetworkMode) => void;
  onRuntimeStart: () => Promise<void>;
  onRuntimeStop: () => Promise<void>;
  onRuntimeTargetModeChange: (mode: RuntimeTargetMode) => void;
  onRuntimeExternalAddressDraftChange: (value: string) => void;
  onApplyRuntimeExternalAddress: () => void;
  onOpenHostManager: () => void;
  onOpenPeerPairing: () => void;
}

function renderSectionSummary(count: number, label: string): string {
  if (count <= 0) {
    return `暂无${label}`;
  }
  return `${count} 个${label}`;
}

export function DeviceView({
  groups,
  runtimeHostSnapshots,
  runtimeServiceStatus,
  runtimeHostError,
  embeddedRuntimeNetworkMode,
  embeddedRuntimeBindAddress,
  runtimeNeedsRebind,
  runtimeTargetMode,
  runtimeTargetAddress,
  runtimeTargetError,
  runtimeExternalAddressDraft,
  onRuntimeHostProbe,
  onEmbeddedRuntimeNetworkModeChange,
  onRuntimeStart,
  onRuntimeStop,
  onRuntimeTargetModeChange,
  onRuntimeExternalAddressDraftChange,
  onApplyRuntimeExternalAddress,
  onOpenHostManager,
  onOpenPeerPairing,
}: DeviceViewProps) {
  const hostCard = groups.flatMap((group) => group.cards).find((card) => card.isHost) ?? groups[0]?.cards[0];
  const isEmbeddedTarget = runtimeTargetMode === 'embedded';
  const currentRuntimeAddress = runtimeServiceStatus?.running
    ? `${runtimeServiceStatus.host}:${runtimeServiceStatus.port}`
    : 'not running（未运行）';
  const lastAttemptAddress = runtimeServiceStatus && !runtimeServiceStatus.running
    ? `${runtimeServiceStatus.host}:${runtimeServiceStatus.port}`
    : null;
  const discoveredPeers = runtimeHostSnapshots.filter((item) => item.host.trustState === 'discovered_candidate');
  const confirmedPeers = runtimeHostSnapshots.filter((item) => item.host.trustState === 'confirmed_peer');
  const advancedHosts = runtimeHostSnapshots.filter((item) => (
    item.host.trustState !== 'discovered_candidate'
    && item.host.trustState !== 'confirmed_peer'
  ));
  const localNodeName = hostCard?.name ?? '当前设备';
  const localNodeSummary = runtimeServiceStatus?.running
    ? '内嵌 RT 已运行，可参与发现、配对与复制。'
    : '先启动内嵌 RT，再把这台设备加入你的 ExoMind-Net。';
  const localNodeId = runtimeServiceStatus?.hostId ?? 'pending（待登记）';
  const canOpenPeerPairing = Boolean(runtimeServiceStatus?.running);

  const renderRuntimePeerCard = (
    item: RuntimeHostSnapshot,
    mode: 'discovered' | 'confirmed' | 'advanced',
  ) => {
    const trustLabel = mode === 'confirmed'
      ? '已确认 peer'
      : mode === 'discovered'
        ? '待配对节点'
        : '兼容 / 手工节点';
    const addressText = item.host.lastSuccessfulDialAddress
      ?? item.host.manualOverride
      ?? `${item.host.host}:${item.host.port}`;
    const replicationStatus = mode === 'confirmed'
      ? item.connectionState === 'online'
        ? '已连接'
        : item.connectionState === 'offline'
          ? '离线'
          : '异常 / 待重试'
      : null;

    return (
      <div
        key={item.host.id}
        data-testid={`runtime-host-device-card-${item.host.id}`}
        className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2.5 dark:border-[#292524] dark:bg-[#292524]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0D948820] text-[#0D9488]">
                <Monitor size={13} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{item.host.name}</p>
                <p className="truncate text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                  {item.host.host}:{item.host.port}
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
              <span className="rounded bg-white px-1.5 py-0.5 dark:bg-[#1C1917]">{trustLabel}</span>
              <span>dial: {addressText}</span>
              {item.topology?.host_id && <span>host_id: {item.topology.host_id}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              data-testid={`runtime-host-status-${item.host.id}`}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getHostStatusBadgeClass(item.connectionState)}`}
            >
              {item.connectionState}
            </span>
            <button
              type="button"
              data-testid={`runtime-host-probe-${item.host.id}`}
              onClick={() => {
                void onRuntimeHostProbe(item.host.id);
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
              {item.topology?.hostname ?? item.host.name}
            </p>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">系统</p>
            <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
              {item.topology?.os ?? '--'}
            </p>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">延迟</p>
            <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
              {item.latencyMs ? `${item.latencyMs} ms` : '--'}
            </p>
          </div>
          <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">在线时长</p>
            <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
              {formatHostUptime(item.topology?.uptime_secs)}
            </p>
          </div>
        </div>

        {replicationStatus && (
          <div className="mt-2 rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
            <p className="text-[10px] text-[#A8A29E]">复制状态</p>
            <p className="text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">{replicationStatus}</p>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
          <span>runtime: {item.topology?.version ?? '--'}</span>
          <span>memory: {formatHostMemory(item.topology?.used_memory_mb, item.topology?.total_memory_mb)}</span>
        </div>

        {item.host.lastCheckedAt && (
          <p className="mt-1 text-[10px] text-[#A8A29E]">last: {item.host.lastCheckedAt}</p>
        )}
        {item.error && (
          <p className="mt-1 text-[10px] text-[#DC2626]">{item.error}</p>
        )}
      </div>
    );
  };

  return (
    <section data-testid="agent-device-view" className="space-y-4">
      <article className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">我的节点</h3>
            <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">{localNodeSummary}</p>
          </div>
          <button
            type="button"
            data-testid="device-open-peer-pairing"
            onClick={onOpenPeerPairing}
            disabled={!canOpenPeerPairing}
            className="inline-flex items-center gap-1 rounded-lg bg-[#0D9488] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Link2 size={13} />
            设备配对
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
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
                  placeholder="host:port（例如 127.0.0.1:1949）"
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
              <p className="text-[10px] text-[#A8A29E]">外部模式下，SSE 与 timeblock 发布会走该地址。</p>
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
