import {
  AlarmClock,
  Bot,
  Brain,
  ChevronRight,
  Filter,
  List,
  Mail,
  MessageCircle,
  Monitor,
  Plus,
  Rocket,
  Rss,
  Send,
  Settings,
  Sparkles,
  Waypoints,
  Webhook,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps as FlowNodeProps,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getUseMockDataEnabled } from '@/config/mock-data';
import {
  formatRuntimeTargetAddress,
  getRuntimeExternalAddress,
  getSelectedRuntimeTarget,
  setRuntimeExternalAddress,
  setRuntimeTargetMode,
  subscribeRuntimeTargetChanges,
  type RuntimeTargetMode,
} from '@/config/runtime-target';
import { getAgentHubService, SignalRouteService } from '@/lib/services';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import type { SignalRoute } from '@/lib/types/signal-pool';
import type {
  AgentDeviceGroup,
  AgentHubListItem,
  AgentHubListSection,
  AgentHubNodeStatus,
  AgentHubNodeType,
  RuntimeHostRecord,
  AgentHubViewMode,
  AgentHubRightPanelContext,
  RuntimeServiceStatus,
} from '@/lib/types/agent-hub';
import {
  getRuntimeManager,
  type RuntimeAggregatedAgent,
  type RuntimeHostSnapshot,
} from '@/services/runtime-manager';
import { RuntimeClient } from '@/services/runtime-client';
import {
  buildSignalGraph,
  buildSignalRouteRows,
  type SignalGraph,
  type SignalGraphNodeType,
} from './agents-signal-topology';

const VIEW_ITEMS: Array<{ id: AgentHubViewMode; icon: LucideIcon; label: string }> = [
  { id: 'topology', icon: Waypoints, label: '拓扑图' },
  { id: 'nodes', icon: Bot, label: '节点' },
  { id: 'routes', icon: List, label: '路由' },
  { id: 'device', icon: Monitor, label: '设备' },
];

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

const DIRECT_RUNTIME_PORT_CANDIDATES = [4077, 1950, 1949] as const;
const DIRECT_RUNTIME_PORT_STORAGE_KEY = 'exomind:agentHubRuntimePorts';

const MOCK_SIGNAL_ROUTES_FALLBACK: SignalRoute[] = [
  {
    id: 'mock-route-001',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'agent',
    target_ref: 'classifier',
    created_at: '2026-03-04T00:00:00.000Z',
    updated_at: '2026-03-04T00:00:00.000Z',
  },
  {
    id: 'mock-route-002',
    enabled: true,
    topic: 'user.input.text',
    target_type: 'actor',
    target_ref: 'eventlog',
    created_at: '2026-03-04T00:00:00.000Z',
    updated_at: '2026-03-04T00:00:00.000Z',
  },
  {
    id: 'mock-route-003',
    enabled: true,
    topic: 'session.end',
    target_type: 'agent',
    target_ref: 'reviewer',
    created_at: '2026-03-04T00:00:00.000Z',
    updated_at: '2026-03-04T00:00:00.000Z',
  },
  {
    id: 'mock-route-004',
    enabled: true,
    topic: 'timeblock.completed',
    target_type: 'agent',
    target_ref: 'reviewer',
    created_at: '2026-03-04T00:00:00.000Z',
    updated_at: '2026-03-04T00:00:00.000Z',
  },
  {
    id: 'mock-route-005',
    enabled: true,
    topic: 'input.classified',
    target_type: 'actor',
    target_ref: 'task',
    created_at: '2026-03-04T00:00:00.000Z',
    updated_at: '2026-03-04T00:00:00.000Z',
  },
  {
    id: 'mock-route-006',
    enabled: true,
    topic: '*',
    target_type: 'frontend',
    target_ref: 'ui',
    created_at: '2026-03-04T00:00:00.000Z',
    updated_at: '2026-03-04T00:00:00.000Z',
  },
];

const MOCK_RUNTIME_AGENTS_FALLBACK: RuntimeAggregatedAgent[] = [
  {
    id: 'classifier',
    name: 'Classifier Agent',
    description: 'mock route classifier',
    status: 'available',
    sourceHostId: 'mock-runtime',
    sourceHostName: 'mock-runtime',
    sourceHostAddress: 'mock',
  },
  {
    id: 'reviewer',
    name: 'Reviewer Agent',
    description: 'mock route reviewer',
    status: 'available',
    sourceHostId: 'mock-runtime',
    sourceHostName: 'mock-runtime',
    sourceHostAddress: 'mock',
  },
];

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

function formatHostUptime(uptimeSecs?: number): string {
  if (!uptimeSecs || uptimeSecs <= 0) return '--';
  const days = Math.floor(uptimeSecs / 86400);
  const hours = Math.floor((uptimeSecs % 86400) / 3600);
  const minutes = Math.floor((uptimeSecs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatHostMemory(usedMb?: number, totalMb?: number): string {
  if (typeof usedMb !== 'number' || typeof totalMb !== 'number' || totalMb <= 0) return '--';
  const usedGb = (usedMb / 1024).toFixed(1);
  const totalGb = (totalMb / 1024).toFixed(1);
  return `${usedGb} / ${totalGb} GB`;
}

function getHostStatusBadgeClass(connectionState: RuntimeHostSnapshot['connectionState']): string {
  if (connectionState === 'online') return 'bg-[#22C55E20] text-[#16A34A]';
  if (connectionState === 'offline') return 'bg-[#EF444420] text-[#DC2626]';
  return 'bg-[#F59E0B20] text-[#D97706]';
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

function sortRouteHostsByPriority(hosts: RuntimeHostSnapshot[]): RuntimeHostSnapshot[] {
  return [...hosts].sort((left, right) => {
    const leftScore = left.connectionState === 'online' ? 0 : left.connectionState === 'error' ? 1 : 2;
    const rightScore = right.connectionState === 'online' ? 0 : right.connectionState === 'error' ? 1 : 2;
    return leftScore - rightScore;
  });
}

function createDirectRuntimeHost(host: string, port: number): RuntimeHostRecord {
  const nowIso = new Date().toISOString();
  return {
    id: `runtime-direct-${host}-${port}`.replace(/[^\w-]/g, '-'),
    name: `${host}:${port}`,
    host,
    port,
    status: 'unknown',
    createdAt: nowIso,
    updatedAt: nowIso,
    isLocal: true,
  };
}

function getDirectRuntimePortCandidates(): number[] {
  if (typeof window === 'undefined') {
    return [...DIRECT_RUNTIME_PORT_CANDIDATES];
  }

  try {
    const raw = window.localStorage.getItem(DIRECT_RUNTIME_PORT_STORAGE_KEY);
    if (!raw) return [...DIRECT_RUNTIME_PORT_CANDIDATES];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DIRECT_RUNTIME_PORT_CANDIDATES];

    const ports = parsed
      .map((item) => Number(item))
      .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
    if (ports.length === 0) return [...DIRECT_RUNTIME_PORT_CANDIDATES];

    return Array.from(new Set(ports));
  } catch {
    return [...DIRECT_RUNTIME_PORT_CANDIDATES];
  }
}

function buildDirectRuntimeCandidates(hosts: RuntimeHostSnapshot[]): RuntimeHostRecord[] {
  const existing = new Set(hosts.map((item) => `${item.host.host}:${item.host.port}`));
  const hostCandidates = new Set<string>(['127.0.0.1']);
  const portCandidates = getDirectRuntimePortCandidates();

  if (typeof window !== 'undefined' && window.location?.hostname) {
    hostCandidates.add(window.location.hostname);
  }
  hostCandidates.add('localhost');

  const candidates: RuntimeHostRecord[] = [];
  for (const host of hostCandidates) {
    for (const port of portCandidates) {
      const key = `${host}:${port}`;
      if (existing.has(key)) continue;
      candidates.push(createDirectRuntimeHost(host, port));
    }
  }
  return candidates;
}

function mapRuntimeAgentsForHost(host: RuntimeHostRecord, agents: Array<{ id: string; name: string; description: string; status: string }>): RuntimeAggregatedAgent[] {
  return agents.map((agent) => ({
    ...agent,
    sourceHostId: host.id,
    sourceHostName: host.name,
    sourceHostAddress: `${host.host}:${host.port}`,
  }));
}

type SignalFlowNodeData = {
  label: string;
  subtitle: string;
  nodeType: SignalGraphNodeType;
};

type SignalFlowNodeType = FlowNode<SignalFlowNodeData, SignalGraphNodeType>;

function nodeTypeTint(nodeType: SignalGraphNodeType): string {
  if (nodeType === 'topic') return '#C75B3A';
  if (nodeType === 'agent') return '#0D9488';
  if (nodeType === 'actor') return '#F59E0B';
  return '#6366F1';
}

function SignalFlowNode({ data }: FlowNodeProps<SignalFlowNodeType>) {
  const tint = nodeTypeTint(data.nodeType);
  const handleBaseStyle = {
    width: 8,
    height: 8,
    border: 0,
    background: tint,
    opacity: 0,
    pointerEvents: 'none' as const,
  };
  if (data.nodeType === 'frontend') {
    return (
      <div className="relative h-[70px] w-[130px]">
        <Handle type="target" position={Position.Left} style={handleBaseStyle} />
        <Handle type="source" position={Position.Right} style={handleBaseStyle} />
        <div
          className="absolute left-1/2 top-1/2 h-[64px] w-[64px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-md border bg-white dark:bg-[#1C1917]"
          style={{ borderColor: `${tint}80` }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="max-w-[120px] truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{data.label}</p>
          <p className="mt-1 max-w-[120px] truncate text-[10px] text-[#78716C] dark:text-[#A8A29E]">{data.subtitle}</p>
        </div>
      </div>
    );
  }

  const shapeClass =
    data.nodeType === 'topic'
      ? 'rounded-full px-5 py-3'
      : data.nodeType === 'actor'
        ? 'rounded-xl px-4 py-3'
        : 'rounded-md px-4 py-3';

  return (
    <div
      className={`min-w-[120px] border bg-white text-center shadow-sm dark:bg-[#1C1917] ${shapeClass}`}
      style={{ borderColor: `${tint}80` }}
    >
      <Handle type="target" position={Position.Left} style={handleBaseStyle} />
      <Handle type="source" position={Position.Right} style={handleBaseStyle} />
      <p className="truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{data.label}</p>
      <p className="mt-1 truncate text-[10px] text-[#78716C] dark:text-[#A8A29E]">{data.subtitle}</p>
    </div>
  );
}

const SIGNAL_NODE_TYPES = {
  topic: SignalFlowNode,
  agent: SignalFlowNode,
  actor: SignalFlowNode,
  frontend: SignalFlowNode,
} as const;

function getDeviceTypeIcon(groupId: string): LucideIcon {
  if (groupId.includes('cloud')) return Waypoints;
  return Monitor;
}

function TabBar({
  value,
  onChange,
}: {
  value: AgentHubViewMode;
  onChange: (value: AgentHubViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-[10px] bg-[#F5F0ED] p-1 dark:bg-[#292524]">
      {VIEW_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? 'bg-white text-[#1C1917] shadow-sm dark:bg-[#1C1917] dark:text-[#FAFAF9]'
                : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]'
            }`}
            aria-selected={active}
          >
            <Icon size={14} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function TopologyView({
  graph,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
}: {
  graph: SignalGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
}) {
  const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const activeEdgeColor = isDarkMode ? '#FB923C' : '#C75B3A';
  const inactiveEdgeColor = isDarkMode ? '#57534E' : '#A8A29E';
  const edgeLabelColor = isDarkMode ? '#D6D3D1' : '#78716C';
  const edgeLabelBgColor = isDarkMode ? '#1C1917' : '#FAF7F5';
  const backgroundDotColor = isDarkMode ? '#44403C' : '#E7E5E4';

  const selectedNode = graph.nodes.find((item) => item.id === selectedNodeId) ?? null;

  const nextFlowNodes = useMemo<SignalFlowNodeType[]>(() => {
    return graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      draggable: true,
      data: {
        label: node.label,
        subtitle: node.status,
        nodeType: node.type,
      },
    }));
  }, [graph.nodes]);
  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState<SignalFlowNodeType>(nextFlowNodes);

  useEffect(() => {
    setFlowNodes(nextFlowNodes);
  }, [nextFlowNodes, setFlowNodes]);

  const flowEdges = useMemo<FlowEdge[]>(() => {
    return graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: edge.active,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
      },
      style: edge.active
        ? { stroke: activeEdgeColor, strokeWidth: 1.7 }
        : { stroke: inactiveEdgeColor, strokeWidth: 1.2, strokeDasharray: '5 4' },
      label: `${edge.topic} → ${edge.targetRef}`,
      labelStyle: {
        fill: edgeLabelColor,
        fontSize: 10,
        fontWeight: 500,
      },
      labelBgStyle: {
        fill: edgeLabelBgColor,
        fillOpacity: 0.95,
      },
      data: {
        active: edge.active,
      },
    }));
  }, [activeEdgeColor, edgeLabelBgColor, edgeLabelColor, graph.edges, inactiveEdgeColor]);

  return (
    <section data-testid="agent-topology-view" className="space-y-3" onClick={onClearSelection}>
      <div
        data-testid="agent-topology-canvas"
        className="relative h-[568px] overflow-hidden rounded-[22px] border border-[#EDE8E3] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#1C1917]"
      >
        <ReactFlow
          data-testid="agent-signal-flow"
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={SIGNAL_NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.8}
          onNodesChange={onFlowNodesChange}
          onNodeClick={(_, node: SignalFlowNodeType) => {
            onSelectNode(node.id);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} color={backgroundDotColor} />
          <Controls showInteractive />
        </ReactFlow>
      </div>

      {selectedNode && (
        <div
          data-testid="agent-topology-node-detail-card"
          className="rounded-2xl border border-[#E7E5E4] bg-[#1C1917] px-4 py-3 text-white dark:border-[#44403C] dark:bg-[#0C0A09]"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-sm font-semibold">{selectedNode.label}</p>
          <p className="mt-1 text-xs text-white/80">状态：{selectedNode.status}</p>
          <p className="mt-1 text-xs text-white/60">类型：{selectedNode.type}</p>
        </div>
      )}
    </section>
  );
}

function DeviceView({
  groups,
  runtimeHostSnapshots,
  runtimeServiceStatus,
  runtimeHostError,
  runtimeTargetMode,
  runtimeTargetAddress,
  runtimeTargetError,
  runtimeExternalAddressDraft,
  onRuntimeHostProbe,
  onRuntimeStart,
  onRuntimeStop,
  onRuntimeTargetModeChange,
  onRuntimeExternalAddressDraftChange,
  onApplyRuntimeExternalAddress,
  onOpenHostManager,
}: {
  groups: AgentDeviceGroup[];
  runtimeHostSnapshots: RuntimeHostSnapshot[];
  runtimeServiceStatus: RuntimeServiceStatus | null;
  runtimeHostError: string;
  runtimeTargetMode: RuntimeTargetMode;
  runtimeTargetAddress: string;
  runtimeTargetError: string;
  runtimeExternalAddressDraft: string;
  onRuntimeHostProbe: (hostId: string) => Promise<void>;
  onRuntimeStart: () => Promise<void>;
  onRuntimeStop: () => Promise<void>;
  onRuntimeTargetModeChange: (mode: RuntimeTargetMode) => void;
  onRuntimeExternalAddressDraftChange: (value: string) => void;
  onApplyRuntimeExternalAddress: () => void;
  onOpenHostManager: () => void;
}) {
  const hostCard = groups.flatMap((group) => group.cards).find((card) => card.isHost) ?? groups[0]?.cards[0];
  const isEmbeddedTarget = runtimeTargetMode === 'embedded';

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
                内嵌 RT（4077）
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
            placeholder="host:port（例如 127.0.0.1:4077）"
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

function RoutesTabView({
  routes,
  hostLabel,
  onToggle,
  onDelete,
  onEdit,
  onAdd,
}: {
  routes: SignalRoute[];
  hostLabel?: string;
  onToggle: (routeId: string, enabled: boolean) => Promise<void>;
  onDelete: (routeId: string) => Promise<void>;
  onEdit: (routeId: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
            信号路由
          </span>
          {hostLabel && (
            <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 font-mono text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
              {hostLabel}
            </span>
          )}
          <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">{routes.length} 条</span>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 rounded-[8px] bg-[#C75B3A] px-3 py-1.5 text-xs text-white"
        >
          <Plus size={12} />
          添加路由
        </button>
      </div>

      {/* Table */}
      {routes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Waypoints size={32} className="text-[#A8A29E]" />
          <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">暂无信号路由</p>
          <p className="text-xs text-[#A8A29E]">点击「添加路由」创建第一条路由</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-[#E7E3E0] dark:border-[#292524]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E7E3E0] bg-[#F5F0ED] dark:border-[#292524] dark:bg-[#1C1917]">
                <th className="w-12 px-4 py-2.5 text-left text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  启用
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  Topic
                </th>
                <th className="w-6 py-2.5 text-center text-xs text-[#A8A29E]">→</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  类型
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  目标
                </th>
                <th className="w-24 px-4 py-2.5 text-right text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E7E3E0] dark:divide-[#292524]">
              {routes.map((route) => (
                <tr
                  key={route.id}
                  className="cursor-pointer bg-white transition-colors hover:bg-[#FAF7F5] dark:bg-[#0C0A09] dark:hover:bg-[#1C1917]"
                  onClick={() => onEdit(route.id)}
                >
                  {/* 启用开关 */}
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => void onToggle(route.id, !route.enabled)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        route.enabled ? 'bg-[#22C55E]' : 'bg-[#D6D3D1] dark:bg-[#57534E]'
                      }`}
                      aria-label={route.enabled ? '禁用' : '启用'}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                          route.enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </td>
                  {/* Topic */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-[#1C1917] dark:text-[#FAFAF9]">
                      {route.topic}
                    </span>
                  </td>
                  {/* 箭头 */}
                  <td className="py-3 text-center text-[#A8A29E]">→</td>
                  {/* target_type */}
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        route.target_type === 'agent'
                          ? 'bg-[#CCFBF1] text-[#0D9488] dark:bg-[#0D9488]/20 dark:text-[#2DD4BF]'
                          : route.target_type === 'actor'
                          ? 'bg-[#FEF3C7] text-[#B45309] dark:bg-[#F59E0B]/20 dark:text-[#FCD34D]'
                          : 'bg-[#DBEAFE] text-[#1D4ED8] dark:bg-[#3B82F6]/20 dark:text-[#93C5FD]'
                      }`}
                    >
                      {route.target_type}
                    </span>
                  </td>
                  {/* target_ref */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-[#44403C] dark:text-[#D6D3D1]">
                      {route.target_ref}
                    </span>
                  </td>
                  {/* 操作 */}
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(route.id)}
                        className="rounded px-2 py-1 text-[10px] text-[#78716C] hover:bg-[#F5F0ED] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:bg-[#292524] dark:hover:text-[#FAFAF9]"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(route.id)}
                        className="rounded px-2 py-1 text-[10px] text-[#DC2626] hover:bg-[#FEE2E2] dark:text-[#FCA5A5] dark:hover:bg-[#451A1A]"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type NodeFilterType = 'all' | 'input' | 'agent' | 'actor' | 'output';

const NODE_FILTER_ITEMS: Array<{ id: NodeFilterType; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'input', label: '信号输入' },
  { id: 'agent', label: 'Agent' },
  { id: 'actor', label: 'Actor' },
  { id: 'output', label: '输出' },
];

function NodesTabView({
  sections,
  filter,
  onFilterChange,
  onNodeClick,
}: {
  sections: AgentHubListSection[];
  filter: NodeFilterType;
  onFilterChange: (f: NodeFilterType) => void;
  onNodeClick: (item: AgentHubListItem) => void;
}) {
  const filteredItems = useMemo(() => {
    const allItems = sections.flatMap((s) => s.items);
    if (filter === 'all') return allItems;
    const typeMap: Record<NodeFilterType, AgentHubNodeType | null> = {
      all: null,
      input: 'input',
      agent: 'agent',
      actor: 'actor',
      output: 'output',
    };
    const targetType = typeMap[filter];
    return targetType ? allItems.filter((item) => item.type === targetType) : allItems;
  }, [sections, filter]);

  return (
    <div className="flex flex-col gap-3">
      {/* Filter 栏 */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {NODE_FILTER_ITEMS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilterChange(f.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.id
                ? 'bg-[#C75B3A] text-white'
                : 'bg-[#F5F0ED] text-[#78716C] hover:bg-[#E7E3E0] dark:bg-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#3C3836]'
            }`}
          >
            {f.label}
            {filter === f.id && f.id !== 'all' && (
              <span className="ml-1 opacity-80">({filteredItems.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* 节点列表 */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Bot size={32} className="text-[#A8A29E]" />
          <p className="text-sm text-[#78716C] dark:text-[#A8A29E]">
            {filter === 'all' ? '暂无节点' : `暂无${NODE_FILTER_ITEMS.find(f => f.id === filter)?.label}节点`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[#E7E3E0] overflow-hidden rounded-[10px] border border-[#E7E3E0] dark:divide-[#292524] dark:border-[#292524]">
          {filteredItems.map((item) => {
            const Icon = getListItemIcon(item);
            const statusColor: Record<AgentHubNodeStatus, string> = {
              running: 'bg-[#22C55E]',
              idle: 'bg-[#D6D3D1] dark:bg-[#57534E]',
              warning: 'bg-[#F59E0B]',
              offline: 'bg-[#EF4444]',
            };
            const statusLabel: Record<AgentHubNodeStatus, string> = {
              running: '运行中',
              idle: '空闲',
              warning: '警告',
              offline: '离线',
            };
            return (
              <div
                key={item.id}
                className="flex cursor-pointer items-center gap-3 bg-white px-4 py-3 transition-colors hover:bg-[#FAF7F5] dark:bg-[#0C0A09] dark:hover:bg-[#1C1917]"
                onClick={() => onNodeClick(item)}
              >
                {/* Icon */}
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${
                    item.type === 'agent'
                      ? 'bg-[#CCFBF1] dark:bg-[#0D9488]/20'
                      : item.type === 'actor'
                      ? 'bg-[#FEF3C7] dark:bg-[#F59E0B]/20'
                      : item.type === 'input'
                      ? 'bg-[#FFEDD5] dark:bg-[#F97316]/20'
                      : 'bg-[#DBEAFE] dark:bg-[#3B82F6]/20'
                  }`}
                >
                  <Icon
                    size={16}
                    className={
                      item.type === 'agent'
                        ? 'text-[#0D9488]'
                        : item.type === 'actor'
                        ? 'text-[#B45309] dark:text-[#F59E0B]'
                        : item.type === 'input'
                        ? 'text-[#EA580C]'
                        : 'text-[#1D4ED8] dark:text-[#60A5FA]'
                    }
                  />
                </div>
                {/* 内容 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                      {item.name}
                    </span>
                    {item.badgeText && (
                      <span className="shrink-0 rounded-full bg-[#F5F0ED] px-1.5 py-0.5 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                        {item.badgeText}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <p className="mt-0.5 truncate text-xs text-[#78716C] dark:text-[#A8A29E]">
                      {item.description}
                    </p>
                  )}
                </div>
                {/* 状态 badge */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${statusColor[item.status]}`} />
                  <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">
                    {statusLabel[item.status]}
                  </span>
                </div>
                <ChevronRight size={14} className="shrink-0 text-[#A8A29E]" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AgentsPage() {
  const initialRuntimeTarget = getSelectedRuntimeTarget();
  const [viewMode, setViewMode] = useState<AgentHubViewMode>('topology');
  const [nodesFilter, setNodesFilter] = useState<NodeFilterType>('all');
  const [signalRoutes, setSignalRoutes] = useState<SignalRoute[]>([]);
  const [signalRouteHostLabel, setSignalRouteHostLabel] = useState<string>('');
  const [fallbackRuntimeAgents, setFallbackRuntimeAgents] = useState<RuntimeAggregatedAgent[]>([]);
  const [listSections, setListSections] = useState<AgentHubListSection[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<AgentDeviceGroup[]>([]);
  const [runtimeHostSnapshots, setRuntimeHostSnapshots] = useState<RuntimeHostSnapshot[]>([]);
  const [runtimeServiceStatus, setRuntimeServiceStatus] = useState<RuntimeServiceStatus | null>(null);
  const [runtimeHostModalName, setRuntimeHostModalName] = useState('');
  const [runtimeHostModalAddress, setRuntimeHostModalAddress] = useState('127.0.0.1:4077');
  const [runtimeHostError, setRuntimeHostError] = useState('');
  const [runtimeTargetModeValue, setRuntimeTargetModeValue] = useState<RuntimeTargetMode>(initialRuntimeTarget.mode);
  const [runtimeTargetAddress, setRuntimeTargetAddress] = useState(
    formatRuntimeTargetAddress(initialRuntimeTarget),
  );
  const [runtimeExternalAddressDraft, setRuntimeExternalAddressDraft] = useState(
    getRuntimeExternalAddress(),
  );
  const [runtimeTargetError, setRuntimeTargetError] = useState('');
  const [rightPanel, setRightPanel] = useState<AgentHubRightPanelContext>({ state: 'CLOSED' });

  const openRouteEdit = (routeId: string | null = null) => {
    setRightPanel({ state: 'ROUTE_EDIT', routeId });
  };
  const openAgentDetail = (nodeId: string) => {
    setRightPanel({ state: 'AGENT_DETAIL', nodeId });
  };
  const openActorDetail = (nodeId: string) => {
    setRightPanel({ state: 'ACTOR_DETAIL', nodeId });
  };
  const openSignalDetail = (signalId: string) => {
    setRightPanel({ state: 'SIGNAL_DETAIL', signalId });
  };
  const closeRightPanel = () => {
    setRightPanel({ state: 'CLOSED' });
  };

  // T5/T8 阶段使用
  void openSignalDetail;

  const handleRouteToggle = async (routeId: string, enabled: boolean) => {
    try {
      const host = sortRouteHostsByPriority(runtimeHostSnapshots).find((s) => s.host)?.host;
      if (!host) return;
      const routeService = new SignalRouteService({ host });
      await routeService.updateRoute(routeId, { enabled });
      await refreshSignalRoutesFromSnapshot({ hosts: runtimeHostSnapshots });
    } catch (err) {
      console.error('Failed to toggle route:', err);
    }
  };

  const handleRouteDelete = async (routeId: string) => {
    try {
      const host = sortRouteHostsByPriority(runtimeHostSnapshots).find((s) => s.host)?.host;
      if (!host) return;
      const routeService = new SignalRouteService({ host });
      await routeService.deleteRoute(routeId);
      await refreshSignalRoutesFromSnapshot({ hosts: runtimeHostSnapshots });
      closeRightPanel();
    } catch (err) {
      console.error('Failed to delete route:', err);
    }
  };

  const handleTabChange = (tab: AgentHubViewMode) => {
    setViewMode(tab);
    closeRightPanel(); // 切换 Tab 时关闭右侧栏（保守策略）
  };

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hostManagerOpen, setHostManagerOpen] = useState(false);

  const applyRuntimeSnapshot = (snapshot: { hosts: RuntimeHostSnapshot[]; agents: RuntimeAggregatedAgent[] }) => {
    setRuntimeHostSnapshots(snapshot.hosts);
    setListSections(buildListSectionsFromRuntimeAgents(snapshot.agents));
  };

  const syncRuntimeTargetState = (target = getSelectedRuntimeTarget()) => {
    setRuntimeTargetModeValue(target.mode);
    setRuntimeTargetAddress(formatRuntimeTargetAddress(target));
    setRuntimeExternalAddressDraft(getRuntimeExternalAddress());
  };

  const tryLoadRoutesFromHost = async (
    host: RuntimeHostRecord
  ): Promise<{ hostLabel: string; routes: SignalRoute[]; agents: RuntimeAggregatedAgent[] } | null> => {
    try {
      const routeService = new SignalRouteService({ host });
      const routes = await routeService.listRoutes();
      const runtimeClient = new RuntimeClient();
      const agentsResult = await runtimeClient.getAgents(host);
      const agents = agentsResult.ok ? mapRuntimeAgentsForHost(host, agentsResult.data) : [];
      return {
        hostLabel: `${host.host}:${host.port}`,
        routes,
        agents,
      };
    } catch {
      return null;
    }
  };

  const refreshSignalRoutesFromSnapshot = async (
    snapshot: { hosts: RuntimeHostSnapshot[] },
    isDisposed: () => boolean = () => false
  ) => {
    const useMockData = getUseMockDataEnabled();
    if (useMockData) {
      if (isDisposed()) return;
      setSignalRouteHostLabel('mock（测试数据）');
      setSignalRoutes(MOCK_SIGNAL_ROUTES_FALLBACK);
      setFallbackRuntimeAgents(MOCK_RUNTIME_AGENTS_FALLBACK);
      setListSections(buildListSectionsFromRuntimeAgents(MOCK_RUNTIME_AGENTS_FALLBACK));
      return;
    }

    const snapshotAgents = snapshot.hosts.flatMap((item) => item.agents);
    const configuredHosts = sortRouteHostsByPriority(snapshot.hosts).map((item) => item.host);
    for (const host of configuredHosts) {
      const result = await tryLoadRoutesFromHost(host);
      if (!result) continue;
      if (isDisposed()) return;
      setSignalRouteHostLabel(result.hostLabel);
      setSignalRoutes(result.routes);
      setFallbackRuntimeAgents(result.agents);
      if (snapshotAgents.length === 0 && result.agents.length > 0) {
        setListSections(buildListSectionsFromRuntimeAgents(result.agents));
      }
      return;
    }

    const directCandidates = buildDirectRuntimeCandidates(snapshot.hosts);
    for (const host of directCandidates) {
      const result = await tryLoadRoutesFromHost(host);
      if (!result) continue;
      if (isDisposed()) return;
      setSignalRouteHostLabel(`${result.hostLabel}（auto）`);
      setSignalRoutes(result.routes);
      setFallbackRuntimeAgents(result.agents);
      if (snapshotAgents.length === 0 && result.agents.length > 0) {
        setListSections(buildListSectionsFromRuntimeAgents(result.agents));
      }
      return;
    }

    if (isDisposed()) return;
    setSignalRouteHostLabel('');
    setSignalRoutes([]);
    setFallbackRuntimeAgents([]);
  };

  const refreshRuntimeSnapshot = async () => {
    const snapshot = await getRuntimeManager().refreshSnapshot();
    applyRuntimeSnapshot(snapshot);
    await refreshSignalRoutesFromSnapshot(snapshot);
  };

  useEffect(() => {
    let disposed = false;
    const service = getAgentHubService();
    const runtimeControlService = getRuntimeControlService();

    const load = async () => {
      const [nextDevice, nextRuntimeStatus, nextRuntimeSnapshot] = await Promise.all([
        service.getDeviceView(),
        runtimeControlService.getStatus(),
        getRuntimeManager().refreshSnapshot(),
      ]);
      if (disposed) return;
      setDeviceGroups(nextDevice);
      setRuntimeServiceStatus(nextRuntimeStatus);
      applyRuntimeSnapshot(nextRuntimeSnapshot);
      await refreshSignalRoutesFromSnapshot(nextRuntimeSnapshot, () => disposed);
    };

    const refreshInterval = setInterval(() => {
      void (async () => {
        try {
          const nextRuntimeSnapshot = await getRuntimeManager().refreshSnapshot();
          if (disposed) return;
          applyRuntimeSnapshot(nextRuntimeSnapshot);
          await refreshSignalRoutesFromSnapshot(nextRuntimeSnapshot, () => disposed);
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

  useEffect(() => {
    syncRuntimeTargetState();
    const unsubscribe = subscribeRuntimeTargetChanges((target) => {
      syncRuntimeTargetState(target);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const refreshRuntimeHosts = async () => {
    const nextSnapshot = await getRuntimeManager().refreshSnapshot();
    applyRuntimeSnapshot(nextSnapshot);
    await refreshSignalRoutesFromSnapshot(nextSnapshot);
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

  const handleRuntimeTargetModeChange = (mode: RuntimeTargetMode) => {
    setRuntimeTargetError('');
    setRuntimeTargetMode(mode);
    syncRuntimeTargetState();
  };

  const handleApplyRuntimeExternalAddress = () => {
    try {
      setRuntimeTargetError('');
      setRuntimeExternalAddress(runtimeExternalAddressDraft);
      setRuntimeTargetMode('external');
      syncRuntimeTargetState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeTargetError(message);
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

  const signalRouteRows = useMemo(
    () => buildSignalRouteRows(signalRoutes, signalRouteHostLabel || undefined),
    [signalRouteHostLabel, signalRoutes]
  );

  const graphAgents = useMemo(() => {
    const runtimeAgents = runtimeHostSnapshots.flatMap((item) => item.agents);
    if (runtimeAgents.length > 0) return runtimeAgents;
    return fallbackRuntimeAgents;
  }, [fallbackRuntimeAgents, runtimeHostSnapshots]);

  const signalGraph = useMemo(
    () => buildSignalGraph(signalRoutes, graphAgents),
    [graphAgents, signalRoutes]
  );

  useEffect(() => {
    if (!selectedNodeId) return;
    if (signalGraph.nodes.some((node) => node.id === selectedNodeId)) return;
    setSelectedNodeId(null);
  }, [selectedNodeId, signalGraph.nodes]);

  const content = useMemo(() => {
    if (viewMode === 'routes') {
      return (
        <RoutesTabView
          routes={signalRoutes}
          hostLabel={signalRouteHostLabel || undefined}
          onToggle={handleRouteToggle}
          onDelete={handleRouteDelete}
          onEdit={(routeId) => openRouteEdit(routeId)}
          onAdd={() => openRouteEdit(null)}
        />
      );
    }
    if (viewMode === 'nodes') {
      return (
        <NodesTabView
          sections={listSections}
          filter={nodesFilter}
          onFilterChange={setNodesFilter}
          onNodeClick={(item) => {
            if (item.type === 'agent') openAgentDetail(item.id);
            else if (item.type === 'actor') openActorDetail(item.id);
          }}
        />
      );
    }
    if (viewMode === 'device') {
      return (
        <DeviceView
          groups={deviceGroups}
          runtimeHostSnapshots={runtimeHostSnapshots}
          runtimeServiceStatus={runtimeServiceStatus}
          runtimeHostError={runtimeHostError}
          runtimeTargetMode={runtimeTargetModeValue}
          runtimeTargetAddress={runtimeTargetAddress}
          runtimeTargetError={runtimeTargetError}
          runtimeExternalAddressDraft={runtimeExternalAddressDraft}
          onRuntimeHostProbe={handleProbeRuntimeHost}
          onRuntimeStart={handleRuntimeStart}
          onRuntimeStop={handleRuntimeStop}
          onRuntimeTargetModeChange={handleRuntimeTargetModeChange}
          onRuntimeExternalAddressDraftChange={setRuntimeExternalAddressDraft}
          onApplyRuntimeExternalAddress={handleApplyRuntimeExternalAddress}
          onOpenHostManager={() => setHostManagerOpen(true)}
        />
      );
    }
    return (
      <TopologyView
        graph={signalGraph}
        selectedNodeId={selectedNodeId}
        onSelectNode={(nodeId) => {
          setSelectedNodeId(nodeId);
          // 判断节点类型
          const node = signalGraph.nodes.find((n) => n.id === nodeId);
          if (node?.type === 'agent') openAgentDetail(nodeId);
          else if (node?.type === 'actor') openActorDetail(nodeId);
        }}
        onClearSelection={() => {
          setSelectedNodeId(null);
          closeRightPanel();
        }}
      />
    );
  }, [
    deviceGroups,
    listSections,
    runtimeHostSnapshots,
    signalGraph,
    signalRouteHostLabel,
    signalRouteRows,
    runtimeHostError,
    runtimeTargetAddress,
    runtimeTargetError,
    runtimeTargetModeValue,
    runtimeExternalAddressDraft,
    runtimeServiceStatus,
    nodesFilter,
    selectedNodeId,
    viewMode,
  ]);

  return (
    <div data-testid="agent-hub-page" className="relative flex min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]">
      {/* Header */}
      <header className="flex flex-col gap-2 px-5 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold leading-[1.5] text-[#1C1917] dark:text-[#FAFAF9]">Agent Hub</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5F0ED] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]"
              aria-label="设置"
            >
              <Settings size={18} />
            </button>
            <button
              type="button"
              data-testid="agent-add-node-button"
              onClick={() => setSheetOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[#C75B3A] px-3 text-sm text-white"
              aria-label="添加节点"
            >
              <Plus size={16} />
              添加
            </button>
          </div>
        </div>
        {/* Tab Bar（桌面端内嵌到 header，移动端显示在 header 下方） */}
        <TabBar value={viewMode} onChange={handleTabChange} />
      </header>

      {/* 主内容区：桌面端三栏（内容区 + 右侧栏），移动端单栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 内容区 */}
        <div className="flex-1 overflow-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-2">
          {content}
        </div>

        {/* 右侧栏：桌面端固定 380px，CLOSED 时不渲染 */}
        {rightPanel.state !== 'CLOSED' && (
          <aside className="hidden w-[380px] shrink-0 border-l border-[#292524] bg-[#1C1917] md:flex md:flex-col">
            <div className="flex items-center justify-between border-b border-[#292524] px-4 py-3">
              <span className="text-sm font-medium text-[#FAFAF9]">
                {rightPanel.state === 'ROUTE_EDIT' && (rightPanel.routeId ? '编辑路由' : '新建路由')}
                {rightPanel.state === 'AGENT_DETAIL' && 'Agent 详情'}
                {rightPanel.state === 'ACTOR_DETAIL' && 'Actor 详情'}
                {rightPanel.state === 'SIGNAL_DETAIL' && '信号详情'}
                {rightPanel.state === 'AGENT_CHAT' && 'Agent 对话'}
              </span>
              <button
                type="button"
                onClick={closeRightPanel}
                className="flex h-7 w-7 items-center justify-center rounded text-[#A8A29E] hover:text-[#FAFAF9]"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
            {/* 右侧栏内容占位（T5/T8 阶段填充） */}
            <div className="flex-1 p-4">
              <p className="text-xs text-[#78716C]">
                {rightPanel.state} — 待实现（T5/T8）
              </p>
            </div>
          </aside>
        )}
      </div>

      {/* Sheets（移动端） */}
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
