import {
  AlarmClock,
  Bot,
  Brain,
  ChevronRight,
  Crosshair,
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
import { useEffect, useMemo, useRef, useState } from 'react';
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
  type ReactFlowInstance,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getUseMockDataEnabled } from '@/config/mock-data';
import { resolveLocalServiceHost } from '@/config/local-service-host';
import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  DEFAULT_EXTERNAL_RUNTIME_PORT,
  getEmbeddedRuntimeNetworkMode,
  getPreferredEmbeddedRuntimePort,
  formatRuntimeTargetAddress,
  getRuntimeExternalAddress,
  getSelectedRuntimeTarget,
  resolveEmbeddedRuntimeBindHost,
  setEmbeddedRuntimeNetworkMode,
  setRuntimeExternalAddress,
  setRuntimeTargetMode,
  subscribeRuntimeTargetChanges,
  type EmbeddedRuntimeNetworkMode,
  type RuntimeTargetMode,
} from '@/config/runtime-target';
import { RouteEditPanel } from '@/components/RouteEditPanel';
import { getAgentHubService, SignalRouteService } from '@/lib/services';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import { KNOWN_AGENT_HUB_TOPICS, VOICE_INPUT_TRANSCRIPT_TOPIC } from '@/lib/constants/signal-topics';
import type { SignalEvent, SignalRoute } from '@/lib/types/signal-pool';
import type {
  AgentConversationMessage,
  AgentDetailData,
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
  findPreferredRuntimeHostForAgent,
  type RuntimeAggregatedAgent,
  type RuntimeHostSnapshot,
} from '@/services/runtime-manager';
import { RuntimeClient } from '@/services/runtime-client';
import type { RuntimeCreateAgentRequest } from '@/services/runtime-client';
import {
  createProviderProfile,
  listProviderProfiles,
  markProviderProfileUsed,
  resolveProviderProfile,
} from '@/lib/agent-provider/provider-profile-storage';
import type { ApiProviderId, ProviderProfileMeta } from '@/lib/agent-provider/types';
import {
  buildSignalGraph,
  buildSignalRouteRows,
  type SignalGraph,
  type SignalGraphNodeType,
  type SignalRouteRow,
} from './agents-signal-topology';
import {
  applyManualLayoutSnapshot,
  buildAutoFlowLayout,
  buildManualLayoutSnapshot,
  buildTopologyDatasetKey,
  buildTopologyFilterKey,
  clearTopologyScopeLayouts,
  getTopologyLayoutSnapshot,
  readTopologyLayoutStore,
  removeTopologyLayoutSnapshot,
  setTopologyLayoutSnapshot,
  writeTopologyLayoutStore,
  type TopologyLayoutMode,
  type TopologyLayoutStore,
  type TopologyNodePosition,
  type TopologyViewport,
} from './topology-layout';
import { Switch } from '@/components/ui/switch';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import {
  appendAdjacentConversationDelta,
  appendConversationChunk,
  appendConversationMessage,
  createConversationMessage,
  formatRuntimeEventPayload,
  getConversationMessageTestId,
} from './agents/conversation-runtime';
import { WorkspaceTabs } from './agents/WorkspaceTabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const VIEW_ITEMS: Array<{ id: AgentHubViewMode; icon: LucideIcon; label: string }> = [
  { id: 'topology', icon: Waypoints, label: '拓扑图' },
  { id: 'list', icon: Bot, label: '节点' },
  { id: 'history', icon: AlarmClock, label: '信号历史' },
  { id: 'routes', icon: List, label: '路由' },
  { id: 'device', icon: Monitor, label: '设备' },
];

type AddNodeOption = {
  id: RuntimeCreateAgentRequest['kind'] | 'device';
  title: string;
  description: string;
  tintColor: string;
};

const ADD_NODE_OPTIONS: AddNodeOption[] = [
  {
    id: 'claude_cli',
    title: 'Claude CLI',
    description: '在 Runtime 中创建 Claude CLI Agent',
    tintColor: '#C75B3A',
  },
  {
    id: 'codex_cli',
    title: 'Codex CLI',
    description: '在 Runtime 中创建 Codex CLI Agent',
    tintColor: '#0D9488',
  },
  {
    id: 'api',
    title: 'API Agent',
    description: '通过 OpenAI / Anthropic 接口创建 Agent',
    tintColor: '#2563EB',
  },
  {
    id: 'echo',
    title: 'Echo Agent',
    description: '本地回显测试 Agent',
    tintColor: '#78716C',
  },
  {
    id: 'device',
    title: '添加设备',
    description: '连接 exomind-rt 主机并聚合 Agent 列表',
    tintColor: '#0D9488',
  },
];

const DIRECT_RUNTIME_PORT_CANDIDATES = Array.from(
  new Set([DEFAULT_EMBEDDED_RUNTIME_PORT, 1950, 1949]),
);
const DIRECT_RUNTIME_PORT_STORAGE_KEY = 'exomind:agentHubRuntimePorts';

const MOCK_SIGNAL_ROUTES_FALLBACK: SignalRoute[] = [
  {
    id: 'mock-route-000',
    enabled: true,
    topic: VOICE_INPUT_TRANSCRIPT_TOPIC,
    target_type: 'agent',
    target_ref: 'classifier',
    created_at: '2026-03-04T00:00:00.000Z',
    updated_at: '2026-03-04T00:00:00.000Z',
  },
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
  if (optionId === 'claude_cli') return Brain;
  if (optionId === 'codex_cli') return Bot;
  if (optionId === 'api') return Webhook;
  if (optionId === 'echo') return MessageCircle;
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

function getEmbeddedRuntimeModeLabel(mode: EmbeddedRuntimeNetworkMode): string {
  return mode === 'lan' ? '局域网（LAN）' : '仅本机（Local only）';
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
    hostCandidates.add(resolveLocalServiceHost(window.location.hostname));
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

function resolveRuntimeEntityId(rawId: string): string {
  if (rawId.includes('__')) {
    return rawId.split('__').slice(1).join('__') || rawId;
  }
  if (rawId.includes(':')) {
    return rawId.split(':').slice(1).join(':') || rawId;
  }
  return rawId;
}

function extractPreferredHostId(rawId: string | null | undefined): string | undefined {
  if (!rawId?.includes('__')) return undefined;
  const [hostId] = rawId.split('__');
  return hostId || undefined;
}

function formatSignalPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'text' in payload) {
    const payloadRecord = payload as Record<string, unknown>;
    if (typeof payloadRecord.text === 'string') {
      return payloadRecord.text;
    }
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function formatSignalTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return '--';
  }
  const date = new Date(timestampMs);
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

type SignalFlowNodeData = {
  label: string;
  subtitle: string;
  nodeType: SignalGraphNodeType;
};

type SignalFlowNodeType = FlowNode<SignalFlowNodeData, SignalGraphNodeType>;
const TOPOLOGY_SCOPE_KEY = 'global';

function nodeTypeTint(nodeType: SignalGraphNodeType): string {
  if (nodeType === 'signal-input') return '#8B5CF6';
  if (nodeType === 'topic') return '#C75B3A';
  if (nodeType === 'agent') return '#0D9488';
  if (nodeType === 'actor') return '#F59E0B';
  return '#6366F1';
}

function signalNodeTypeBadgeLabel(nodeType: SignalGraphNodeType): string {
  if (nodeType === 'signal-input') return 'input';
  return nodeType;
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
          className="absolute left-1/2 top-1/2 h-[64px] w-[64px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-md border bg-card"
          style={{ borderColor: `${tint}80` }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="max-w-[120px] truncate text-xs font-semibold text-foreground">{data.label}</p>
          <p className="mt-1 max-w-[120px] truncate text-[10px] text-muted-foreground">{data.subtitle}</p>
        </div>
      </div>
    );
  }

  const shapeClass =
    data.nodeType === 'topic'
      ? 'rounded-full px-5 py-3'
      : data.nodeType === 'signal-input'
        ? 'rounded-2xl px-4 py-3'
      : data.nodeType === 'actor'
        ? 'rounded-xl px-4 py-3'
        : 'rounded-md px-4 py-3';

  return (
    <div
      className={`min-w-[120px] border bg-card text-center shadow-sm ${shapeClass}`}
      style={{ borderColor: `${tint}80` }}
    >
      <Handle type="target" position={Position.Left} style={handleBaseStyle} />
      <Handle type="source" position={Position.Right} style={handleBaseStyle} />
      <p className="truncate text-xs font-semibold text-foreground">{data.label}</p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{data.subtitle}</p>
    </div>
  );
}

const SIGNAL_NODE_TYPES = {
  'signal-input': SignalFlowNode,
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
            data-testid={`agent-view-toggle-${item.id}`}
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
  layoutMode,
  manualViewport,
  onLayoutModeChange,
  onCommitNodePosition,
  onCommitViewport,
  onResetCurrentLayout,
  onClearSavedLayouts,
  onSelectNode,
  onClearSelection,
}: {
  graph: SignalGraph;
  layoutMode: TopologyLayoutMode;
  manualViewport?: TopologyViewport;
  onLayoutModeChange: (mode: TopologyLayoutMode) => void;
  onCommitNodePosition: (
    nodeId: string,
    position: TopologyNodePosition,
    viewport?: TopologyViewport,
  ) => void;
  onCommitViewport: (viewport: TopologyViewport) => void;
  onResetCurrentLayout: () => void;
  onClearSavedLayouts: () => void;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
}) {
  const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const activeEdgeColor = isDarkMode ? '#FB923C' : '#C75B3A';
  const inactiveEdgeColor = isDarkMode ? '#57534E' : '#A8A29E';
  const edgeLabelColor = isDarkMode ? '#D6D3D1' : '#78716C';
  const edgeLabelBgColor = isDarkMode ? '#1C1917' : '#FAF7F5';
  const backgroundDotColor = isDarkMode ? '#44403C' : '#E7E5E4';
  const flowInstanceRef = useRef<ReactFlowInstance<SignalFlowNodeType> | null>(null);

  const nextFlowNodes = useMemo<SignalFlowNodeType[]>(() => {
    return graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      draggable: layoutMode === 'manual',
      data: {
        label: node.label,
        subtitle: node.status,
        nodeType: node.type,
      },
    }));
  }, [graph.nodes, layoutMode]);
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
      label: edge.label,
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

  useEffect(() => {
    const instance = flowInstanceRef.current;
    if (!instance) return;

    if (layoutMode === 'auto:flow') {
      void instance.fitView({ padding: 0.2 });
      return;
    }

    if (manualViewport) {
      const currentViewport = instance.getViewport();
      const matchesCurrentViewport =
        Math.abs(currentViewport.x - manualViewport.x) < 0.5
        && Math.abs(currentViewport.y - manualViewport.y) < 0.5
        && Math.abs(currentViewport.zoom - manualViewport.zoom) < 0.001;
      if (!matchesCurrentViewport) {
        void instance.setViewport(manualViewport, { duration: 0 });
      }
      return;
    }

    void instance.fitView({ padding: 0.2 });
  }, [layoutMode, manualViewport]);

  return (
    <section
      data-testid="agent-topology-view"
      className="h-full min-h-0"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClearSelection();
        }
      }}
    >
      <div
        data-testid="agent-topology-canvas"
        className="relative h-full min-h-0 w-full overflow-hidden rounded-[22px] border border-[#EDE8E3] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#1C1917]"
      >
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-2">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90">
            <button
              type="button"
              data-testid="agent-topology-layout-mode-manual"
              onClick={() => onLayoutModeChange('manual')}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                layoutMode === 'manual'
                  ? 'bg-[#C75B3A] text-white'
                  : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]'
              }`}
            >
              手动布局
            </button>
            <button
              type="button"
              data-testid="agent-topology-layout-mode-auto-flow"
              onClick={() => onLayoutModeChange('auto:flow')}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                layoutMode === 'auto:flow'
                  ? 'bg-[#1D4ED8] text-white'
                  : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]'
              }`}
            >
              自动布局
            </button>
          </div>
          <button
            type="button"
            data-testid="agent-topology-fit-view"
            onClick={() => {
              void flowInstanceRef.current?.fitView({ padding: 0.2 });
            }}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[#E7E3E0] bg-white/90 px-3 py-1 text-[11px] font-medium text-[#57534E] shadow-sm backdrop-blur transition-colors hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
          >
            <Crosshair size={12} />
            适配视口
          </button>
          <button
            type="button"
            data-testid="agent-topology-reset-layout"
            onClick={onResetCurrentLayout}
            className="pointer-events-auto rounded-full border border-[#E7E3E0] bg-white/90 px-3 py-1 text-[11px] font-medium text-[#57534E] shadow-sm backdrop-blur transition-colors hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
          >
            重置当前布局
          </button>
          <button
            type="button"
            data-testid="agent-topology-clear-layouts"
            onClick={onClearSavedLayouts}
            className="pointer-events-auto rounded-full border border-[#E7E3E0] bg-white/90 px-3 py-1 text-[11px] font-medium text-[#57534E] shadow-sm backdrop-blur transition-colors hover:text-[#1C1917] dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
          >
            清空已保存布局
          </button>
        </div>
        <ReactFlow
          data-testid="agent-signal-flow"
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={SIGNAL_NODE_TYPES}
          defaultViewport={layoutMode === 'manual' ? manualViewport : undefined}
          fitView={layoutMode === 'auto:flow' || !manualViewport}
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={1.8}
          onNodesChange={onFlowNodesChange}
          onInit={(instance) => {
            flowInstanceRef.current = instance;
            if (layoutMode === 'manual' && manualViewport) {
              void instance.setViewport(manualViewport, { duration: 0 });
              return;
            }
            void instance.fitView({ padding: 0.2 });
          }}
          onNodeDragStop={(_, node) => {
            if (layoutMode !== 'manual') return;
            onCommitNodePosition(node.id, node.position, flowInstanceRef.current?.getViewport());
          }}
          onMoveEnd={(_, viewport) => {
            if (layoutMode !== 'manual') return;
            onCommitViewport(viewport);
          }}
          onNodeClick={(_, node: SignalFlowNodeType) => {
            onSelectNode(node.id);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} color={backgroundDotColor} />
          <Controls showInteractive className="agent-topology-controls" />
        </ReactFlow>
      </div>
    </section>
  );
}

function DeviceView({
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
}: {
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
}) {
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

function AddNodeSheet({
  options,
  onClose,
  onSelectAgent,
  onAddDevice,
}: {
  options: AddNodeOption[];
  onClose: () => void;
  onSelectAgent: (kind: RuntimeCreateAgentRequest['kind']) => void;
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
                  onClose();
                  if (option.id !== 'device') onSelectAgent(option.id);
                  if (option.id === 'device') onAddDevice();
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

function AgentCreateSheet({
  kind,
  providerProfiles,
  selectedProviderProfileId,
  apiProfileName,
  apiProvider,
  apiModel,
  apiBaseUrl,
  apiKey,
  compatibleHosts,
  selectedHostId,
  createError,
  isCreating,
  onClose,
  onKindChange,
  onSelectProviderProfile,
  onApiProfileNameChange,
  onApiProviderChange,
  onApiModelChange,
  onApiBaseUrlChange,
  onApiKeyChange,
  onSelectHost,
  onCreate,
}: {
  kind: RuntimeCreateAgentRequest['kind'];
  providerProfiles: ProviderProfileMeta[];
  selectedProviderProfileId: string;
  apiProfileName: string;
  apiProvider: ApiProviderId;
  apiModel: string;
  apiBaseUrl: string;
  apiKey: string;
  compatibleHosts: RuntimeHostSnapshot[];
  selectedHostId: string;
  createError: string;
  isCreating: boolean;
  onClose: () => void;
  onKindChange: (kind: RuntimeCreateAgentRequest['kind']) => void;
  onSelectProviderProfile: (profileId: string) => void;
  onApiProfileNameChange: (value: string) => void;
  onApiProviderChange: (value: ApiProviderId) => void;
  onApiModelChange: (value: string) => void;
  onApiBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSelectHost: (hostId: string) => void;
  onCreate: () => void;
}) {
  const showApiFields = kind === 'api';
  const usingSavedProfile = showApiFields && selectedProviderProfileId.trim().length > 0;

  return (
    <>
      <button
        type="button"
        data-testid="agent-create-overlay"
        aria-label="关闭 Agent 创建弹窗（Close Agent Create Sheet）"
        className="absolute inset-0 z-20 bg-black/35"
        onClick={onClose}
      />
      <section
        data-testid="agent-create-sheet"
        className="absolute inset-x-0 bottom-0 z-30 rounded-t-[24px] bg-white pb-7 shadow-[0_-8px_28px_rgba(0,0,0,0.12)] dark:bg-[#1C1917] dark:shadow-[0_-8px_28px_rgba(0,0,0,0.45)]"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded bg-[#D6D3D1] dark:bg-[#57534E]" />
        </div>
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[18px] font-bold text-[#1C1917] dark:text-[#FAFAF9]">创建 Agent</h2>
          <button
            type="button"
            data-testid="agent-create-close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F0ED] text-[#A8A29E] dark:bg-[#292524] dark:text-[#78716C]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">Agent 类型</p>
            <div className="grid grid-cols-2 gap-2">
              {(['claude_cli', 'codex_cli', 'api', 'echo'] as RuntimeCreateAgentRequest['kind'][]).map((option) => (
                <button
                  key={option}
                  type="button"
                  data-testid={`agent-create-kind-${option}`}
                  onClick={() => onKindChange(option)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs ${
                    kind === option
                      ? 'border-[#0D9488] bg-[#0D948810] text-[#0D9488]'
                      : 'border-[#E7E5E4] bg-[#FAF7F5] text-[#57534E] dark:border-[#292524] dark:bg-[#292524] dark:text-[#D6D3D1]'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {showApiFields && (
            <div className="space-y-3 rounded-2xl border border-[#E7E5E4] bg-[#FAF7F5] p-3 dark:border-[#292524] dark:bg-[#292524]">
              <div className="space-y-1">
                <p className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">已保存 Provider Profiles</p>
                {providerProfiles.length > 0 ? (
                  <select
                    data-testid="agent-create-provider-profile-select"
                    value={selectedProviderProfileId}
                    onChange={(event) => onSelectProviderProfile(event.target.value)}
                    className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
                  >
                    <option value="">新建 Provider Profile</option>
                    {providerProfiles.map((profile) => (
                      <option key={profile.profileId} value={profile.profileId}>
                        {profile.name} · {profile.provider} / {profile.model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">还没有保存的 Provider Profile，将使用下面的新建表单。</p>
                )}
              </div>

              <input
                data-testid="agent-create-provider-name-input"
                value={apiProfileName}
                onChange={(event) => onApiProfileNameChange(event.target.value)}
                disabled={usingSavedProfile}
                placeholder="Profile 名称（例如 OpenAI GPT-5）"
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              />
              <select
                data-testid="agent-create-provider-select"
                value={apiProvider}
                onChange={(event) => onApiProviderChange(event.target.value as ApiProviderId)}
                disabled={usingSavedProfile}
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
              <input
                data-testid="agent-create-model-input"
                value={apiModel}
                onChange={(event) => onApiModelChange(event.target.value)}
                disabled={usingSavedProfile}
                placeholder="Model（例如 gpt-5 / claude-sonnet-4-5）"
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              />
              <input
                data-testid="agent-create-base-url-input"
                value={apiBaseUrl}
                onChange={(event) => onApiBaseUrlChange(event.target.value)}
                disabled={usingSavedProfile}
                placeholder="Base URL（可选）"
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              />
              <input
                data-testid="agent-create-api-key-input"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                disabled={usingSavedProfile}
                placeholder="API Key"
                className="h-9 w-full rounded-lg border border-[#E7E5E4] bg-white px-3 text-xs text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
              />
              {usingSavedProfile && (
                <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E]">
                  当前使用已保存 Profile；如需修改请切回“新建 Provider Profile”。
                </p>
              )}
            </div>
          )}

          {compatibleHosts.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#78716C] dark:text-[#A8A29E]">Runtime 目标（多目标时需显式选择）</p>
              <div className="space-y-2">
                {compatibleHosts.map((snapshot) => (
                  <button
                    key={snapshot.host.id}
                    type="button"
                    data-testid={`agent-create-runtime-host-${snapshot.host.id}`}
                    onClick={() => onSelectHost(snapshot.host.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-xs ${
                      selectedHostId === snapshot.host.id
                        ? 'border-[#0D9488] bg-[#0D948810] text-[#0D9488]'
                        : 'border-[#E7E5E4] bg-[#FAF7F5] text-[#57534E] dark:border-[#292524] dark:bg-[#292524] dark:text-[#D6D3D1]'
                    }`}
                  >
                    <p className="font-semibold">{snapshot.host.name}</p>
                    <p className="mt-1 text-[11px] opacity-75">{snapshot.host.host}:{snapshot.host.port}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {compatibleHosts.length === 1 && (
            <p className="rounded-lg bg-[#0D948810] px-3 py-2 text-[11px] text-[#0D9488]">
              单目标自动直达：{compatibleHosts[0]?.host.name}
            </p>
          )}

          {createError && (
            <p className="rounded-lg bg-[#EF444410] px-3 py-2 text-[11px] text-[#DC2626]">{createError}</p>
          )}

          <button
            type="button"
            data-testid="agent-create-submit"
            onClick={onCreate}
            disabled={isCreating}
            className="h-10 w-full rounded-xl bg-[#0D9488] text-sm font-semibold text-white disabled:opacity-50"
          >
            {isCreating ? '创建中...' : '创建 Agent'}
          </button>
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
            placeholder={`host 或 host:port（例如 127.0.0.1 或 127.0.0.1:${DEFAULT_EXTERNAL_RUNTIME_PORT}）`}
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
                    <Switch
                      checked={route.enabled}
                      onCheckedChange={(checked) => void onToggle(route.id, checked)}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label={route.enabled ? '禁用' : '启用'}
                    />
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
                          : route.target_type === 'remote'
                          ? 'bg-[#E0E7FF] text-[#4338CA] dark:bg-[#4338CA]/20 dark:text-[#C7D2FE]'
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
            data-testid={`agent-list-filter-${f.id}`}
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
                <span
                  className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                    item.status === 'running'
                      ? 'bg-[#22C55E]/15 text-[#22C55E]'
                      : item.status === 'warning'
                        ? 'bg-[#F59E0B]/15 text-[#F59E0B]'
                        : item.status === 'offline'
                          ? 'bg-[#EF4444]/15 text-[#EF4444]'
                          : 'bg-[#57534E]/30 text-[#78716C]'
                  }`}
                >
                  {statusLabel[item.status]}
                </span>
                <ChevronRight size={14} className="shrink-0 text-[#A8A29E]" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListTabView({
  sections,
  filter,
  onFilterChange,
  onNodeClick,
  signalRouteRows,
  onOpenRoute,
}: {
  sections: AgentHubListSection[];
  filter: NodeFilterType;
  onFilterChange: (f: NodeFilterType) => void;
  onNodeClick: (item: AgentHubListItem) => void;
  signalRouteRows: SignalRouteRow[];
  onOpenRoute: (routeId: string) => void;
}) {
  const routeHostLabel = signalRouteRows[0]?.hostLabel;

  return (
    <div data-testid="agent-list-view" className="flex flex-col gap-4">
      <NodesTabView
        sections={sections}
        filter={filter}
        onFilterChange={onFilterChange}
        onNodeClick={onNodeClick}
      />

      <section
        data-testid="agent-signal-route-section"
        className="rounded-[10px] border border-[#E7E3E0] bg-white dark:border-[#292524] dark:bg-[#0C0A09]"
      >
        <div className="flex items-center justify-between border-b border-[#E7E3E0] px-4 py-2.5 dark:border-[#292524]">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">信号路由</p>
            {routeHostLabel && (
              <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 font-mono text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                {routeHostLabel}
              </span>
            )}
          </div>
          <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">{signalRouteRows.length} 条</span>
        </div>

        {signalRouteRows.length === 0 ? (
          <p className="px-4 py-6 text-xs text-[#78716C] dark:text-[#A8A29E]">暂无信号路由</p>
        ) : (
          <div className="divide-y divide-[#E7E3E0] dark:divide-[#292524]">
            {signalRouteRows.map((row) => (
              <button
                key={row.id}
                type="button"
                data-testid={`agent-signal-route-row-${row.id}`}
                onClick={() => onOpenRoute(row.id)}
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-[#FAF7F5] dark:hover:bg-[#1C1917]"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    row.status === 'active' ? 'bg-[#22C55E]' : 'bg-[#57534E]'
                  }`}
                />
                <span className="flex-1 truncate font-mono text-xs text-[#44403C] dark:text-[#D6D3D1]">
                  {row.topic} → {row.targetRef}
                </span>
                <span className="shrink-0 rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
                  {row.targetType}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SignalHistoryTabView({
  events,
  hostLabel,
  onSelectSignal,
}: {
  events: SignalEvent[];
  hostLabel?: string;
  onSelectSignal: (signalId: string) => void;
}) {
  return (
    <section data-testid="agent-signal-history-view" className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">Signal History</p>
          {hostLabel && (
            <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 font-mono text-[10px] text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
              {hostLabel}
            </span>
          )}
        </div>
        <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">{events.length} 条</span>
      </div>

      {events.length === 0 ? (
        <div className="rounded-[10px] border border-[#E7E3E0] bg-white px-4 py-8 text-center text-xs text-[#78716C] dark:border-[#292524] dark:bg-[#0C0A09] dark:text-[#A8A29E]">
          暂无信号历史
        </div>
      ) : (
        <div className="divide-y divide-[#E7E3E0] overflow-hidden rounded-[10px] border border-[#E7E3E0] bg-white dark:divide-[#292524] dark:border-[#292524] dark:bg-[#0C0A09]">
          {events.map((eventItem) => (
            <button
              key={eventItem.id}
              type="button"
              onClick={() => onSelectSignal(`topic:${eventItem.topic}`)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#FAF7F5] dark:hover:bg-[#1C1917]"
            >
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C75B3A]" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-[#44403C] dark:text-[#D6D3D1]">{eventItem.topic}</p>
                <p className="mt-1 line-clamp-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
                  {formatSignalPayload(eventItem.payload)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[10px] text-[#78716C] dark:text-[#A8A29E]">
                  {formatSignalTime(eventItem.ts)}
                </p>
                <p className="mt-0.5 text-[10px] text-[#A8A29E] dark:text-[#78716C]">{eventItem.source}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function AgentsPage() {
  const supportsInlineRightPanel = useIsDesktop(1024);
  const initialRuntimeTarget = getSelectedRuntimeTarget();
  const [viewMode, setViewMode] = useState<AgentHubViewMode>('topology');
  const [nodesFilter, setNodesFilter] = useState<NodeFilterType>('all');
  const [topologyLayoutMode, setTopologyLayoutMode] = useState<TopologyLayoutMode>('manual');
  const [topologyLayoutStore, setTopologyLayoutStore] = useState<TopologyLayoutStore>(() => readTopologyLayoutStore());
  const topologyPendingStoreRef = useRef<TopologyLayoutStore | null>(null);
  const topologyWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [signalRoutes, setSignalRoutes] = useState<SignalRoute[]>([]);
  const [signalRouteHostLabel, setSignalRouteHostLabel] = useState<string>('');
  const [activeSignalRouteHost, setActiveSignalRouteHost] = useState<RuntimeHostRecord | null>(null);
  const [signalHistory, setSignalHistory] = useState<SignalEvent[]>([]);
  const [signalHistoryHostLabel, setSignalHistoryHostLabel] = useState<string>('');
  const [fallbackRuntimeAgents, setFallbackRuntimeAgents] = useState<RuntimeAggregatedAgent[]>([]);
  const [listSections, setListSections] = useState<AgentHubListSection[]>([]);
  const [deviceGroups, setDeviceGroups] = useState<AgentDeviceGroup[]>([]);
  const [runtimeHostSnapshots, setRuntimeHostSnapshots] = useState<RuntimeHostSnapshot[]>([]);
  const [runtimeServiceStatus, setRuntimeServiceStatus] = useState<RuntimeServiceStatus | null>(null);
  const [runtimeHostModalName, setRuntimeHostModalName] = useState('');
  const [runtimeHostModalAddress, setRuntimeHostModalAddress] = useState(
    `127.0.0.1:${DEFAULT_EXTERNAL_RUNTIME_PORT}`,
  );
  const [runtimeHostError, setRuntimeHostError] = useState('');
  const [embeddedRuntimeNetworkMode, setEmbeddedRuntimeNetworkModeValue] = useState<EmbeddedRuntimeNetworkMode>(
    getEmbeddedRuntimeNetworkMode(),
  );
  const [runtimeTargetModeValue, setRuntimeTargetModeValue] = useState<RuntimeTargetMode>(initialRuntimeTarget.mode);
  const [runtimeTargetAddress, setRuntimeTargetAddress] = useState(
    formatRuntimeTargetAddress(initialRuntimeTarget),
  );
  const [runtimeExternalAddressDraft, setRuntimeExternalAddressDraft] = useState(
    getRuntimeExternalAddress(),
  );
  const [runtimeTargetError, setRuntimeTargetError] = useState('');
  const [rightPanel, setRightPanel] = useState<AgentHubRightPanelContext>({ state: 'CLOSED' });
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<AgentConversationMessage[]>([]);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');
  const [isChatSending, setIsChatSending] = useState(false);
  const [isAgentCreating, setIsAgentCreating] = useState(false);
  const [isAgentStopping, setIsAgentStopping] = useState(false);
  const [agentCreateOpen, setAgentCreateOpen] = useState(false);
  const [agentCreateKind, setAgentCreateKind] = useState<RuntimeCreateAgentRequest['kind']>('claude_cli');
  const [agentCreateError, setAgentCreateError] = useState('');
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfileMeta[]>([]);
  const [selectedProviderProfileId, setSelectedProviderProfileId] = useState('');
  const [agentCreateSelectedHostId, setAgentCreateSelectedHostId] = useState('');
  const [apiProfileNameDraft, setApiProfileNameDraft] = useState('');
  const [apiProviderDraft, setApiProviderDraft] = useState<ApiProviderId>('openai');
  const [apiModelDraft, setApiModelDraft] = useState('');
  const [apiBaseUrlDraft, setApiBaseUrlDraft] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');

  const navigateToSecondaryPage = (path: string) => {
    if (typeof window === 'undefined' || window.location.pathname === path) return;
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const openRouteEdit = (routeId: string | null = null) => {
    setRightPanel({ state: 'ROUTE_EDIT', routeId });
  };
  const openAgentDetail = (nodeId: string) => {
    if (!supportsInlineRightPanel) {
      const runtimeEntityId = resolveRuntimeEntityId(nodeId);
      navigateToSecondaryPage(`/agents/chat/${encodeURIComponent(runtimeEntityId)}`);
      return;
    }
    setRightPanel({ state: 'AGENT_DETAIL', nodeId });
  };
  const openActorDetail = (nodeId: string) => {
    if (!supportsInlineRightPanel) {
      const runtimeEntityId = resolveRuntimeEntityId(nodeId);
      navigateToSecondaryPage(`/agents/actor/${encodeURIComponent(runtimeEntityId)}`);
      return;
    }
    setRightPanel({ state: 'ACTOR_DETAIL', nodeId });
  };
  const openSignalDetail = (signalId: string) => {
    setRightPanel({ state: 'SIGNAL_DETAIL', signalId });
  };
  const closeRightPanel = () => {
    setRightPanel({ state: 'CLOSED' });
  };

  const refreshProviderProfileOptions = () => {
    const profiles = listProviderProfiles();
    setProviderProfiles(profiles);
    return profiles;
  };

  const buildSelectedApiProfileSnapshot = () => {
    if (selectedProviderProfileId) {
      return resolveProviderProfile(selectedProviderProfileId);
    }

    if (!apiModelDraft.trim() || !apiKeyDraft.trim()) {
      return null;
    }

    const created = createProviderProfile({
      name: apiProfileNameDraft.trim() || `${apiProviderDraft} ${apiModelDraft.trim()}`,
      provider: apiProviderDraft,
      model: apiModelDraft.trim(),
      baseUrl: apiBaseUrlDraft.trim() || undefined,
      apiKey: apiKeyDraft.trim(),
    });
    setSelectedProviderProfileId(created.profileId);
    const nextProfiles = refreshProviderProfileOptions();
    return resolveProviderProfile(created.profileId)
      ?? resolveProviderProfile(nextProfiles[0]?.profileId ?? '');
  };

  const hostSupportsAgentKind = (
    snapshot: RuntimeHostSnapshot,
    kind: RuntimeCreateAgentRequest['kind'],
    providerId?: ApiProviderId,
  ) => {
    if (snapshot.connectionState !== 'online') return false;
    if (kind === 'echo') return true;
    const capabilities = snapshot.topology?.capabilities;
    if (!capabilities) return true;
    if (kind === 'api') {
      return capabilities.agent_kinds.includes('api')
        && (!providerId || capabilities.api_providers.includes(providerId));
    }
    return capabilities.agent_kinds.includes(kind);
  };

  const compatibleCreateHosts = runtimeHostSnapshots.filter((snapshot) => hostSupportsAgentKind(
    snapshot,
    agentCreateKind,
    agentCreateKind === 'api'
      ? (selectedProviderProfileId
        ? resolveProviderProfile(selectedProviderProfileId)?.provider
        : apiProviderDraft)
      : undefined,
  ));

  const openAgentCreateSheet = (kind: RuntimeCreateAgentRequest['kind']) => {
    setAgentCreateKind(kind);
    setAgentCreateError('');
    setAgentCreateSelectedHostId('');
    const profiles = refreshProviderProfileOptions();
    setSelectedProviderProfileId(kind === 'api' && profiles[0] ? profiles[0].profileId : '');
    setAgentCreateOpen(true);
  };

  // T8: AgentDetail / ActorDetail 右侧栏
  const [agentDetail, setAgentDetail] = useState<AgentDetailData | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  useEffect(() => {
    if (rightPanel.state === 'AGENT_DETAIL' || rightPanel.state === 'ACTOR_DETAIL') {
      const nodeId = rightPanel.nodeId;
      if (!nodeId) return;
      const runtimeEntityId = resolveRuntimeEntityId(nodeId);
      setIsDetailLoading(true);
      setAgentDetail(null);
      const service = getAgentHubService();
      const loader = rightPanel.state === 'AGENT_DETAIL'
        ? service.getAgentDetail(runtimeEntityId)
        : service.getActorDetail(runtimeEntityId);
      loader.then((data) => {
        setAgentDetail(data);
        setIsDetailLoading(false);
      }).catch(() => {
        setIsDetailLoading(false);
      });
    } else {
      setAgentDetail(null);
    }
  }, [rightPanel.state, rightPanel.nodeId]);

  useEffect(() => {
    if (!selectedProviderProfileId) return;
    const profile = resolveProviderProfile(selectedProviderProfileId);
    if (!profile) return;
    setApiProfileNameDraft(profile.name);
    setApiProviderDraft(profile.provider);
    setApiModelDraft(profile.model);
    setApiBaseUrlDraft(profile.baseUrl ?? '');
    setApiKeyDraft(profile.apiKey);
  }, [selectedProviderProfileId]);

  const [isRouteSaving, setIsRouteSaving] = useState(false);

  const handleRouteSave = async (
    data: Omit<SignalRoute, 'id' | 'created_at' | 'updated_at'>
  ) => {
    setIsRouteSaving(true);
    try {
      const host = activeSignalRouteHost ?? sortRouteHostsByPriority(runtimeHostSnapshots).find((s) => s.host)?.host;
      if (!host) return;
      const routeService = new SignalRouteService({ host });
      if (rightPanel.state === 'ROUTE_EDIT' && rightPanel.routeId) {
        await routeService.updateRoute(rightPanel.routeId, data);
      } else {
        await routeService.createRoute(data);
      }
      await refreshSignalRoutesFromSnapshot({ hosts: runtimeHostSnapshots });
      closeRightPanel();
    } catch (err) {
      console.error('Failed to save route:', err);
    } finally {
      setIsRouteSaving(false);
    }
  };

  const handleRouteToggle = async (routeId: string, enabled: boolean) => {
    const previousRoutes = signalRoutes;
    setSignalRoutes((current) => current.map((route) => (
      route.id === routeId ? { ...route, enabled } : route
    )));

    try {
      const host = activeSignalRouteHost ?? sortRouteHostsByPriority(runtimeHostSnapshots).find((s) => s.host)?.host;
      if (!host) {
        setSignalRoutes(previousRoutes);
        return;
      }
      const routeService = new SignalRouteService({ host });
      await routeService.updateRoute(routeId, { enabled });
      await refreshSignalRoutesFromSnapshot({ hosts: runtimeHostSnapshots });
    } catch (err) {
      setSignalRoutes(previousRoutes);
      console.error('Failed to toggle route:', err);
    }
  };

  const handleRouteDelete = async (routeId: string) => {
    try {
      const host = activeSignalRouteHost ?? sortRouteHostsByPriority(runtimeHostSnapshots).find((s) => s.host)?.host;
      if (!host) return;
      const routeService = new SignalRouteService({ host });
      await routeService.deleteRoute(routeId);
      await refreshSignalRoutesFromSnapshot({ hosts: runtimeHostSnapshots });
      closeRightPanel();
    } catch (err) {
      console.error('Failed to delete route:', err);
    }
  };

  const handleOpenAgentChat = async (nodeId: string) => {
    const agentId = resolveRuntimeEntityId(nodeId);
    setChatAgentId(agentId);
    setChatSessionId(null);
    setChatInput('');
    setChatError('');
    setRightPanel({ state: 'AGENT_CHAT', nodeId });

    const runtimeHost = findPreferredRuntimeHostForAgent(
      runtimeHostSnapshots,
      agentId,
      extractPreferredHostId(nodeId),
    );
    if (runtimeHost) {
      setChatMessages([]);
      return;
    }

    try {
      const history = await getAgentHubService().getConversation(agentId);
      setChatMessages(history);
    } catch (error) {
      setChatMessages([]);
      const message = error instanceof Error ? error.message : String(error);
      setChatError(`加载会话失败: ${message}`);
    }
  };

  const handleChatSend = async () => {
    const prompt = chatInput.trim();
    if (!chatAgentId || !prompt || isChatSending) return;

    const userMessage = createConversationMessage(`user-${Date.now()}`, 'user', prompt);
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    setChatError('');
    setIsChatSending(true);

    try {
      let receivedVisibleContent = false;
      const runtimeHost = rightPanel.state === 'AGENT_CHAT'
        ? findPreferredRuntimeHostForAgent(
          runtimeHostSnapshots,
          chatAgentId,
          extractPreferredHostId(rightPanel.nodeId),
        )
        : null;

      if (runtimeHost) {
        const runtimeClient = new RuntimeClient();
        for await (const chunk of runtimeClient.streamAgentConversation(runtimeHost, {
          agentId: chatAgentId,
          message: prompt,
          sessionId: chatSessionId ?? undefined,
        })) {
          if (chunk.sessionId) {
            setChatSessionId(chunk.sessionId ?? null);
          }
          switch (chunk.type) {
            case 'session.started':
              setChatSessionId(chunk.sessionId ?? null);
              break;
            case 'output.delta':
              receivedVisibleContent = true;
              setChatMessages((prev) => appendAdjacentConversationDelta(
                prev,
                `runtime-agent-output-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                chunk.content,
                {
                  source: 'runtime',
                  runtimeEventType: 'output.delta',
                },
              ));
              break;
            case 'thinking.delta':
              receivedVisibleContent = true;
              setChatMessages((prev) => appendAdjacentConversationDelta(
                prev,
                `runtime-agent-thinking-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                chunk.content,
                {
                  source: 'runtime',
                  runtimeEventType: 'thinking.delta',
                  title: 'Thinking',
                },
              ));
              break;
            case 'tool.call':
              receivedVisibleContent = true;
              setChatMessages((prev) => appendConversationMessage(prev, createConversationMessage(
                `runtime-tool-call-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                'agent',
                formatRuntimeEventPayload(chunk.payload),
                {
                  source: 'runtime',
                  runtimeEventType: 'tool.call',
                  title: `Tool Call · ${chunk.name ?? 'unknown'}`,
                },
              )));
              break;
            case 'tool.result':
              receivedVisibleContent = true;
              setChatMessages((prev) => appendConversationMessage(prev, createConversationMessage(
                `runtime-tool-result-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                'agent',
                formatRuntimeEventPayload(chunk.payload),
                {
                  source: 'runtime',
                  runtimeEventType: 'tool.result',
                  title: `Tool Result · ${chunk.name ?? 'unknown'}`,
                },
              )));
              break;
            case 'error':
              receivedVisibleContent = true;
              setChatMessages((prev) => appendAdjacentConversationDelta(
                prev,
                `runtime-agent-error-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                chunk.message ?? chunk.content,
                {
                  source: 'runtime',
                  runtimeEventType: 'error',
                  title: 'Runtime Error',
                },
              ));
              break;
            case 'done':
              break;
          }
        }
      } else {
        const stream = getAgentHubService().streamConversation({ agentId: chatAgentId, prompt });
        for await (const chunk of stream) {
          if (!chunk.delta) continue;
          receivedVisibleContent = true;
          setChatMessages((prev) => appendConversationChunk(prev, chunk));
        }
      }

      if (!receivedVisibleContent) {
        setChatError('Agent 未返回可显示内容');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatError(`发送失败: ${message}`);
    } finally {
      setIsChatSending(false);
    }
  };

  const handleCreateManualAgent = async () => {
    setIsAgentCreating(true);
    setAgentCreateError('');
    setRuntimeHostError('');

    try {
      const resolvedProfile = agentCreateKind === 'api'
        ? buildSelectedApiProfileSnapshot()
        : null;
      if (agentCreateKind === 'api' && !resolvedProfile) {
        setAgentCreateError('API Agent 需要已保存或新建的 Provider Profile');
        return;
      }

      const resolveCompatibleHosts = (hosts: RuntimeHostSnapshot[]) => hosts.filter((snapshot) => hostSupportsAgentKind(
        snapshot,
        agentCreateKind,
        resolvedProfile?.provider,
      ));

      let candidateSnapshots = resolveCompatibleHosts(runtimeHostSnapshots);

      if (candidateSnapshots.length === 0 && runtimeTargetModeValue === 'embedded' && !runtimeServiceStatus?.running) {
        await handleRuntimeStart();
        const nextSnapshot = await getRuntimeManager().refreshSnapshot();
        applyRuntimeSnapshot(nextSnapshot);
        await refreshSignalRoutesFromSnapshot(nextSnapshot);
        candidateSnapshots = resolveCompatibleHosts(nextSnapshot.hosts);
      }

      let host = agentCreateSelectedHostId
        ? candidateSnapshots.find((snapshot) => snapshot.host.id === agentCreateSelectedHostId)?.host ?? null
        : candidateSnapshots.length === 1
          ? candidateSnapshots[0]?.host ?? null
          : null;

      if (!host && candidateSnapshots.length > 1) {
        setAgentCreateError('存在多个可用 Runtime，请先显式选择一个目标');
        return;
      }

      if (!host) {
        const selectedTarget = getSelectedRuntimeTarget();
        const targetAddress = `${selectedTarget.host}:${selectedTarget.port}`;
        try {
          host = await getRuntimeManager().addHostFromAddress(targetAddress, `Selected Runtime · ${targetAddress}`);
        } catch {
          host = createDirectRuntimeHost(selectedTarget.host, selectedTarget.port);
        }
      }

      if (!host) {
        setAgentCreateError('未找到可用 Runtime 主机，无法创建 Agent');
        return;
      }

      const runtimeClient = new RuntimeClient();
      if (candidateSnapshots.length === 0) {
        const topologyResult = await runtimeClient.getTopology(host);
        if (!topologyResult.ok) {
          setAgentCreateError(`无法连接当前 Runtime: ${topologyResult.error.message}`);
          return;
        }

        const fallbackSnapshot: RuntimeHostSnapshot = {
          host,
          connectionState: 'online',
          agents: [],
          topology: topologyResult.data,
        };
        if (!hostSupportsAgentKind(fallbackSnapshot, agentCreateKind, resolvedProfile?.provider)) {
          setAgentCreateError('当前 Runtime 不支持所选 Agent 类型');
          return;
        }
      }

      const request: RuntimeCreateAgentRequest = agentCreateKind === 'api'
        ? {
            kind: 'api',
            providerProfile: resolvedProfile ?? undefined,
          }
        : {
            kind: agentCreateKind,
          };

      const result = await runtimeClient.createAgent(host, request);
      if (!result.ok) {
        setAgentCreateError(`创建 Agent 失败: ${result.error.message}`);
        return;
      }

      if (resolvedProfile) {
        markProviderProfileUsed(resolvedProfile.profileId);
      }

      await refreshRuntimeSnapshot();
      setAgentCreateOpen(false);
      setViewMode('list');
    } finally {
      setIsAgentCreating(false);
    }
  };

  const handleStopAgent = async (nodeId: string) => {
    const agentId = resolveRuntimeEntityId(nodeId);
    const hostCandidates = sortRouteHostsByPriority(runtimeHostSnapshots).map((item) => item.host);
    if (hostCandidates.length === 0) {
      setRuntimeHostError('未找到可用 Runtime 主机，无法停止 Agent');
      return;
    }

    setIsAgentStopping(true);
    setRuntimeHostError('');
    try {
      const runtimeClient = new RuntimeClient();
      let lastErrorMessage = 'agent not found';
      for (const host of hostCandidates) {
        const result = await runtimeClient.deleteAgent(host, agentId);
        if (result.ok) {
          await refreshRuntimeSnapshot();
          closeRightPanel();
          return;
        }
        lastErrorMessage = result.error.message;
        if (result.error.status !== 404) {
          break;
        }
      }
      setRuntimeHostError(`停止 Agent 失败: ${lastErrorMessage}`);
    } finally {
      setIsAgentStopping(false);
    }
  };

  const handleTabChange = (tab: AgentHubViewMode) => {
    setViewMode(tab);
    closeRightPanel(); // 切换 Tab 时关闭右侧栏（保守策略）
  };

  useEffect(() => {
    if (rightPanel.state === 'AGENT_CHAT') return;
    setChatAgentId(null);
    setChatSessionId(null);
    setChatInput('');
    setChatError('');
    setIsChatSending(false);
  }, [rightPanel.state]);

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

  const desiredEmbeddedRuntimeHost = resolveEmbeddedRuntimeBindHost(embeddedRuntimeNetworkMode);
  const desiredEmbeddedRuntimePort = runtimeServiceStatus?.running
    ? runtimeServiceStatus.port
    : getPreferredEmbeddedRuntimePort();
  const desiredEmbeddedRuntimeAddress = `${desiredEmbeddedRuntimeHost}:${desiredEmbeddedRuntimePort}`;
  const runtimeNeedsRebind = Boolean(
    runtimeServiceStatus?.running
      && (runtimeServiceStatus.host !== desiredEmbeddedRuntimeHost
        || runtimeServiceStatus.port !== desiredEmbeddedRuntimePort),
  );

  const tryLoadRoutesFromHost = async (
    host: RuntimeHostRecord
  ): Promise<{
    hostLabel: string;
    routes: SignalRoute[];
    agents: RuntimeAggregatedAgent[];
    history: SignalEvent[];
  } | null> => {
    try {
      const routeService = new SignalRouteService({ host });
      const runtimeClient = new RuntimeClient();
      const [routes, agentsResult, historyResponse] = await Promise.all([
        routeService.listRoutes(),
        runtimeClient.getAgents(host),
        fetch(`http://${host.host}:${host.port}/signals/history?limit=120`),
      ]);
      const agents = agentsResult.ok ? mapRuntimeAgentsForHost(host, agentsResult.data) : [];
      const history = historyResponse.ok
        ? ((await historyResponse.json()) as SignalEvent[])
        : [];
      return {
        hostLabel: `${host.host}:${host.port}`,
        routes,
        agents,
        history,
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
      setActiveSignalRouteHost(null);
      setSignalHistoryHostLabel('mock（测试数据）');
      setSignalRoutes(MOCK_SIGNAL_ROUTES_FALLBACK);
      setSignalHistory([]);
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
      setActiveSignalRouteHost(host);
      setSignalHistoryHostLabel(result.hostLabel);
      setSignalRoutes(result.routes);
      setSignalHistory(result.history);
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
      setActiveSignalRouteHost(host);
      setSignalHistoryHostLabel(`${result.hostLabel}（auto）`);
      setSignalRoutes(result.routes);
      setSignalHistory(result.history);
      setFallbackRuntimeAgents(result.agents);
      if (snapshotAgents.length === 0 && result.agents.length > 0) {
        setListSections(buildListSectionsFromRuntimeAgents(result.agents));
      }
      return;
    }

    if (isDisposed()) return;
    setSignalRouteHostLabel('');
    setActiveSignalRouteHost(null);
    setSignalHistoryHostLabel('');
    setSignalRoutes([]);
    setSignalHistory([]);
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

  const handleEmbeddedRuntimeNetworkModeChange = (mode: EmbeddedRuntimeNetworkMode) => {
    setRuntimeTargetError('');
    setEmbeddedRuntimeNetworkMode(mode);
    setEmbeddedRuntimeNetworkModeValue(mode);
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
    const runtimeControlService = getRuntimeControlService();
    const targetHost = desiredEmbeddedRuntimeHost;
    const targetPort = desiredEmbeddedRuntimePort;
    try {
      const status = await runtimeControlService.startRuntime({
        host: targetHost,
        port: targetPort,
      });
      setRuntimeServiceStatus(status);
      await refreshRuntimeSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        const latestStatus = await runtimeControlService.getStatus();
        setRuntimeServiceStatus({
          ...latestStatus,
          error: latestStatus.error ?? message,
        });
      } catch {
        setRuntimeServiceStatus({
          running: false,
          host: targetHost,
          port: targetPort,
          error: message,
        });
      }
    }
  };

  const handleRuntimeStop = async () => {
    const runtimeControlService = getRuntimeControlService();
    const fallbackHost = runtimeServiceStatus?.host ?? desiredEmbeddedRuntimeHost;
    const fallbackPort = runtimeServiceStatus?.port ?? desiredEmbeddedRuntimePort;
    try {
      const status = await runtimeControlService.stopRuntime();
      setRuntimeServiceStatus(status);
      await refreshRuntimeSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        const latestStatus = await runtimeControlService.getStatus();
        setRuntimeServiceStatus({
          ...latestStatus,
          error: latestStatus.error ?? message,
        });
      } catch {
        setRuntimeServiceStatus({
          running: false,
          host: fallbackHost,
          port: fallbackPort,
          error: message,
        });
      }
    }
  };

  const signalRouteRows = useMemo(
    () => buildSignalRouteRows(signalRoutes, signalRouteHostLabel || undefined),
    [signalRouteHostLabel, signalRoutes]
  );

  const availableTopics = useMemo(
    () => [...new Set([...KNOWN_AGENT_HUB_TOPICS, ...signalRoutes.map((r) => r.topic)])],
    [signalRoutes]
  );

  const graphAgents = useMemo(() => {
    const runtimeAgents = runtimeHostSnapshots.flatMap((item) => item.agents);
    if (runtimeAgents.length > 0) return runtimeAgents;
    return fallbackRuntimeAgents;
  }, [fallbackRuntimeAgents, runtimeHostSnapshots]);

  const baseSignalGraph = useMemo(
    () => buildSignalGraph(signalRoutes, graphAgents),
    [graphAgents, signalRoutes]
  );

  const topologyDatasetKey = useMemo(
    () => buildTopologyDatasetKey(baseSignalGraph),
    [baseSignalGraph]
  );
  const topologyFilterKey = useMemo(
    () => buildTopologyFilterKey(),
    []
  );
  const topologyManualSnapshot = useMemo(
    () => getTopologyLayoutSnapshot(topologyLayoutStore, {
      datasetKey: topologyDatasetKey,
      scopeKey: TOPOLOGY_SCOPE_KEY,
      filterKey: topologyFilterKey,
    }),
    [topologyDatasetKey, topologyFilterKey, topologyLayoutStore]
  );
  const topologyManualResult = useMemo(
    () => applyManualLayoutSnapshot({
      nodes: baseSignalGraph.nodes,
      snapshot: topologyManualSnapshot,
    }),
    [baseSignalGraph.nodes, topologyManualSnapshot]
  );
  const signalGraph = useMemo(() => {
    if (topologyLayoutMode === 'manual') {
      return {
        nodes: topologyManualResult.nodes,
        edges: baseSignalGraph.edges,
      };
    }
    return {
      nodes: buildAutoFlowLayout(baseSignalGraph.nodes),
      edges: baseSignalGraph.edges,
    };
  }, [baseSignalGraph.edges, baseSignalGraph.nodes, topologyLayoutMode, topologyManualResult.nodes]);
  const manualViewport = topologyManualSnapshot?.viewport;

  const flushTopologyStoreWrite = () => {
    if (topologyWriteTimerRef.current) {
      clearTimeout(topologyWriteTimerRef.current);
      topologyWriteTimerRef.current = null;
    }
    if (!topologyPendingStoreRef.current) return;
    writeTopologyLayoutStore(topologyPendingStoreRef.current);
    topologyPendingStoreRef.current = null;
  };

  useEffect(() => {
    return () => {
      flushTopologyStoreWrite();
    };
  }, []);

  const persistTopologyStore = (updater: (current: TopologyLayoutStore) => TopologyLayoutStore) => {
    setTopologyLayoutStore((current) => {
      const nextStore = updater(current);
      topologyPendingStoreRef.current = nextStore;
      if (topologyWriteTimerRef.current) {
        clearTimeout(topologyWriteTimerRef.current);
      }
      topologyWriteTimerRef.current = setTimeout(() => {
        flushTopologyStoreWrite();
      }, 120);
      return nextStore;
    });
  };

  const saveManualTopologySnapshot = ({
    nodes,
    viewport,
  }: {
    nodes: Array<{ id: string; position: TopologyNodePosition }>;
    viewport?: TopologyViewport;
  }) => {
    persistTopologyStore((current) => setTopologyLayoutSnapshot(current, {
      datasetKey: topologyDatasetKey,
      scopeKey: TOPOLOGY_SCOPE_KEY,
      filterKey: topologyFilterKey,
      snapshot: buildManualLayoutSnapshot({
        nodes,
        viewport,
      }),
    }));
  };

  const commitManualNodePosition = (
    nodeId: string,
    position: TopologyNodePosition,
    flowViewport?: TopologyViewport,
  ) => {
    if (topologyLayoutMode !== 'manual') return;
    const currentViewport = flowViewport ?? manualViewport;
    const nextNodes = topologyManualResult.nodes.map((node) => (
      node.id === nodeId
        ? { ...node, position }
        : node
    ));
    saveManualTopologySnapshot({
      nodes: nextNodes,
      viewport: currentViewport,
    });
  };

  const commitManualViewport = (viewport: TopologyViewport) => {
    if (topologyLayoutMode !== 'manual') return;
    saveManualTopologySnapshot({
      nodes: topologyManualResult.nodes,
      viewport,
    });
  };

  const handleResetCurrentTopologyLayout = () => {
    setTopologyLayoutMode('manual');
    persistTopologyStore((current) => removeTopologyLayoutSnapshot(current, {
      datasetKey: topologyDatasetKey,
      scopeKey: TOPOLOGY_SCOPE_KEY,
      filterKey: topologyFilterKey,
    }));
  };

  const handleClearSavedTopologyLayouts = () => {
    setTopologyLayoutMode('manual');
    persistTopologyStore((current) => clearTopologyScopeLayouts(current, {
      datasetKey: topologyDatasetKey,
      scopeKey: TOPOLOGY_SCOPE_KEY,
    }));
  };

  const content = useMemo(() => {
    if (viewMode === 'list') {
      return (
        <ListTabView
          sections={listSections}
          filter={nodesFilter}
          onFilterChange={setNodesFilter}
          onNodeClick={(item) => {
            if (item.type === 'agent') openAgentDetail(item.id);
            else if (item.type === 'actor') openActorDetail(item.id);
            else openSignalDetail(item.id);
          }}
          signalRouteRows={signalRouteRows}
          onOpenRoute={openRouteEdit}
        />
      );
    }
    if (viewMode === 'history') {
      return (
        <SignalHistoryTabView
          events={signalHistory}
          hostLabel={signalHistoryHostLabel || undefined}
          onSelectSignal={openSignalDetail}
        />
      );
    }
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
    if (viewMode === 'device') {
      return (
        <DeviceView
          groups={deviceGroups}
          runtimeHostSnapshots={runtimeHostSnapshots}
          runtimeServiceStatus={runtimeServiceStatus}
          runtimeHostError={runtimeHostError}
          embeddedRuntimeNetworkMode={embeddedRuntimeNetworkMode}
          embeddedRuntimeBindAddress={desiredEmbeddedRuntimeAddress}
          runtimeNeedsRebind={runtimeNeedsRebind}
          runtimeTargetMode={runtimeTargetModeValue}
          runtimeTargetAddress={runtimeTargetAddress}
          runtimeTargetError={runtimeTargetError}
          runtimeExternalAddressDraft={runtimeExternalAddressDraft}
          onRuntimeHostProbe={handleProbeRuntimeHost}
          onEmbeddedRuntimeNetworkModeChange={handleEmbeddedRuntimeNetworkModeChange}
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
        layoutMode={topologyLayoutMode}
        manualViewport={manualViewport}
        onLayoutModeChange={setTopologyLayoutMode}
        onCommitNodePosition={commitManualNodePosition}
        onCommitViewport={commitManualViewport}
        onResetCurrentLayout={handleResetCurrentTopologyLayout}
        onClearSavedLayouts={handleClearSavedTopologyLayouts}
        onSelectNode={(nodeId) => {
          // 判断节点类型
          const node = signalGraph.nodes.find((n) => n.id === nodeId);
          if (node?.type === 'agent') openAgentDetail(nodeId);
          else if (node?.type === 'actor') openActorDetail(nodeId);
          else openSignalDetail(nodeId);
          // TODO(issue-354-mobile-sheet): <lg 视口点击节点后改为底部详情 Sheet。
        }}
        onClearSelection={() => {
          closeRightPanel();
        }}
      />
    );
  }, [
    commitManualNodePosition,
    commitManualViewport,
    deviceGroups,
    handleClearSavedTopologyLayouts,
    handleResetCurrentTopologyLayout,
    listSections,
    manualViewport,
    setTopologyLayoutMode,
    topologyLayoutMode,
    runtimeHostSnapshots,
    signalGraph,
    signalHistory,
    signalHistoryHostLabel,
    signalRouteHostLabel,
    signalRouteRows,
    runtimeHostError,
    embeddedRuntimeNetworkMode,
    desiredEmbeddedRuntimeAddress,
    runtimeNeedsRebind,
    runtimeTargetAddress,
    runtimeTargetError,
    runtimeTargetModeValue,
    runtimeExternalAddressDraft,
    runtimeServiceStatus,
    nodesFilter,
    viewMode,
  ]);

  return (
    <div
      data-testid="agent-hub-page"
      className="relative flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]"
    >
      {/* Header */}
      <header className="flex flex-col gap-2 border-b border-[#F0ECE8] px-5 py-3 dark:border-[#292524] md:px-8 lg:px-10">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold leading-[1.5] text-[#1C1917] dark:text-[#FAFAF9]">信号网络</h1>
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
              disabled={isAgentCreating}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[#C75B3A] px-3 text-sm text-white"
              aria-label="添加节点"
            >
              <Plus size={16} />
              {isAgentCreating ? '创建中...' : '添加'}
            </button>
          </div>
        </div>
        {/* Tab Bar（桌面端内嵌到 header，移动端显示在 header 下方） */}
        <TabBar value={viewMode} onChange={handleTabChange} />
      </header>

      {/* 主内容区：桌面端三栏（内容区 + 右侧栏），移动端单栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 内容区 */}
        <div className="flex-1 min-h-0 overflow-auto px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-3 md:px-8 md:pb-6 lg:px-10">
          {content}
        </div>

        {/* 右侧栏：桌面端固定 380px，CLOSED 时不渲染 */}
        {rightPanel.state !== 'CLOSED' && (
          <aside
            data-testid="agent-rightpanel-shell"
            className="hidden w-[380px] shrink-0 border-l border-border-card bg-surface text-foreground lg:flex lg:flex-col"
          >
            <div className="flex items-center justify-between border-b border-border-card px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                {(rightPanel.state === 'AGENT_DETAIL' || rightPanel.state === 'ACTOR_DETAIL') && (() => {
                  const nodeId = rightPanel.nodeId;
                  const node = nodeId ? signalGraph.nodes.find((n) => n.id === nodeId) : null;
                  if (!node) return null;
                  const dotColor =
                    node.status === 'online' || node.status === 'running'
                      ? 'bg-[#22C55E]'
                      : node.status === 'error' || node.status === 'offline'
                        ? 'bg-[#EF4444]'
                        : node.status === 'busy' || node.status === 'warning'
                          ? 'bg-[#F59E0B]'
                          : 'bg-[#57534E]';
                  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`} />;
                })()}
                {rightPanel.state === 'ROUTE_EDIT' && (rightPanel.routeId ? '编辑路由' : '新建路由')}
                {rightPanel.state === 'AGENT_DETAIL' && (agentDetail?.title ?? 'Agent 详情')}
                {rightPanel.state === 'ACTOR_DETAIL' && (agentDetail?.title ?? 'Actor 详情')}
                {rightPanel.state === 'SIGNAL_DETAIL' && '信号详情'}
                {rightPanel.state === 'AGENT_CHAT' && 'Agent 对话'}
              </span>
              <button
                type="button"
                onClick={closeRightPanel}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
            {/* 右侧栏内容 */}
            <div className="flex-1 overflow-auto">
              {rightPanel.state === 'ROUTE_EDIT' && (
                <RouteEditPanel
                  route={
                    rightPanel.routeId
                      ? (signalRoutes.find((r) => r.id === rightPanel.routeId) ?? null)
                      : null
                  }
                  availableTopics={availableTopics}
                  availableAgents={graphAgents.filter((a) => a.id).map((a) => ({
                    id: a.id,
                    name: a.name,
                  }))}
                  availableActors={[]}
                  onSave={handleRouteSave}
                  onDelete={
                    rightPanel.routeId
                      ? () => handleRouteDelete(rightPanel.routeId!)
                      : undefined
                  }
                  onCancel={closeRightPanel}
                  isSaving={isRouteSaving}
                />
              )}
              {(rightPanel.state === 'AGENT_DETAIL' || rightPanel.state === 'ACTOR_DETAIL') && (
                <div data-testid="agent-rightpanel-agent-detail" className="p-4 text-foreground">
                  {(() => {
                    const nodeId = rightPanel.nodeId;
                    const node = nodeId
                      ? signalGraph.nodes.find((n) => n.id === nodeId)
                      : null;
                    const runtimeNodeId = nodeId ? resolveRuntimeEntityId(nodeId) : null;
                    const nodeType = node?.type ?? (rightPanel.state === 'AGENT_DETAIL' ? 'agent' : 'actor');
                    const nodeLabel = node?.label ?? agentDetail?.title ?? runtimeNodeId ?? '未知节点';

                    const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
                      online: 'default',
                      available: 'default',
                      running: 'default',
                      offline: 'secondary',
                      unknown: 'secondary',
                      error: 'destructive',
                      busy: 'outline',
                      warning: 'outline',
                    };
                    const logStatusColors: Record<string, string> = {
                      online: 'text-foreground',
                      offline: 'text-muted-foreground',
                      warning: 'text-warning',
                      error: 'text-destructive',
                      busy: 'text-warning',
                    };

                    return (
                      <div className="flex flex-col gap-4">
                        {/* 头部：始终从 signalGraph 快速显示 */}
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-[10px] ${
                              nodeType === 'agent'
                                ? 'bg-brand/10'
                                : 'bg-warning/10'
                            }`}
                          >
                            <Bot
                              size={18}
                              className={
                                nodeType === 'agent'
                                  ? 'text-brand'
                                  : 'text-warning'
                              }
                            />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{nodeLabel}</p>
                            <p className="text-xs text-muted-foreground">
                              {nodeType === 'agent' ? 'Agent' : 'Actor'} · {runtimeNodeId ?? nodeId ?? '--'}
                            </p>
                          </div>
                        </div>

                        {/* 状态 badge（从 signalGraph 节点获取，无需 agentDetail） */}
                        {!isDetailLoading && !agentDetail && node && (
                          <Badge variant={statusVariant[node.status] ?? 'secondary'} className="w-fit">
                            {node.status}
                          </Badge>
                        )}

                        {rightPanel.state === 'AGENT_DETAIL' && nodeId && (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              data-testid="agent-rightpanel-open-chat"
                              onClick={() => {
                                void handleOpenAgentChat(nodeId);
                              }}
                            >
                              开始聊天
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              data-testid="agent-rightpanel-stop-agent"
                              onClick={() => {
                                void handleStopAgent(nodeId);
                              }}
                              disabled={isAgentStopping}
                            >
                              {isAgentStopping ? '停止中...' : '停止 Agent'}
                            </Button>
                          </div>
                        )}

                        {/* 加载态：骨架屏 */}
                        {isDetailLoading && (
                          <div className="flex flex-col gap-3">
                            <div className="h-4 w-20 rounded bg-muted animate-pulse" />
                            <div className="h-3 w-full rounded bg-muted animate-pulse" />
                            <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
                          </div>
                        )}

                        {/* 数据加载完成 */}
                        {!isDetailLoading && agentDetail && (
                          <>
                            {/* 状态 badge */}
                            <Badge variant={statusVariant[agentDetail.status] ?? 'secondary'} className="w-fit">
                              {agentDetail.status}
                            </Badge>

                            {/* 描述 */}
                            {agentDetail.description && (
                              <p className="text-xs text-muted-foreground line-clamp-3">{agentDetail.description}</p>
                            )}

                            {/* 统计指标 2x2 grid */}
                            {agentDetail.stats.length > 0 && (
                              <div className="grid grid-cols-2 gap-2">
                                {agentDetail.stats.slice(0, 4).map((s) => (
                                  <div key={s.label} className="rounded-lg border border-border-card bg-card px-3 py-2">
                                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                                    <p className="text-sm font-medium text-foreground">{s.value}</p>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* 触发规则 */}
                            {agentDetail.triggerRules.length > 0 && (
                              <div className="flex flex-col gap-1.5">
                                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">触发规则</p>
                                {agentDetail.triggerRules.slice(0, 3).map((r) => (
                                  <div key={r.key} className="flex items-baseline gap-2">
                                    <span className="font-mono text-[10px] text-muted-foreground">{r.key}:</span>
                                    <span className="text-xs text-foreground">{r.value}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* 最近日志 */}
                            {agentDetail.recentLogs.length > 0 && (
                              <div className="flex flex-col gap-1.5">
                                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">最近日志</p>
                                {agentDetail.recentLogs.slice(0, 5).map((log, i) => (
                                  <div key={i} className="flex items-baseline gap-2">
                                    <span className="shrink-0 text-[10px] text-muted-foreground">{log.time}</span>
                                    <span className={`text-xs truncate ${logStatusColors[log.status] ?? logStatusColors.online}`}>{log.title}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                          </>
                        )}

                        {/* API 返回 null 且无 workspace 数据 */}
                        {!isDetailLoading && !agentDetail && !runtimeNodeId && (
                          <p className="text-xs text-muted-foreground">暂无详细数据</p>
                        )}

                        {/* Workspace tabs — 认知生命体（独立于 agentDetail） */}
                        {!isDetailLoading && runtimeNodeId && (
                          <WorkspaceTabs agentId={runtimeNodeId} />
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
              {rightPanel.state === 'SIGNAL_DETAIL' && (
                <div data-testid="agent-rightpanel-signal-detail" className="flex flex-col gap-3 p-4 text-foreground">
                  {(() => {
                    const nodeId = rightPanel.signalId;
                    const normalizedNodeId = nodeId?.includes(':')
                      ? nodeId.split(':').slice(1).join(':')
                      : nodeId;
                    const routeMatchKey = normalizedNodeId ?? nodeId ?? '';
                    const node =
                      (nodeId ? signalGraph.nodes.find((n) => n.id === nodeId) : null) ??
                      (normalizedNodeId
                        ? signalGraph.nodes.find(
                            (n) => n.label === normalizedNodeId || n.id.endsWith(`:${normalizedNodeId}`)
                          )
                        : null);
                    const relatedRoutes = routeMatchKey
                      ? signalRoutes.filter(
                          (r) =>
                            r.target_ref === routeMatchKey || r.topic.includes(routeMatchKey)
                        )
                      : [];
                    const incomingCount = routeMatchKey
                      ? signalRoutes.filter((r) => r.target_ref === routeMatchKey).length
                      : 0;
                    const outgoingCount = routeMatchKey
                      ? signalRoutes.filter((r) => r.topic.includes(routeMatchKey)).length
                      : 0;

                    return (
                      <>
                        <div className="flex flex-col gap-1">
                          <p className="text-xs font-medium text-muted-foreground">节点 ID</p>
                          <p className="font-mono text-sm text-foreground">{nodeId ?? '—'}</p>
                        </div>

                        {node && (
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  node.type === 'signal-input'
                                    ? 'bg-[#EDE9FE] text-[#7C3AED]'
                                    : node.type === 'agent'
                                      ? 'bg-[#CCFBF1] text-[#0D9488]'
                                      : node.type === 'actor'
                                        ? 'bg-[#FEF3C7] text-[#B45309]'
                                        : node.type === 'topic'
                                          ? 'bg-[#FFEDD5] text-[#EA580C]'
                                          : 'bg-[#DBEAFE] text-[#1D4ED8]'
                                }`}
                              >
                                {signalNodeTypeBadgeLabel(node.type)}
                              </span>
                              <span className="text-xs text-muted-foreground">状态：{node.status}</span>
                            </div>
                            <div className="flex gap-4">
                              <div className="flex flex-col gap-0.5">
                                <p className="text-[10px] text-muted-foreground">接收路由</p>
                                <p className="text-sm font-medium text-foreground">{incomingCount}</p>
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <p className="text-[10px] text-muted-foreground">发送路由</p>
                                <p className="text-sm font-medium text-foreground">{outgoingCount}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col gap-1">
                          <p className="text-xs font-medium text-muted-foreground">最近信号路由</p>
                          {relatedRoutes.slice(0, 5).map((r) => (
                            <div
                              key={r.id}
                              className="flex items-center gap-2 rounded-[6px] border border-border-card bg-card px-3 py-2"
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${r.enabled ? 'bg-[#22C55E]' : 'bg-[#57534E]'}`}
                              />
                              <span className="flex-1 truncate font-mono text-xs text-foreground">
                                {r.topic}
                              </span>
                              <span className="shrink-0 text-[10px] text-muted-foreground">
                                → {r.target_type}
                              </span>
                            </div>
                          ))}
                          {relatedRoutes.length === 0 && (
                            <p className="text-xs text-muted-foreground">无关联路由</p>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              {rightPanel.state === 'AGENT_CHAT' && (
                <div data-testid="agent-rightpanel-chat-panel" className="flex h-full flex-col gap-3 bg-surface p-4 text-foreground">
                  <div className="flex-1 space-y-2 overflow-auto rounded-[10px] border border-border-card bg-card p-3">
                    {chatMessages.length === 0 && (
                      <p className="text-xs text-muted-foreground">暂无会话内容，发送第一条消息开始对话。</p>
                    )}
                    {chatMessages.map((message) => {
                      const isUser = message.role === 'user';
                      const isRuntimeMeta = !!message.runtimeEventType && message.runtimeEventType !== 'output.delta';
                      return (
                        <div
                          key={message.id}
                          data-testid={getConversationMessageTestId(message)}
                          className={`rounded-lg px-3 py-2 text-xs ${
                            isUser
                              ? 'ml-8 bg-[#C75B3A] text-white'
                              : isRuntimeMeta
                                ? 'mr-8 border border-border-card bg-muted text-muted-foreground'
                                : 'mr-8 border border-border-card bg-card text-strong'
                          }`}
                        >
                          {message.title && (
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                              {message.title}
                            </p>
                          )}
                          <p className="whitespace-pre-wrap break-words">{message.content}</p>
                        </div>
                      );
                    })}
                  </div>
                  {chatError && <p className="text-xs text-destructive">{chatError}</p>}
                  <div className="flex items-center gap-2">
                    <input
                      data-testid="agent-rightpanel-chat-input"
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void handleChatSend();
                        }
                      }}
                      placeholder="输入消息..."
                      className="h-9 flex-1 rounded-lg border border-border-card bg-card px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-[#0D9488]"
                    />
                    <button
                      type="button"
                      data-testid="agent-rightpanel-chat-send"
                      onClick={() => {
                        void handleChatSend();
                      }}
                      disabled={!chatInput.trim() || isChatSending}
                      className="h-9 rounded-lg bg-[#0D9488] px-3 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {isChatSending ? '发送中...' : '发送'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Sheets（移动端） */}
      {sheetOpen && (
        <AddNodeSheet
          options={ADD_NODE_OPTIONS}
          onClose={() => setSheetOpen(false)}
          onSelectAgent={(kind) => {
            openAgentCreateSheet(kind);
          }}
          onAddDevice={() => setHostManagerOpen(true)}
        />
      )}
      {agentCreateOpen && (
        <AgentCreateSheet
          kind={agentCreateKind}
          providerProfiles={providerProfiles}
          selectedProviderProfileId={selectedProviderProfileId}
          apiProfileName={apiProfileNameDraft}
          apiProvider={apiProviderDraft}
          apiModel={apiModelDraft}
          apiBaseUrl={apiBaseUrlDraft}
          apiKey={apiKeyDraft}
          compatibleHosts={compatibleCreateHosts}
          selectedHostId={agentCreateSelectedHostId}
          createError={agentCreateError}
          isCreating={isAgentCreating}
          onClose={() => {
            setAgentCreateOpen(false);
            setAgentCreateError('');
          }}
          onKindChange={(kind) => {
            openAgentCreateSheet(kind);
          }}
          onSelectProviderProfile={setSelectedProviderProfileId}
          onApiProfileNameChange={setApiProfileNameDraft}
          onApiProviderChange={setApiProviderDraft}
          onApiModelChange={setApiModelDraft}
          onApiBaseUrlChange={setApiBaseUrlDraft}
          onApiKeyChange={setApiKeyDraft}
          onSelectHost={setAgentCreateSelectedHostId}
          onCreate={() => {
            void handleCreateManualAgent();
          }}
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
