import {
  AlarmClock,
  Bot,
  Brain,
  CircleAlert,
  ChevronRight,
  Filter,
  List,
  Mail,
  MessageCircle,
  Monitor,
  Newspaper,
  Plus,
  Rocket,
  Rss,
  Send,
  Settings,
  Sparkles,
  TimerReset,
  Waypoints,
  Webhook,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getAgentHubService } from '@/lib/services';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import type {
  AgentDeviceGroup,
  AgentHubEdge,
  AgentHubListItem,
  AgentHubListSection,
  AgentHubNodeStatus,
  AgentHubNode,
  AgentHubTopologyData,
  AgentHubViewMode,
  RuntimeHostRecord,
  RuntimeServiceStatus,
} from '@/lib/types/agent-hub';
import {
  getRuntimeManager,
  type RuntimeAggregatedAgent,
  type RuntimeHostSnapshot,
} from '@/services/runtime-manager';

const VIEW_ITEMS: Array<{ id: AgentHubViewMode; icon: LucideIcon; label: string }> = [
  { id: 'topology', icon: Bot, label: '拓扑' },
  { id: 'list', icon: List, label: '列表' },
  { id: 'device', icon: Monitor, label: '设备' },
];

const LIST_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'input', label: '信号输入' },
  { id: 'agent', label: 'Agent' },
  { id: 'actor', label: 'Actor' },
  { id: 'output', label: '输出' },
] as const;

type AddNodeOption = {
  id: 'device';
  title: string;
  description: string;
  tintColor: string;
};

const ADD_NODE_OPTIONS: AddNodeOption[] = [
  {
    id: 'device',
    title: '添加设备',
    description: '连接 exomind-rt 主机并聚合 Agent 列表',
    tintColor: '#0D9488',
  },
];

type TopologyLayoutItem = {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: 'bubble' | 'card' | 'chip';
};

// Topology layout（拓扑布局）使用设计稿坐标近似值，保持移动端视觉比例。
const TOPOLOGY_LAYOUT: Record<string, TopologyLayoutItem> = {
  'output-telegram': { x: 16, y: 42, width: 58, height: 58, shape: 'bubble' },
  'output-wechat': { x: 104, y: 42, width: 58, height: 58, shape: 'bubble' },
  'output-email': { x: 192, y: 42, width: 58, height: 58, shape: 'bubble' },
  'output-feishu': { x: 280, y: 42, width: 58, height: 58, shape: 'bubble' },
  'agent-daily': { x: 24, y: 230, width: 156, height: 86, shape: 'card' },
  'agent-summary': { x: 196, y: 246, width: 144, height: 80, shape: 'card' },
  'actor-timer': { x: 112, y: 338, width: 120, height: 50, shape: 'chip' },
  'actor-cleaner': { x: 244, y: 338, width: 112, height: 50, shape: 'chip' },
  'input-rss': { x: 20, y: 490, width: 56, height: 56, shape: 'bubble' },
  'input-wechat': { x: 108, y: 490, width: 56, height: 56, shape: 'bubble' },
  'input-api': { x: 196, y: 490, width: 56, height: 56, shape: 'bubble' },
  'input-cron': { x: 284, y: 490, width: 56, height: 56, shape: 'bubble' },
};

function normalizeHexColor(color: string): string {
  return color.length === 9 ? color.slice(0, 7) : color;
}

function getNodeIcon(node: AgentHubNode): LucideIcon {
  if (node.id === 'output-telegram') return Send;
  if (node.id === 'output-wechat') return MessageCircle;
  if (node.id === 'output-email') return Mail;
  if (node.id === 'output-feishu') return Rocket;
  if (node.id === 'agent-daily') return Newspaper;
  if (node.id === 'agent-summary') return Sparkles;
  if (node.id === 'actor-timer') return AlarmClock;
  if (node.id === 'actor-cleaner') return Filter;
  if (node.id === 'input-rss') return Rss;
  if (node.id === 'input-wechat') return MessageCircle;
  if (node.id === 'input-api') return Webhook;
  return TimerReset;
}

function getListItemIcon(item: AgentHubListItem): LucideIcon {
  if (item.id.includes('rss')) return Rss;
  if (item.id.includes('wechat')) return MessageCircle;
  if (item.id.includes('api')) return Webhook;
  if (item.id.includes('timer') || item.id.includes('cron')) return AlarmClock;
  if (item.type === 'agent' && item.id.includes('summary')) return Sparkles;
  if (item.type === 'agent') return Brain;
  if (item.type === 'actor' && item.id.includes('cleaner')) return Filter;
  if (item.type === 'actor') return AlarmClock;
  if (item.id.includes('telegram')) return Send;
  if (item.id.includes('email')) return Mail;
  if (item.id.includes('feishu')) return Rocket;
  return Waypoints;
}

function getAddOptionIcon(optionId: AddNodeOption['id']): LucideIcon {
  if (optionId === 'device') return Monitor;
  return Plus;
}

function mapRuntimeStatusToNodeStatus(status: string): AgentHubNodeStatus {
  if (status === 'available' || status === 'running') return 'running';
  if (status === 'busy') return 'warning';
  if (status === 'error') return 'warning';
  return 'idle';
}

function mapHostConnectionToRecordStatus(connectionState: RuntimeHostSnapshot['connectionState']): RuntimeHostRecord['status'] {
  if (connectionState === 'online') return 'online';
  if (connectionState === 'offline') return 'offline';
  return 'warning';
}

function buildListSectionsFromRuntimeAgents(agents: RuntimeAggregatedAgent[]): AgentHubListSection[] {
  const groupedByHost = new Map<string, RuntimeAggregatedAgent[]>();
  for (const agent of agents) {
    const key = JSON.stringify([agent.sourceHostId, agent.sourceHostName]);
    const existing = groupedByHost.get(key) ?? [];
    existing.push(agent);
    groupedByHost.set(key, existing);
  }

  return Array.from(groupedByHost.entries()).map(([key, hostAgents], index) => {
    const [hostId, hostName] = JSON.parse(key) as [string, string];
    return {
      id: `runtime-${hostId}-${index}`,
      title: hostName || 'Runtime Host',
      count: hostAgents.length,
      items: hostAgents.map((agent) => ({
        id: `${agent.sourceHostId}__${agent.id}`,
        type: 'agent',
        name: agent.name,
        description: `来源 ${agent.sourceHostAddress}${agent.description ? ` · ${agent.description}` : ''}`,
        status: mapRuntimeStatusToNodeStatus(agent.status),
        icon: 'brain',
        badgeText: agent.sourceHostName,
      })),
    };
  });
}

function getDeviceTypeIcon(groupId: string): LucideIcon {
  if (groupId.includes('cloud')) return Waypoints;
  return Monitor;
}

function getNodeCenter(layout: TopologyLayoutItem): { x: number; y: number } {
  return {
    x: layout.x + layout.width / 2,
    y: layout.y + layout.height / 2,
  };
}

function getEdgeEndpoints(edge: AgentHubEdge): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
  const fromLayout = TOPOLOGY_LAYOUT[edge.fromNodeId];
  const toLayout = TOPOLOGY_LAYOUT[edge.toNodeId];
  if (!fromLayout || !toLayout) return null;

  const fromCenter = getNodeCenter(fromLayout);
  const toCenter = getNodeCenter(toLayout);

  const from = {
    x: fromCenter.x,
    y: fromCenter.y > toCenter.y ? fromLayout.y : fromLayout.y + fromLayout.height,
  };
  const to = {
    x: toCenter.x,
    y: toCenter.y > fromCenter.y ? toLayout.y : toLayout.y + toLayout.height,
  };

  return { from, to };
}

function buildEdgePath(edge: AgentHubEdge): string | null {
  const endpoints = getEdgeEndpoints(edge);
  if (!endpoints) return null;
  const { from, to } = endpoints;
  const controlY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} C ${from.x} ${controlY}, ${to.x} ${controlY}, ${to.x} ${to.y}`;
}

function ViewToggle({
  value,
  onChange,
}: {
  value: AgentHubViewMode;
  onChange: (value: AgentHubViewMode) => void;
}) {
  return (
    <div className="flex items-center rounded-[10px] bg-[#F5F0ED] p-1 dark:bg-[#292524]">
      {VIEW_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            data-testid={`agent-view-toggle-${item.id}`}
            onClick={() => onChange(item.id)}
            aria-pressed={active}
            className={`flex h-7 w-8 items-center justify-center rounded-[8px] transition ${
              active
                ? 'bg-white text-[#1C1917] shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#44403C] dark:text-[#FAFAF9]'
                : 'text-[#78716C] dark:text-[#A8A29E]'
            }`}
            title={item.label}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

function TopologyNode({
  node,
  selected,
  muted,
  onSelect,
}: {
  node: AgentHubNode;
  selected: boolean;
  muted: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const layout = TOPOLOGY_LAYOUT[node.id];
  if (!layout) return null;

  const Icon = getNodeIcon(node);
  const baseColor = normalizeHexColor(node.brandColor);

  if (layout.shape === 'bubble') {
    return (
      <button
        type="button"
        data-testid={`agent-topology-node-${node.id}`}
        data-muted={muted ? 'true' : 'false'}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.id);
        }}
        className="absolute flex flex-col items-center"
        style={{
          left: layout.x,
          top: layout.y,
          width: layout.width,
          opacity: muted ? 0.32 : 1,
          transition: 'opacity 160ms ease, transform 160ms ease',
        }}
      >
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full border ${
            selected ? 'ring-2 ring-offset-1 ring-offset-[#FAF7F5] dark:ring-offset-[#1C1917]' : ''
          }`}
          style={{
            borderColor: `${baseColor}50`,
            color: baseColor,
            backgroundColor: `${baseColor}1A`,
          }}
        >
          <Icon size={15} />
        </div>
        <span className="mt-1 text-[10px] font-medium text-[#57534E] dark:text-[#D6D3D1]">{node.name}</span>
      </button>
    );
  }

  if (layout.shape === 'chip') {
    return (
      <button
        type="button"
        data-testid={`agent-topology-node-${node.id}`}
        data-muted={muted ? 'true' : 'false'}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.id);
        }}
        className={`absolute flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
          selected
            ? 'border-[#C75B3A] bg-white shadow-[0_8px_20px_-14px_rgba(199,91,58,0.9)] dark:border-[#E8734E] dark:bg-[#2A2522]'
            : 'border-[#E7E5E4] bg-white dark:border-[#292524] dark:bg-[#1C1917]'
        }`}
        style={{
          left: layout.x,
          top: layout.y,
          width: layout.width,
          minHeight: layout.height,
          opacity: muted ? 0.35 : 1,
        }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${baseColor}18`, color: baseColor }}
        >
          <Icon size={13} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-[#44403C] dark:text-[#F5F5F4]">{node.name}</p>
          <p className="truncate text-[10px] text-[#A8A29E] dark:text-[#78716C]">{node.subtitle ?? node.status}</p>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid={`agent-topology-node-${node.id}`}
      data-muted={muted ? 'true' : 'false'}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
      className={`absolute rounded-2xl border bg-white px-3 py-3 text-left transition dark:bg-[#1C1917] ${
        selected
          ? 'border-[#C75B3A] shadow-[0_12px_24px_-16px_rgba(199,91,58,0.9)] dark:border-[#E8734E]'
          : 'border-[#E7E5E4] dark:border-[#292524]'
      }`}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        minHeight: layout.height,
        opacity: muted ? 0.35 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${baseColor}1F`, color: baseColor }}
        >
          <Icon size={15} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{node.name}</p>
          <p className="truncate text-[10px] text-[#A8A29E] dark:text-[#78716C]">{node.subtitle ?? node.status}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[10px] text-[#78716C] dark:text-[#A8A29E]">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: node.status === 'running' ? '#22C55E' : '#A8A29E' }}
        />
        {node.status === 'running' ? '运行中' : '待机中'}
      </div>
    </button>
  );
}

function TopologyView({
  topology,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
}: {
  topology: AgentHubTopologyData;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
}) {
  const selectedNode = topology.nodes.find((item) => item.id === selectedNodeId) ?? null;

  const selectionState = useMemo(() => {
    if (!selectedNodeId) {
      return {
        highlightedEdgeIds: new Set<string>(),
        connectedNodeIds: new Set<string>(),
      };
    }

    const connectedNodeIds = new Set<string>([selectedNodeId]);
    const highlightedEdgeIds = new Set<string>();

    topology.edges.forEach((edge) => {
      if (edge.fromNodeId === selectedNodeId || edge.toNodeId === selectedNodeId) {
        highlightedEdgeIds.add(edge.id);
        connectedNodeIds.add(edge.fromNodeId);
        connectedNodeIds.add(edge.toNodeId);
      }
    });

    return { highlightedEdgeIds, connectedNodeIds };
  }, [selectedNodeId, topology.edges]);

  return (
    <section data-testid="agent-topology-view" className="space-y-3" onClick={onClearSelection}>
      <div
        data-testid="agent-topology-canvas"
        className="relative h-[568px] overflow-hidden rounded-[22px] border border-[#EDE8E3] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#1C1917]"
      >
        <div className="absolute left-3 top-2 rounded-md bg-[#F5F0ED] px-2 py-1 text-[10px] font-semibold text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]">输出节点</div>
        <div className="absolute left-3 top-[205px] rounded-md bg-[#F5F0ED] px-2 py-1 text-[10px] font-semibold text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]">Agent / Actor</div>
        <div className="absolute left-3 top-[462px] rounded-md bg-[#F5F0ED] px-2 py-1 text-[10px] font-semibold text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]">信号输入</div>

        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 356 568" fill="none" aria-hidden="true">
          {topology.edges.map((edge) => {
            const path = buildEdgePath(edge);
            if (!path) return null;

            const highlighted = selectionState.highlightedEdgeIds.has(edge.id);
            const hasSelection = Boolean(selectedNodeId);
            const baseColor = normalizeHexColor(edge.color);
            const opacity = hasSelection ? (highlighted ? 1 : 0.18) : 0.45;
            const strokeWidth = hasSelection ? (highlighted ? 2.5 : 1.1) : 1.5;

            return (
              <path
                key={edge.id}
                data-testid={`agent-topology-edge-${edge.id}`}
                d={path}
                stroke={baseColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                opacity={opacity}
              />
            );
          })}
        </svg>

        {topology.nodes.map((node) => {
          const muted = Boolean(selectedNodeId) && !selectionState.connectedNodeIds.has(node.id);
          return (
            <TopologyNode
              key={node.id}
              node={node}
              selected={selectedNodeId === node.id}
              muted={muted}
              onSelect={onSelectNode}
            />
          );
        })}
      </div>

      {selectedNode && (
        <div
          data-testid="agent-topology-node-detail-card"
          className="rounded-2xl border border-[#E7E5E4] bg-[#1C1917] px-4 py-3 text-white dark:border-[#44403C] dark:bg-[#0C0A09]"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-sm font-semibold">{selectedNode.name}</p>
          <p className="mt-1 text-xs text-white/80">状态：{selectedNode.status}</p>
          <p className="mt-1 text-xs text-white/60">类型：{selectedNode.type}</p>
        </div>
      )}
    </section>
  );
}

function ListView({
  sections,
  hostSnapshots,
  onRetryHost,
  onItemNavigate,
}: {
  sections: AgentHubListSection[];
  hostSnapshots: RuntimeHostSnapshot[];
  onRetryHost: (hostId: string) => Promise<void>;
  onItemNavigate: (path: string) => void;
}) {
  const problemHosts = hostSnapshots.filter((item) => item.connectionState !== 'online');

  return (
    <section data-testid="agent-list-view" className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {LIST_FILTERS.map((filterItem, index) => {
          const active = index === 0;
          return (
            <button
              key={filterItem.id}
              type="button"
              data-testid={`agent-list-filter-${filterItem.id}`}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] ${
                active ? 'bg-[#C75B3A] text-white' : 'bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]'
              }`}
            >
              {filterItem.label}
            </button>
          );
        })}
      </div>

      {problemHosts.length > 0 && (
        <article className="space-y-2 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-3 dark:border-[#7F1D1D] dark:bg-[#2B1111]">
          <div className="flex items-center gap-2 text-[#B91C1C] dark:text-[#FCA5A5]">
            <CircleAlert size={14} />
            <p className="text-xs font-semibold">连接异常主机</p>
          </div>
          <div className="space-y-2">
            {problemHosts.map((item) => (
              <div key={item.host.id} className="rounded-xl border border-[#FECACA] bg-white px-3 py-2 dark:border-[#7F1D1D] dark:bg-[#1C1917]">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{item.host.name}</p>
                    <p className="truncate text-[11px] text-[#78716C] dark:text-[#A8A29E]">{item.host.host}:{item.host.port}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      data-testid={`runtime-host-status-${item.host.id}`}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        item.connectionState === 'offline'
                          ? 'bg-[#EF444420] text-[#DC2626]'
                          : 'bg-[#F59E0B20] text-[#D97706]'
                      }`}
                    >
                      {item.connectionState}
                    </span>
                    <button
                      type="button"
                      data-testid={`runtime-host-probe-${item.host.id}`}
                      onClick={() => {
                        void onRetryHost(item.host.id);
                      }}
                      className="rounded bg-[#F5F0ED] px-2 py-1 text-[10px] text-[#57534E] dark:bg-[#292524] dark:text-[#D6D3D1]"
                    >
                      重试
                    </button>
                  </div>
                </div>
                {item.error && <p className="mt-1 text-[10px] text-[#DC2626]">{item.error}</p>}
              </div>
            ))}
          </div>
        </article>
      )}

      {sections.length === 0 && (
        <article className="rounded-2xl border border-[#E7E5E4] bg-white px-4 py-6 text-center dark:border-[#292524] dark:bg-[#1C1917]">
          <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">暂无可用 Agent</p>
          <p className="mt-1 text-xs text-[#A8A29E]">请先添加 exomind-rt 主机并确认连接状态</p>
        </article>
      )}

      {sections.map((section) => (
        <article key={section.id} className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-[#78716C] dark:text-[#A8A29E]">{section.title}</h3>
            <span className="rounded-md bg-[#F5F0ED] px-2 py-0.5 text-[11px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">{section.count} 个节点</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
            {section.items.map((item, index) => {
              const Icon = getListItemIcon(item);
              return (
                <div key={item.id}>
                  <button
                    type="button"
                    data-testid={`agent-list-item-${item.id}`}
                    onClick={() => {
                      const runtimeAgentId = item.id.includes('__') ? item.id.split('__')[1] ?? item.id : item.id;
                      if (item.type === 'agent') {
                        onItemNavigate(`/agents/agent/${runtimeAgentId}`);
                      }
                      if (item.type === 'actor') {
                        onItemNavigate(`/agents/actor/${runtimeAgentId}`);
                      }
                    }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                        <Icon size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{item.name}</p>
                        <p className="text-xs text-[#A8A29E] dark:text-[#78716C]">{item.description}</p>
                      </div>
                    </div>
                    <ChevronRight
                      data-testid={`agent-list-item-${item.id}-chevron`}
                      size={14}
                      className="shrink-0 text-[#D6D3D1] dark:text-[#57534E]"
                    />
                  </button>
                  {index !== section.items.length - 1 && <div className="h-px bg-[#F5F0ED] dark:bg-[#292524]" />}
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </section>
  );
}

function DeviceView({
  groups,
  runtimeHosts,
  runtimeServiceStatus,
  runtimeHostName,
  runtimeHostAddress,
  runtimeHostPort,
  runtimeHostError,
  onRuntimeHostNameChange,
  onRuntimeHostAddressChange,
  onRuntimeHostPortChange,
  onRuntimeHostAdd,
  onRuntimeHostProbe,
  onRuntimeStart,
  onRuntimeStop,
}: {
  groups: AgentDeviceGroup[];
  runtimeHosts: RuntimeHostRecord[];
  runtimeServiceStatus: RuntimeServiceStatus | null;
  runtimeHostName: string;
  runtimeHostAddress: string;
  runtimeHostPort: string;
  runtimeHostError: string;
  onRuntimeHostNameChange: (value: string) => void;
  onRuntimeHostAddressChange: (value: string) => void;
  onRuntimeHostPortChange: (value: string) => void;
  onRuntimeHostAdd: () => Promise<void>;
  onRuntimeHostProbe: (hostId: string) => Promise<void>;
  onRuntimeStart: () => Promise<void>;
  onRuntimeStop: () => Promise<void>;
}) {
  const hostCard = groups.flatMap((group) => group.cards).find((card) => card.isHost) ?? groups[0]?.cards[0];

  return (
    <section data-testid="agent-device-view" className="space-y-4">
      <article
        data-testid="runtime-host-panel"
        className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-white px-4 py-3 dark:border-[#292524] dark:bg-[#1C1917]"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">Runtime Hosts</h3>
          <span className="text-[11px] text-[#A8A29E]">{runtimeHosts.length} 台</span>
        </div>

        <div className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2 dark:border-[#292524] dark:bg-[#292524]">
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
          <p className="mt-1 text-[10px] text-[#A8A29E]">
            {runtimeServiceStatus?.host ?? '127.0.0.1'}:{runtimeServiceStatus?.port ?? 4077}
          </p>
          {runtimeServiceStatus?.pid && (
            <p className="mt-1 text-[10px] text-[#A8A29E]">pid: {runtimeServiceStatus.pid}</p>
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
              className="rounded bg-[#C75B3A] px-2 py-1 text-[10px] text-white"
            >
              Start
            </button>
            <button
              type="button"
              data-testid="runtime-local-stop-button"
              onClick={() => {
                void onRuntimeStop();
              }}
              className="rounded bg-[#F5F0ED] px-2 py-1 text-[10px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]"
            >
              Stop
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <input
            data-testid="runtime-host-name-input"
            value={runtimeHostName}
            onChange={(event) => onRuntimeHostNameChange(event.target.value)}
            placeholder="Name（名称）"
            className="h-9 rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#292524] dark:bg-[#292524] dark:text-[#FAFAF9]"
          />
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <input
              data-testid="runtime-host-address-input"
              value={runtimeHostAddress}
              onChange={(event) => onRuntimeHostAddressChange(event.target.value)}
              placeholder="IP / Host"
              className="h-9 rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#292524] dark:bg-[#292524] dark:text-[#FAFAF9]"
            />
            <input
              data-testid="runtime-host-port-input"
              value={runtimeHostPort}
              onChange={(event) => onRuntimeHostPortChange(event.target.value)}
              placeholder="Port"
              className="h-9 rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#292524] dark:bg-[#292524] dark:text-[#FAFAF9]"
            />
          </div>
          <button
            type="button"
            data-testid="runtime-host-add-button"
            onClick={() => {
              void onRuntimeHostAdd();
            }}
            className="h-9 rounded-lg bg-[#C75B3A] text-xs font-semibold text-white"
          >
            添加 RuntimeHost
          </button>
        </div>

        {runtimeHostError && (
          <p className="rounded-md bg-[#EF444410] px-2 py-1 text-[11px] text-[#DC2626]">{runtimeHostError}</p>
        )}

        <div className="space-y-2">
          {runtimeHosts.map((host) => (
            <div
              key={host.id}
              className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2 dark:border-[#292524] dark:bg-[#292524]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{host.name}</p>
                  <p className="truncate text-[11px] text-[#78716C] dark:text-[#A8A29E]">{host.host}:{host.port}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    data-testid={`runtime-host-status-${host.id}`}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      host.status === 'online'
                        ? 'bg-[#22C55E20] text-[#16A34A]'
                        : host.status === 'offline'
                          ? 'bg-[#EF444420] text-[#DC2626]'
                          : host.status === 'warning'
                            ? 'bg-[#F59E0B20] text-[#D97706]'
                            : 'bg-[#E7E5E4] text-[#57534E]'
                    }`}
                  >
                    {host.status}
                  </span>
                  <button
                    type="button"
                    data-testid={`runtime-host-probe-${host.id}`}
                    onClick={() => {
                      void onRuntimeHostProbe(host.id);
                    }}
                    className="rounded bg-[#F5F0ED] px-2 py-1 text-[10px] text-[#57534E] dark:bg-[#1C1917] dark:text-[#D6D3D1]"
                  >
                    探测
                  </button>
                </div>
              </div>
              {host.lastCheckedAt && (
                <p className="mt-1 text-[10px] text-[#A8A29E]">last: {host.lastCheckedAt}</p>
              )}
              {host.lastError && (
                <p className="mt-1 text-[10px] text-[#DC2626]">{host.lastError}</p>
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

function AddNodeSheet({
  options,
  onClose,
  onAddDevice,
}: {
  options: AddNodeOption[];
  onClose: () => void;
  onAddDevice: () => void;
}) {
  return (
    <>
      <button
        type="button"
        data-testid="agent-add-node-overlay"
        aria-label="关闭添加节点弹窗（Close Add Node Sheet）"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <section
        data-testid="agent-add-node-sheet"
        className="absolute inset-x-0 bottom-0 z-10 rounded-t-[24px] bg-white pb-7 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] dark:bg-[#1C1917] dark:shadow-[0_-8px_28px_rgba(0,0,0,0.45)]"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded bg-[#D6D3D1] dark:bg-[#57534E]" />
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[18px] font-bold text-[#1C1917] dark:text-[#FAFAF9]">添加节点</h2>
          <button
            type="button"
            data-testid="agent-add-node-close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2 px-5">
          {options.map((option) => {
            const Icon = getAddOptionIcon(option.id);
            return (
              <button
                key={option.id}
                type="button"
                data-testid={`agent-add-node-option-${option.id}`}
                onClick={() => {
                  if (option.id === 'device') {
                    onClose();
                    onAddDevice();
                  }
                }}
                className="flex w-full items-center justify-between rounded-2xl bg-[#FAF7F5] px-4 py-3 text-left dark:bg-[#292524]"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${option.tintColor}20`, color: option.tintColor }}
                  >
                    <Icon size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{option.title}</p>
                    <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{option.description}</p>
                  </div>
                </div>
                <ChevronRight size={14} className="text-[#D6D3D1] dark:text-[#57534E]" />
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function RuntimeHostManagerSheet({
  hostSnapshots,
  runtimeHostName,
  runtimeHostAddress,
  runtimeHostError,
  onRuntimeHostNameChange,
  onRuntimeHostAddressChange,
  onRuntimeHostAdd,
  onRuntimeHostProbe,
  onRuntimeHostRemove,
  onClose,
}: {
  hostSnapshots: RuntimeHostSnapshot[];
  runtimeHostName: string;
  runtimeHostAddress: string;
  runtimeHostError: string;
  onRuntimeHostNameChange: (value: string) => void;
  onRuntimeHostAddressChange: (value: string) => void;
  onRuntimeHostAdd: () => Promise<void>;
  onRuntimeHostProbe: (hostId: string) => Promise<void>;
  onRuntimeHostRemove: (hostId: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        data-testid="agent-host-manager-overlay"
        aria-label="关闭主机管理弹窗（Close Runtime Host Manager）"
        className="absolute inset-0 z-20 bg-black/35"
        onClick={onClose}
      />
      <section
        data-testid="agent-host-manager-sheet"
        className="absolute inset-x-0 bottom-0 z-30 rounded-t-[24px] bg-white pb-7 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] dark:bg-[#1C1917] dark:shadow-[0_-8px_28px_rgba(0,0,0,0.45)]"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded bg-[#D6D3D1] dark:bg-[#57534E]" />
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[18px] font-bold text-[#1C1917] dark:text-[#FAFAF9]">添加设备</h2>
          <button
            type="button"
            data-testid="agent-host-manager-close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 px-5">
          <input
            data-testid="runtime-host-name-input"
            value={runtimeHostName}
            onChange={(event) => onRuntimeHostNameChange(event.target.value)}
            placeholder="Name（名称，可选）"
            className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#292524] dark:bg-[#292524] dark:text-[#FAFAF9]"
          />
          <input
            data-testid="runtime-host-address-input"
            value={runtimeHostAddress}
            onChange={(event) => onRuntimeHostAddressChange(event.target.value)}
            placeholder="host:port（例如 127.0.0.1:1919）"
            className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#292524] dark:bg-[#292524] dark:text-[#FAFAF9]"
          />
          <button
            type="button"
            data-testid="runtime-host-add-button"
            onClick={() => {
              void onRuntimeHostAdd();
            }}
            className="h-9 w-full rounded-lg bg-[#C75B3A] text-xs font-semibold text-white"
          >
            添加 exomind-rt
          </button>
        </div>

        {runtimeHostError && (
          <p className="mx-5 mt-2 rounded-md bg-[#EF444410] px-2 py-1 text-[11px] text-[#DC2626]">{runtimeHostError}</p>
        )}

        <div className="mt-3 space-y-2 px-5">
          {hostSnapshots.map((item) => (
            <div
              key={item.host.id}
              className="rounded-xl border border-[#E7E5E4] bg-[#FAF7F5] px-3 py-2 dark:border-[#292524] dark:bg-[#292524]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{item.host.name}</p>
                  <p className="truncate text-[11px] text-[#78716C] dark:text-[#A8A29E]">{item.host.host}:{item.host.port}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    data-testid={`runtime-host-status-${item.host.id}`}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      item.connectionState === 'online'
                        ? 'bg-[#22C55E20] text-[#16A34A]'
                        : item.connectionState === 'offline'
                          ? 'bg-[#EF444420] text-[#DC2626]'
                          : 'bg-[#F59E0B20] text-[#D97706]'
                    }`}
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
                  <button
                    type="button"
                    data-testid={`runtime-host-remove-${item.host.id}`}
                    onClick={() => {
                      void onRuntimeHostRemove(item.host.id);
                    }}
                    className="rounded bg-[#FEE2E2] px-2 py-1 text-[10px] text-[#B91C1C] dark:bg-[#451A1A] dark:text-[#FCA5A5]"
                  >
                    删除
                  </button>
                </div>
              </div>
              {item.error && <p className="mt-1 text-[10px] text-[#DC2626]">{item.error}</p>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function AgentsPage() {
  const [viewMode, setViewMode] = useState<AgentHubViewMode>('topology');
  const [topology, setTopology] = useState<AgentHubTopologyData>({ nodes: [], edges: [], selectedNodeId: null });
  const [listSections, setListSections] = useState<AgentHubListSection[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<AgentDeviceGroup[]>([]);
  const [runtimeHostSnapshots, setRuntimeHostSnapshots] = useState<RuntimeHostSnapshot[]>([]);
  const [runtimeHosts, setRuntimeHosts] = useState<RuntimeHostRecord[]>([]);
  const [runtimeServiceStatus, setRuntimeServiceStatus] = useState<RuntimeServiceStatus | null>(null);
  const [runtimeHostName, setRuntimeHostName] = useState('');
  const [runtimeHostAddress, setRuntimeHostAddress] = useState('');
  const [runtimeHostPort, setRuntimeHostPort] = useState('4077');
  const [runtimeHostModalName, setRuntimeHostModalName] = useState('');
  const [runtimeHostModalAddress, setRuntimeHostModalAddress] = useState('127.0.0.1:1919');
  const [runtimeHostError, setRuntimeHostError] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hostManagerOpen, setHostManagerOpen] = useState(false);

  const applyRuntimeSnapshot = (snapshot: { hosts: RuntimeHostSnapshot[]; agents: RuntimeAggregatedAgent[] }) => {
    setRuntimeHostSnapshots(snapshot.hosts);
    setListSections(buildListSectionsFromRuntimeAgents(snapshot.agents));
    setRuntimeHosts(
      snapshot.hosts.map((item) => ({
        ...item.host,
        status: mapHostConnectionToRecordStatus(item.connectionState),
        lastError: item.error,
      })),
    );
  };

  const refreshRuntimeSnapshot = async () => {
    const snapshot = await getRuntimeManager().refreshSnapshot();
    applyRuntimeSnapshot(snapshot);
  };

  useEffect(() => {
    let disposed = false;
    const service = getAgentHubService();
    const runtimeControlService = getRuntimeControlService();

    const load = async () => {
      const [nextTopology, nextDevice, nextRuntimeStatus, nextRuntimeSnapshot] = await Promise.all([
        service.getTopology(),
        service.getDeviceView(),
        runtimeControlService.getStatus(),
        getRuntimeManager().refreshSnapshot(),
      ]);
      if (disposed) return;
      setTopology(nextTopology);
      setSelectedNodeId(nextTopology.selectedNodeId ?? null);
      setDeviceGroups(nextDevice);
      setRuntimeServiceStatus(nextRuntimeStatus);
      applyRuntimeSnapshot(nextRuntimeSnapshot);
    };

    const refreshInterval = setInterval(() => {
      void (async () => {
        try {
          const nextRuntimeSnapshot = await getRuntimeManager().refreshSnapshot();
          if (disposed) return;
          applyRuntimeSnapshot(nextRuntimeSnapshot);
        } catch {
          // Ignore polling errors（轮询错误不打断页面渲染）
        }
      })();
    }, 8000);

    void load();

    return () => {
      disposed = true;
      clearInterval(refreshInterval);
    };
  }, []);

  const refreshRuntimeHosts = async () => {
    const nextSnapshot = await getRuntimeManager().refreshSnapshot();
    applyRuntimeSnapshot(nextSnapshot);
  };

  const handleAddRuntimeHost = async () => {
    const host = runtimeHostAddress.trim();
    const port = Number.parseInt(runtimeHostPort, 10);
    if (!host) {
      setRuntimeHostError('Host 不能为空');
      return;
    }
    if (!Number.isInteger(port) || port <= 0) {
      setRuntimeHostError('Port 非法');
      return;
    }

    try {
      setRuntimeHostError('');
      await getRuntimeManager().addHost({
        name: runtimeHostName.trim(),
        host,
        port,
      });
      setRuntimeHostName('');
      await refreshRuntimeHosts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeHostError(message);
    }
  };

  const handleAddRuntimeHostFromManagerSheet = async () => {
    try {
      setRuntimeHostError('');
      await getRuntimeManager().addHostFromAddress(runtimeHostModalAddress, runtimeHostModalName.trim());
      setRuntimeHostModalName('');
      await refreshRuntimeHosts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeHostError(message);
    }
  };

  const handleProbeRuntimeHost = async (hostId: string) => {
    try {
      setRuntimeHostError('');
      await getRuntimeManager().retryHost(hostId);
      await refreshRuntimeHosts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeHostError(message);
    }
  };

  const handleRemoveRuntimeHost = async (hostId: string) => {
    try {
      setRuntimeHostError('');
      await getRuntimeManager().removeHost(hostId);
      await refreshRuntimeHosts();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeHostError(message);
    }
  };

  const handleRuntimeStart = async () => {
    try {
      const status = await getRuntimeControlService().startRuntime({
        host: '127.0.0.1',
        port: 4077,
      });
      setRuntimeServiceStatus(status);
      await refreshRuntimeSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeServiceStatus({
        running: false,
        host: '127.0.0.1',
        port: 4077,
        error: message,
      });
    }
  };

  const handleRuntimeStop = async () => {
    try {
      const status = await getRuntimeControlService().stopRuntime();
      setRuntimeServiceStatus(status);
      await refreshRuntimeSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeServiceStatus({
        running: false,
        host: '127.0.0.1',
        port: 4077,
        error: message,
      });
    }
  };

  const navigateByPath = (path: string) => {
    window.location.href = path;
  };

  const content = useMemo(() => {
    if (viewMode === 'list') {
      return (
        <ListView
          sections={listSections}
          hostSnapshots={runtimeHostSnapshots}
          onRetryHost={handleProbeRuntimeHost}
          onItemNavigate={navigateByPath}
        />
      );
    }
    if (viewMode === 'device') {
      return (
        <DeviceView
          groups={deviceGroups}
          runtimeHosts={runtimeHosts}
          runtimeServiceStatus={runtimeServiceStatus}
          runtimeHostName={runtimeHostName}
          runtimeHostAddress={runtimeHostAddress}
          runtimeHostPort={runtimeHostPort}
          runtimeHostError={runtimeHostError}
          onRuntimeHostNameChange={setRuntimeHostName}
          onRuntimeHostAddressChange={setRuntimeHostAddress}
          onRuntimeHostPortChange={setRuntimeHostPort}
          onRuntimeHostAdd={handleAddRuntimeHost}
          onRuntimeHostProbe={handleProbeRuntimeHost}
          onRuntimeStart={handleRuntimeStart}
          onRuntimeStop={handleRuntimeStop}
        />
      );
    }
    return (
      <TopologyView
        topology={topology}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        onClearSelection={() => setSelectedNodeId(null)}
      />
    );
  }, [
    deviceGroups,
    listSections,
    runtimeHostSnapshots,
    runtimeHosts,
    runtimeHostName,
    runtimeHostAddress,
    runtimeHostPort,
    runtimeHostError,
    runtimeServiceStatus,
    selectedNodeId,
    topology,
    viewMode,
  ]);

  return (
    <div data-testid="agent-hub-page" className="relative min-h-full bg-[#FAF7F5] dark:bg-[#0C0A09]">
      <header className="flex items-center justify-between px-5 py-3">
        <h1 className="text-lg font-semibold leading-[1.5] text-[#1C1917] dark:text-[#FAFAF9]">Agent 网络</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
            aria-label="拓扑设置（Topology Settings）"
          >
            <Settings size={18} />
          </button>
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <button
            type="button"
            data-testid="agent-add-node-button"
            onClick={() => setSheetOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#C75B3A] text-white"
            aria-label="添加节点（Add Node）"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      <div className="px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-2">
        {content}
      </div>

      {sheetOpen && (
        <AddNodeSheet
          options={ADD_NODE_OPTIONS}
          onClose={() => setSheetOpen(false)}
          onAddDevice={() => setHostManagerOpen(true)}
        />
      )}

      {hostManagerOpen && (
        <RuntimeHostManagerSheet
          hostSnapshots={runtimeHostSnapshots}
          runtimeHostName={runtimeHostModalName}
          runtimeHostAddress={runtimeHostModalAddress}
          runtimeHostError={runtimeHostError}
          onRuntimeHostNameChange={setRuntimeHostModalName}
          onRuntimeHostAddressChange={setRuntimeHostModalAddress}
          onRuntimeHostAdd={handleAddRuntimeHostFromManagerSheet}
          onRuntimeHostProbe={handleProbeRuntimeHost}
          onRuntimeHostRemove={handleRemoveRuntimeHost}
          onClose={() => setHostManagerOpen(false)}
        />
      )}
    </div>
  );
}
