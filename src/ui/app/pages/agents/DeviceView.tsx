import { ChevronRight, Monitor } from 'lucide-react';
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
}: DeviceViewProps) {
  const hostCard = groups.flatMap((group) => group.cards).find((card) => card.isHost) ?? groups[0]?.cards[0];
  const isEmbeddedTarget = runtimeTargetMode === 'embedded';
  const currentRuntimeAddress = runtimeServiceStatus?.running
    ? `${runtimeServiceStatus.host}:${runtimeServiceStatus.port}`
    : 'not running（未运行）';
  const lastAttemptAddress = runtimeServiceStatus && !runtimeServiceStatus.running
    ? `${runtimeServiceStatus.host}:${runtimeServiceStatus.port}`
    : null;

  return (
    <section data-testid="agent-device-view" className="space-y-4">
      <article
        data-testid="runtime-host-panel"
        className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">Runtime 设备</h3>
            <p className="text-[11px] text-[#A8A29E] dark:text-[#78716C]">
              {runtimeHostSnapshots.length} 台在线配置
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

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">Local Runtime</p>
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
          <div className="mt-2 rounded-lg bg-white p-2 dark:bg-[#1C1917]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-medium text-[#44403C] dark:text-[#E7E5E4]">
                  监听模式（Bind mode）
                </p>
                <p className="text-[10px] text-[#A8A29E]">
                  {embeddedRuntimeNetworkMode === 'lan'
                    ? '手机/平板可用电脑局域网 IP + 端口直连'
                    : '仅当前电脑可访问内嵌 Runtime'}
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
            <p className="mt-2 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
              目标监听（Desired bind）：<span data-testid="runtime-local-bind-address">{embeddedRuntimeBindAddress}</span>
            </p>
            <p
              data-testid="runtime-local-share-hint"
              className="mt-1 text-[10px] text-[#A8A29E]"
            >
              {embeddedRuntimeNetworkMode === 'lan'
                ? 'LAN 模式会监听 0.0.0.0；手机请填写这台电脑的局域网 IP + 端口连接。'
                : 'Local only 模式只监听 127.0.0.1，手机无法直接连接。'}
            </p>
          </div>
          <p data-testid="runtime-current-address" className="mt-1 text-[10px] text-[#A8A29E]">
            当前运行（Current runtime）：{currentRuntimeAddress}
          </p>
          {lastAttemptAddress && (
            <p data-testid="runtime-last-attempt-address" className="mt-1 text-[10px] text-[#A8A29E]">
              最近尝试（Last attempted）：{lastAttemptAddress}
            </p>
          )}
          {runtimeServiceStatus?.pid && (
            <p className="mt-1 text-[10px] text-[#A8A29E]">pid: {runtimeServiceStatus.pid}</p>
          )}
          {runtimeNeedsRebind && (
            <p
              data-testid="runtime-local-rebind-hint"
              className="mt-1 rounded-md bg-[#C75B3A10] px-2 py-1 text-[10px] text-[#C75B3A]"
            >
              当前正在运行的监听地址与 {getEmbeddedRuntimeModeLabel(embeddedRuntimeNetworkMode)} 不一致，点击 Start 会自动重启并切换到目标监听地址。
            </p>
          )}
          {runtimeServiceStatus?.error && (
            <p className="mt-1 text-[10px] text-[#DC2626]">{runtimeServiceStatus.error}</p>
          )}
          <div className="mt-2 flex items-center gap-2">
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
              className="rounded bg-[#F5F0ED] px-2 py-1 text-[10px] text-[#57534E] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#1C1917] dark:text-[#D6D3D1]"
            >
              Stop
            </button>
          </div>
          {!isEmbeddedTarget && (
            <p className="mt-2 text-[10px] text-[#A8A29E]">
              当前为外部模式，Start/Stop 仅控制内嵌 Runtime。
            </p>
          )}
        </div>

        {runtimeHostError && (
          <p className="rounded-md bg-[#EF444410] px-2 py-1 text-[11px] text-[#DC2626]">{runtimeHostError}</p>
        )}

        <div className="space-y-2">
          {runtimeHostSnapshots.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#D6D3D1] bg-[#FAF7F5] px-3 py-3 text-[11px] text-[#78716C] dark:border-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
              暂无 Runtime 设备，请点击「管理主机」添加 `host:port`。
            </div>
          )}
          {runtimeHostSnapshots.map((item) => (
            <div
              key={item.host.id}
              data-testid={`runtime-host-device-card-${item.host.id}`}
              className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2.5 dark:border-[#292524] dark:bg-[#292524]"
            >
              <div className="flex items-center justify-between gap-2">
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
                </div>
                <div className="flex items-center gap-2">
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
                    {item.topology?.hostname ?? '--'}
                  </p>
                </div>
                <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
                  <p className="text-[10px] text-[#A8A29E]">系统</p>
                  <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                    {item.topology?.os ?? '--'}
                  </p>
                </div>
                <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
                  <p className="text-[10px] text-[#A8A29E]">架构</p>
                  <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                    {item.topology?.arch ?? '--'}
                  </p>
                </div>
                <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-[#1C1917]">
                  <p className="text-[10px] text-[#A8A29E]">内存</p>
                  <p className="truncate text-[11px] font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                    {formatHostMemory(item.topology?.used_memory_mb, item.topology?.total_memory_mb)}
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

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                <span>runtime: {item.topology?.version ?? '--'}</span>
                <span>port: {item.topology?.port ?? item.host.port}</span>
              </div>

              {item.host.lastCheckedAt && (
                <p className="mt-1 text-[10px] text-[#A8A29E]">last: {item.host.lastCheckedAt}</p>
              )}
              {item.error && (
                <p className="mt-1 text-[10px] text-[#DC2626]">{item.error}</p>
              )}
            </div>
          ))}
        </div>
      </article>

      {hostCard && (
        <article
          data-testid="agent-device-overview-card"
          className="rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{hostCard.name}</p>
              <p className="mt-0.5 text-xs text-[#A8A29E] dark:text-[#78716C]">{hostCard.summary}</p>
            </div>
            <span className="rounded bg-[#C75B3A15] px-2 py-0.5 text-[11px] text-[#C75B3A]">本机</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {hostCard.metrics.slice(0, 3).map((metric) => (
              <div key={metric.label} className="rounded-lg bg-[#FAF7F5] px-2 py-1.5 text-center dark:bg-[#292524]">
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
