import {
  AlarmClock,
  Bot,
  Brain,
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
  Sparkles,
  Waypoints,
  Webhook,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { resolveLocalServiceHost } from '@/config/local-service-host';
import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  formatHostForUrl,
  type EmbeddedRuntimeNetworkMode,
  type RuntimeTarget,
} from '@/config/runtime-target';
import { readRuntimeBackedValue } from '@/config/runtime-preference-storage';
import { VOICE_INPUT_TRANSCRIPT_TOPIC } from '@/lib/constants/signal-topics';
import type {
  LinkProofAckPayload,
  LinkProofRequestPayload,
  SignalRoute,
} from '@/lib/types/signal-pool';
import type {
  AgentHubListItem,
  AgentHubListSection,
  AgentHubNodeStatus,
  AgentHubViewMode,
  RuntimeHostRecord,
} from '@/lib/types/agent-hub';
import { resolveTopologyHostId } from '@/lib/types/runtime-topology';
import type { RuntimeAggregatedAgent, RuntimeHostSnapshot } from '@/services/runtime-manager';
import type { RuntimeCreateAgentRequest } from '@/services/runtime-client';
import type { SignalGraphNodeType } from '../agents-signal-topology';

export const VIEW_ITEMS: Array<{ id: AgentHubViewMode; icon: LucideIcon; label: string }> = [
  { id: 'topology', icon: Waypoints, label: '拓扑图' },
  { id: 'sessions', icon: Crosshair, label: '会话' },
  { id: 'tiled', icon: Rocket, label: '平铺' },
  { id: 'list', icon: Bot, label: '节点' },
  { id: 'history', icon: AlarmClock, label: '信号历史' },
  { id: 'routes', icon: List, label: '路由' },
  { id: 'device', icon: Monitor, label: '设备' },
  { id: 'api-agent', icon: Webhook, label: 'API Agent' },
];

export type AddNodeOption = {
  id: RuntimeCreateAgentRequest['kind'] | 'device';
  title: string;
  description: string;
  tintColor: string;
};

export const ADD_NODE_OPTIONS: AddNodeOption[] = [
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

export const DIRECT_RUNTIME_PORT_CANDIDATES = Array.from(
  new Set([DEFAULT_EMBEDDED_RUNTIME_PORT, 1950, 1949]),
);
export const DIRECT_RUNTIME_PORT_STORAGE_KEY = 'exomind:agentHubRuntimePorts';

export interface PtySpawnConnectionTarget {
  rtBaseUrl: string;
  authToken?: string;
  hostId?: string;
}

export const MOCK_SIGNAL_ROUTES_FALLBACK: SignalRoute[] = [
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

export const MOCK_RUNTIME_AGENTS_FALLBACK: RuntimeAggregatedAgent[] = [
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

export function getListItemIcon(item: AgentHubListItem): LucideIcon {
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

export function getAddOptionIcon(optionId: AddNodeOption['id']): LucideIcon {
  if (optionId === 'claude_cli') return Brain;
  if (optionId === 'codex_cli') return Bot;
  if (optionId === 'api') return Webhook;
  if (optionId === 'echo') return MessageCircle;
  if (optionId === 'device') return Monitor;
  return Plus;
}

export const ENERGY_PHASE_COLORS: Record<string, string> = {
  normal: '#22C55E',
  slowing: '#EAB308',
  critical: '#F97316',
  dying: '#EF4444',
  dormant: '#6B7280',
};

export function mapRuntimeStatusToNodeStatus(status: string, energy?: { phase: string; is_dormant: boolean }): AgentHubNodeStatus {
  if (energy?.is_dormant) return 'dormant';
  if (energy?.phase === 'dying') return 'dying';
  if (energy?.phase === 'critical') return 'critical';
  if (status === 'available' || status === 'running') return 'running';
  if (status === 'busy') return 'warning';
  if (status === 'error') return 'warning';
  return 'idle';
}

export function formatHostUptime(uptimeSecs?: number): string {
  if (!uptimeSecs || uptimeSecs <= 0) return '--';
  const days = Math.floor(uptimeSecs / 86400);
  const hours = Math.floor((uptimeSecs % 86400) / 3600);
  const minutes = Math.floor((uptimeSecs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function getEmbeddedRuntimeModeLabel(mode: EmbeddedRuntimeNetworkMode): string {
  return mode === 'lan' ? '局域网（LAN）' : '仅本机（Local only）';
}

export function formatHostMemory(usedMb?: number, totalMb?: number): string {
  if (typeof usedMb !== 'number' || typeof totalMb !== 'number' || totalMb <= 0) return '--';
  const usedGb = (usedMb / 1024).toFixed(1);
  const totalGb = (totalMb / 1024).toFixed(1);
  return `${usedGb} / ${totalGb} GB`;
}

export function getHostStatusBadgeClass(connectionState: RuntimeHostSnapshot['connectionState']): string {
  if (connectionState === 'online') return 'bg-[#22C55E20] text-[#16A34A]';
  if (connectionState === 'offline') return 'bg-[#EF444420] text-[#DC2626]';
  return 'bg-[#F59E0B20] text-[#D97706]';
}

export function buildListSectionsFromRuntimeAgents(agents: RuntimeAggregatedAgent[]): AgentHubListSection[] {
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
        status: mapRuntimeStatusToNodeStatus(agent.status, agent.energy),
        icon: 'brain',
        badgeText: agent.sourceHostName,
        energy: agent.energy,
      })),
    };
  });
}

export function sortRouteHostsByPriority(hosts: RuntimeHostSnapshot[]): RuntimeHostSnapshot[] {
  return [...hosts].sort((left, right) => {
    const leftScore = left.connectionState === 'online' ? 0 : left.connectionState === 'error' ? 1 : 2;
    const rightScore = right.connectionState === 'online' ? 0 : right.connectionState === 'error' ? 1 : 2;
    return leftScore - rightScore;
  });
}

export function createDirectRuntimeHost(host: string, port: number, authToken?: string): RuntimeHostRecord {
  const nowIso = new Date().toISOString();
  return {
    id: `runtime-direct-${host}-${port}`.replace(/[^\w-]/g, '-'),
    name: `${host}:${port}`,
    host,
    port,
    status: 'unknown',
    createdAt: nowIso,
    updatedAt: nowIso,
    authToken,
    isLocal: true,
  };
}

export function getDirectRuntimePortCandidates(): number[] {
  if (typeof window === 'undefined') {
    return [...DIRECT_RUNTIME_PORT_CANDIDATES];
  }

  try {
    const raw = readRuntimeBackedValue(DIRECT_RUNTIME_PORT_STORAGE_KEY);
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

export function buildDirectRuntimeCandidates(hosts: RuntimeHostSnapshot[]): RuntimeHostRecord[] {
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

function buildRuntimeBaseUrl(host: string, port: number): string {
  return `http://${formatHostForUrl(host)}:${port}`;
}

function resolveRuntimeSnapshotPeerId(snapshot: RuntimeHostSnapshot): string | undefined {
  return resolveTopologyHostId(snapshot.topology) ?? snapshot.host.hostId;
}

function isLoopbackLikeHost(host: string): boolean {
  const normalizedHost = resolveLocalServiceHost(host);
  return normalizedHost === '127.0.0.1'
    || normalizedHost === 'localhost'
    || normalizedHost === '0.0.0.0'
    || normalizedHost === '::1'
    || normalizedHost === '[::1]';
}

export function resolvePtySpawnConnectionTarget(options: {
  runtimeHostSnapshots: RuntimeHostSnapshot[];
  selectedTarget: RuntimeTarget;
  runtimeServiceStatus?: { running: boolean; host: string; port: number; hostId?: string } | null;
}): PtySpawnConnectionTarget {
  const { runtimeHostSnapshots, runtimeServiceStatus, selectedTarget } = options;
  const normalizedSelectedHost = resolveLocalServiceHost(selectedTarget.host);
  const embeddedHostId = selectedTarget.mode === 'embedded' ? runtimeServiceStatus?.hostId : undefined;
  const normalizedRuntimeStatusHost = runtimeServiceStatus?.running
    ? resolveLocalServiceHost(runtimeServiceStatus.host === '0.0.0.0' ? '127.0.0.1' : runtimeServiceStatus.host)
    : undefined;

  const matchedSnapshot = runtimeHostSnapshots
    .filter((snapshot) => {
      const snapshotHost = resolveLocalServiceHost(snapshot.host.host);
      if (snapshotHost === normalizedSelectedHost && snapshot.host.port === selectedTarget.port) {
        return true;
      }

    if (
      normalizedRuntimeStatusHost
      && snapshotHost === normalizedRuntimeStatusHost
      && snapshot.host.port === runtimeServiceStatus?.port
    ) {
      return true;
    }

    if (!embeddedHostId) {
      return false;
    }

      return resolveRuntimeSnapshotPeerId(snapshot) === embeddedHostId
      || snapshot.host.id === embeddedHostId;
    })
    .sort((left, right) => {
      const score = (snapshot: RuntimeHostSnapshot): number => {
        const snapshotHost = resolveLocalServiceHost(snapshot.host.host);
        let value = 100;

        if (snapshotHost === normalizedSelectedHost && snapshot.host.port === selectedTarget.port) {
          value -= 100;
        }
        if (
          normalizedRuntimeStatusHost
          && snapshotHost === normalizedRuntimeStatusHost
          && snapshot.host.port === runtimeServiceStatus?.port
        ) {
          value -= 80;
        }
        if (
          embeddedHostId
          && (
            resolveRuntimeSnapshotPeerId(snapshot) === embeddedHostId
            || snapshot.host.id === embeddedHostId
          )
        ) {
          value -= 40;
        }
        if (selectedTarget.mode === 'embedded' && isLoopbackLikeHost(snapshot.host.host)) {
          value -= 20;
        }
        if (snapshot.host.isLocal) {
          value -= 10;
        }

        return value;
      };

      return score(left) - score(right);
    })[0];

  if (
    matchedSnapshot
    && selectedTarget.mode === 'embedded'
    && runtimeServiceStatus?.running
    && embeddedHostId
  ) {
    const matchedSnapshotHostId = resolveRuntimeSnapshotPeerId(matchedSnapshot)
      ?? matchedSnapshot.host.hostId
      ?? matchedSnapshot.host.id;
    const matchedSnapshotHost = resolveLocalServiceHost(matchedSnapshot.host.host);
    const runtimeHostMatchesSnapshotAddress = Boolean(
      normalizedRuntimeStatusHost
      && matchedSnapshotHost === normalizedRuntimeStatusHost
      && matchedSnapshot.host.port === runtimeServiceStatus.port,
    );

    if (runtimeHostMatchesSnapshotAddress && matchedSnapshotHostId !== embeddedHostId) {
      const embeddedHost = runtimeServiceStatus.host === '0.0.0.0'
        ? '127.0.0.1'
        : resolveLocalServiceHost(runtimeServiceStatus.host);

      return {
        rtBaseUrl: buildRuntimeBaseUrl(embeddedHost, runtimeServiceStatus.port),
        authToken: selectedTarget.authToken,
        hostId: embeddedHostId,
      };
    }
  }

  if (matchedSnapshot) {
    return {
      rtBaseUrl: buildRuntimeBaseUrl(matchedSnapshot.host.host, matchedSnapshot.host.port),
      authToken: matchedSnapshot.host.authToken ?? selectedTarget.authToken,
      hostId: resolveRuntimeSnapshotPeerId(matchedSnapshot)
        ?? matchedSnapshot.host.hostId
        ?? matchedSnapshot.host.id,
    };
  }

  if (selectedTarget.mode === 'embedded' && runtimeServiceStatus?.running) {
    const embeddedHost = runtimeServiceStatus.host === '0.0.0.0'
      ? '127.0.0.1'
      : resolveLocalServiceHost(runtimeServiceStatus.host);

    return {
      rtBaseUrl: buildRuntimeBaseUrl(embeddedHost, runtimeServiceStatus.port),
      authToken: selectedTarget.authToken,
      hostId: runtimeServiceStatus.hostId
        ?? createDirectRuntimeHost(embeddedHost, runtimeServiceStatus.port, selectedTarget.authToken).id,
    };
  }

  return {
    rtBaseUrl: buildRuntimeBaseUrl(normalizedSelectedHost, selectedTarget.port),
    authToken: selectedTarget.authToken,
    hostId: embeddedHostId,
  };
}

export function mapRuntimeAgentsForHost(host: RuntimeHostRecord, agents: Array<{ id: string; name: string; description: string; status: string }>): RuntimeAggregatedAgent[] {
  return agents.map((agent) => ({
    ...agent,
    sourceHostId: host.id,
    sourceHostName: host.name,
    sourceHostAddress: `${host.host}:${host.port}`,
  }));
}

export function resolveRuntimeEntityId(rawId: string): string {
  if (rawId.includes('__')) {
    return rawId.split('__').slice(1).join('__') || rawId;
  }
  if (rawId.includes(':')) {
    return rawId.split(':').slice(1).join(':') || rawId;
  }
  return rawId;
}

export function extractPreferredHostId(rawId: string | null | undefined): string | undefined {
  if (!rawId?.includes('__')) return undefined;
  const [hostId] = rawId.split('__');
  return hostId || undefined;
}

export function isLinkProofSignalTopic(topic: string): boolean {
  return topic.startsWith('system.link_proof.');
}

function formatLinkProofTriggerLabel(trigger: string | undefined): string {
  if (trigger === 'pairing_auto') return '自动配对';
  if (trigger === 'manual_retry') return '手动复测';
  return '未知触发';
}

function formatLinkProofAckKindLabel(ackKind: string | undefined): string {
  if (ackKind === 'receipt') return '回执';
  if (ackKind === 'result') return '结果';
  return '应答';
}

function formatLinkProofRequestPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const request = payload as Partial<LinkProofRequestPayload>;
  if (
    typeof request.proof_session_id !== 'string'
    || typeof request.initiated_by_peer_id !== 'string'
    || typeof request.target_peer_id !== 'string'
  ) {
    return null;
  }

  const triggerLabel = formatLinkProofTriggerLabel(request.trigger);
  return `链路验证请求 · ${request.initiated_by_peer_id} -> ${request.target_peer_id} · ${triggerLabel} · session ${request.proof_session_id}`;
}

function formatLinkProofAckPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const ack = payload as Partial<LinkProofAckPayload>;
  if (
    typeof ack.proof_session_id !== 'string'
    || typeof ack.acked_by_peer_id !== 'string'
    || typeof ack.target_peer_id !== 'string'
  ) {
    return null;
  }

  const ackKindLabel = formatLinkProofAckKindLabel(ack.ack_kind);
  const rttLabel = typeof ack.observed_rtt_ms === 'number'
    ? ` · RTT ${ack.observed_rtt_ms} ms`
    : '';
  return `链路验证${ackKindLabel} · ${ack.acked_by_peer_id} -> ${ack.target_peer_id}${rttLabel} · session ${ack.proof_session_id}`;
}

export function formatSignalPayload(payload: unknown, topic?: string): string {
  if (topic === 'system.link_proof.request') {
    const formatted = formatLinkProofRequestPayload(payload);
    if (formatted) {
      return formatted;
    }
  }

  if (topic === 'system.link_proof.ack') {
    const formatted = formatLinkProofAckPayload(payload);
    if (formatted) {
      return formatted;
    }
  }

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

export function formatSignalPayloadDetails(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function formatSignalTime(timestampMs: number): string {
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

export function formatRelativeSignalTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return '--';
  }
  const diffMs = Date.now() - timestampMs;
  if (diffMs < 60_000) {
    return `${Math.max(1, Math.floor(diffMs / 1000))} 秒前`;
  }
  if (diffMs < 3_600_000) {
    return `${Math.floor(diffMs / 60_000)} 分钟前`;
  }
  if (diffMs < 86_400_000) {
    return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  }
  return `${Math.floor(diffMs / 86_400_000)} 天前`;
}

export function signalTopicTint(topic: string): string {
  if (topic.startsWith('system.link_proof.')) return '#0F766E';
  if (topic.startsWith('system.')) return '#64748B';
  if (topic.startsWith('agent.')) return '#0D9488';
  if (topic.startsWith('task.')) return '#F59E0B';
  if (topic.startsWith('eventlog.')) return '#1D4ED8';
  if (topic.startsWith('voice.')) return '#7C3AED';
  return '#C75B3A';
}

export const TOPOLOGY_SCOPE_KEY = 'global';

export function nodeTypeTint(nodeType: SignalGraphNodeType): string {
  if (nodeType === 'signal-input') return '#8B5CF6';
  if (nodeType === 'topic') return '#C75B3A';
  if (nodeType === 'agent') return '#0D9488';
  if (nodeType === 'actor') return '#F59E0B';
  return '#6366F1';
}

export function signalNodeTypeBadgeLabel(nodeType: SignalGraphNodeType): string {
  if (nodeType === 'signal-input') return 'input';
  return nodeType;
}

export function getDeviceTypeIcon(groupId: string): LucideIcon {
  if (groupId.includes('cloud')) return Waypoints;
  return Monitor;
}
