// Agent Hub view modes（视图模式）
export const AGENT_HUB_VIEW_MODES = ['topology', 'list', 'device'] as const;
export type AgentHubViewMode = (typeof AGENT_HUB_VIEW_MODES)[number];

// Node type（节点类型）and status（运行状态）
export type AgentHubNodeType = 'input' | 'agent' | 'actor' | 'output';
export type AgentHubNodeStatus = 'running' | 'idle' | 'warning' | 'offline';
export type AgentHubNodeLayer = 'top' | 'middle' | 'bottom';

export interface AgentHubNode {
  id: string;
  type: AgentHubNodeType;
  name: string;
  status: AgentHubNodeStatus;
  layer: AgentHubNodeLayer;
  brandColor: string;
  subtitle?: string;
}

export interface AgentHubEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  color: string;
  highlighted?: boolean;
}

export interface AgentHubTopologyData {
  nodes: AgentHubNode[];
  edges: AgentHubEdge[];
  selectedNodeId?: string | null;
}

export interface AgentHubListItem {
  id: string;
  type: AgentHubNodeType;
  name: string;
  description: string;
  status: AgentHubNodeStatus;
  icon: string;
  badgeText?: string;
}

export interface AgentHubListSection {
  id: string;
  title: string;
  count: number;
  items: AgentHubListItem[];
}

export type AgentHubDeviceStatus = 'online' | 'offline' | 'warning';
export type AgentHubDeviceType = 'desktop' | 'laptop' | 'phone' | 'server' | 'embedded' | 'wearable';

export interface AgentHubDeviceMetric {
  label: string;
  value: string;
}

export interface AgentHubDeviceNodeTag {
  id: string;
  label: string;
  color: string;
}

export interface AgentHubDeviceCard {
  id: string;
  name: string;
  type: AgentHubDeviceType;
  status: AgentHubDeviceStatus;
  summary: string;
  metrics: AgentHubDeviceMetric[];
  tags: AgentHubDeviceNodeTag[];
  isHost?: boolean;
}

export interface AgentDeviceGroup {
  id: string;
  title: string;
  summary: string;
  cards: AgentHubDeviceCard[];
}

// Runtime host status（运行主机状态）用于设备页真实探测展示
export type RuntimeHostStatus = 'unknown' | 'online' | 'offline' | 'warning';

export interface RuntimeHostRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  status: RuntimeHostStatus;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  lastError?: string;
  isLocal?: boolean;
}

export interface RuntimeServiceStatus {
  running: boolean;
  host: string;
  port: number;
  pid?: number;
  startedAt?: string;
  error?: string;
}

export type AgentAddNodeOptionId = 'input' | 'agent' | 'actor' | 'output' | 'market';

export interface AgentAddNodeOption {
  id: AgentAddNodeOptionId;
  title: string;
  description: string;
  icon: string;
  tintColor: string;
}

export interface AgentDetailStat {
  label: string;
  value: string;
}

export interface AgentDetailKV {
  key: string;
  value: string;
  highlight?: boolean;
}

export interface AgentDetailTimelineItem {
  id: string;
  time: string;
  title: string;
  status: AgentHubNodeStatus;
  duration?: string;
}

export interface AgentDetailData {
  id: string;
  type: 'agent' | 'actor';
  title: string;
  status: AgentHubNodeStatus;
  description: string;
  icon: string;
  tintColor: string;
  stats: AgentDetailStat[];
  triggerRules: AgentDetailKV[];
  targets: AgentHubListItem[];
  recentLogs: AgentDetailTimelineItem[];
}

export interface AgentMarketCategory {
  id: string;
  label: string;
}

export interface AgentMarketItem {
  id: string;
  name: string;
  summary: string;
  icon: string;
  tintColor: string;
  tags: string[];
  installsText: string;
  ratingText: string;
}

export type AgentConversationRole = 'agent' | 'user';

export interface AgentConversationMessage {
  id: string;
  role: AgentConversationRole;
  content: string;
  createdAt: string;
}

export interface AgentConversationChunk {
  messageId: string;
  delta: string;
  done: boolean;
}

