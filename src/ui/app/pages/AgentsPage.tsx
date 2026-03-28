import {
  Bot,
  Brain,
  Maximize2,
  Plus,
  Settings,
  Sparkles,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getUseMockDataEnabled,
  MOCK_SESSIONS,
  subscribeUseMockDataChanges,
} from '@/config/mock-data';
import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  DEFAULT_EXTERNAL_RUNTIME_PORT,
  getEmbeddedRuntimeNetworkMode,
  getPreferredEmbeddedRuntimePort,
  formatHostForUrl,
  formatRuntimeTargetAddress,
  getRuntimeExternalAddress,
  getSelectedRuntimeTarget,
  resolveEmbeddedRuntimeBindHost,
  setRuntimeExternalAddress,
  subscribeRuntimeTargetChanges,
  type EmbeddedRuntimeNetworkMode,
  type RuntimeTargetMode,
} from '@/config/runtime-target';
import { setPersistedEmbeddedRuntimeNetworkMode } from '@/config/runtime-open-mode';
import { setPersistedRuntimeTargetMode } from '@/config/runtime-target-mode';
import { RouteEditPanel } from '@/components/RouteEditPanel';
import { PtyTerminal } from '../components/PtyTerminal';
import { PtySpawnDialog } from '../components/PtySpawnDialog';
import { getAgentHubService, SignalRouteService } from '@/lib/services';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import { getActiveInteractionContextService } from '@/lib/services/active-interaction-context.service';
import { KNOWN_AGENT_HUB_TOPICS } from '@/lib/constants/signal-topics';
import type { SignalEvent, SignalRoute } from '@/lib/types/signal-pool';
import type {
  AgentConversationMessage,
  AgentDetailData,
  AgentDeviceGroup,
  AgentEnergySnapshot,
  AgentHubListSection,
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
import type { QuickActionResponse, SessionInfo } from '@/lib/types/session';
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
  type SignalGraphNode,
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
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import {
  appendAdjacentConversationDelta,
  appendConversationChunk,
  appendConversationMessage,
  createConversationMessage,
  formatRuntimeEventPayload,
  getConversationMessageTestId,
} from './agents/conversation-runtime';
import { EnergyBar } from './agents/AgentDetailPage';
import {
  readRememberedRuntimeSession,
  rememberRuntimeSession,
} from './agents/runtime-session-cache';
import { WorkspaceTabs } from './agents/WorkspaceTabs';
import { SessionsView } from './agents/SessionsView';
import { TiledGrid, LayoutSelector, GlobalStatusIndicator, type TiledLayout } from './agents/TiledGrid';
import { useSessionStream } from '@/hooks/useSessionStream';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { log } from '@/lib/logger';
import {
  VIEW_ITEMS,
  ADD_NODE_OPTIONS,
  TOPOLOGY_SCOPE_KEY,
  MOCK_SIGNAL_ROUTES_FALLBACK,
  MOCK_RUNTIME_AGENTS_FALLBACK,
  buildListSectionsFromRuntimeAgents,
  sortRouteHostsByPriority,
  createDirectRuntimeHost,
  buildDirectRuntimeCandidates,
  mapRuntimeAgentsForHost,
  resolveRuntimeEntityId,
  extractPreferredHostId,
  formatSignalPayload,
  formatSignalTime,
  signalTopicTint,
  signalNodeTypeBadgeLabel,
} from './agents/agents-utils';
import { TopologyView } from './agents/TopologyView';
import { DeviceView } from './agents/DeviceView';
import { AddNodeSheet, AgentCreateSheet, RuntimeHostManagerSheet } from './agents/agents-sheets';
import { RoutesTabView } from './agents/RoutesTabView';
import { ListTabView, type NodeFilterType } from './agents/NodesTabView';
import { SignalHistoryTabView } from './agents/SignalHistoryTabView';

export {
  buildListSectionsFromRuntimeAgents,
  ENERGY_PHASE_COLORS,
  mapRuntimeStatusToNodeStatus,
} from './agents/agents-utils';

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


export function AgentsPage() {
  const supportsInlineRightPanel = useIsDesktop(1024);
  const initialRuntimeTarget = getSelectedRuntimeTarget();
  const [viewMode, setViewMode] = useState<AgentHubViewMode>('topology');
  const [nodesFilter, setNodesFilter] = useState<NodeFilterType>('all');
  const [topologyLayoutMode, setTopologyLayoutMode] = useState<TopologyLayoutMode>('manual');
  const [topologyLayoutStore, setTopologyLayoutStore] = useState<TopologyLayoutStore>(() => readTopologyLayoutStore());
  const topologyPendingStoreRef = useRef<TopologyLayoutStore | null>(null);
  const topologyWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to always call the latest fetchPtyAgents from the polling interval (avoids stale closure).
  const fetchPtyAgentsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // ── Tiled view state ──
  const [tiledLayout, setTiledLayout] = useState<TiledLayout>('2x2');
  const [tiledFocusedIndex, setTiledFocusedIndex] = useState<number | null>(null);
  const [tiledPaneOrder, setTiledPaneOrder] = useState<string[]>([]);
  const [useMockData, setUseMockData] = useState(getUseMockDataEnabled);

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
  const [isPtyStopping, setIsPtyStopping] = useState(false);
  const [ptyAgents, setPtyAgents] = useState<Array<{ id: string; name: string; status: string; workdir: string }>>([]);
  /** The currently active PTY — persists across panel close/open to keep the terminal mounted. */
  const [activePtyId, setActivePtyId] = useState<string | null>(null);
  const [activePtyHostId, setActivePtyHostId] = useState<string | null>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
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

  const navigateToSecondaryPage = (path: string, state: Record<string, unknown> = {}) => {
    if (typeof window === 'undefined' || window.location.pathname === path) return;
    window.history.pushState(state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  useEffect(() => subscribeUseMockDataChanges(setUseMockData), []);

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
    if (!supportsInlineRightPanel) {
      navigateToSecondaryPage(`/agents/signal/${encodeURIComponent(signalId)}`);
      return;
    }
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
  const [panelEnergy, setPanelEnergy] = useState<AgentEnergySnapshot | null>(null);
  const [isPanelRefilling, setIsPanelRefilling] = useState(false);

  useEffect(() => {
    if (rightPanel.state === 'AGENT_DETAIL' || rightPanel.state === 'ACTOR_DETAIL') {
      const nodeId = rightPanel.nodeId;
      if (!nodeId) return;
      const runtimeEntityId = resolveRuntimeEntityId(nodeId);
      setIsDetailLoading(true);
      setAgentDetail(null);
      setPanelEnergy(null);
      setIsPanelRefilling(false);
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
      setPanelEnergy(null);
      setIsPanelRefilling(false);
    }
  }, [rightPanel.state, rightPanel.nodeId]);

  // Energy polling for right panel (2s interval)
  useEffect(() => {
    if (rightPanel.state !== 'AGENT_DETAIL' || !rightPanel.nodeId) return;
    const nodeId = rightPanel.nodeId;
    const runtimeEntityId = resolveRuntimeEntityId(nodeId);
    const preferredHostId = extractPreferredHostId(nodeId);
    let disposed = false;

    const client = new RuntimeClient();
    const poll = async () => {
      const host = findPreferredRuntimeHostForAgent(runtimeHostSnapshots, runtimeEntityId, preferredHostId)
        ?? activeSignalRouteHost;
      if (!host || disposed) return;
      const snap = await client.getAgentEnergy(host, runtimeEntityId);
      if (!disposed && snap) setPanelEnergy(snap);
    };

    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [rightPanel.state, rightPanel.nodeId, runtimeHostSnapshots, activeSignalRouteHost]);

  const handlePanelRefillEnergy = async () => {
    if (rightPanel.state !== 'AGENT_DETAIL' || !rightPanel.nodeId || !panelEnergy || isPanelRefilling) return;
    const nodeId = rightPanel.nodeId;
    const runtimeEntityId = resolveRuntimeEntityId(nodeId);
    const preferredHostId = extractPreferredHostId(nodeId);
    const host = findPreferredRuntimeHostForAgent(runtimeHostSnapshots, runtimeEntityId, preferredHostId)
      ?? activeSignalRouteHost;
    if (!host) return;

    setIsPanelRefilling(true);
    try {
      const client = new RuntimeClient();
      const result = await client.refillEnergy(host, runtimeEntityId, panelEnergy.max);
      if (result.ok) {
        setPanelEnergy(result.data.energy);
      }
    } finally {
      setIsPanelRefilling(false);
    }
  };

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
      log.error(`Failed to save route: ${err instanceof Error ? err.message : String(err)}`);
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
      log.error(`Failed to toggle route: ${err instanceof Error ? err.message : String(err)}`);
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
      log.error(`Failed to delete route: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenAgentChat = async (nodeId: string) => {
    const agentId = resolveRuntimeEntityId(nodeId);
    setChatAgentId(agentId);
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
      setChatSessionId(readRememberedRuntimeSession({
        agentId,
        hostId: runtimeHost.hostId ?? runtimeHost.id,
        hostAddress: `${runtimeHost.host}:${runtimeHost.port}`,
      }));
      return;
    }

    setChatSessionId(null);

    try {
      const history = await getAgentHubService().getConversation(agentId);
      setChatMessages(history);
    } catch (error) {
      setChatMessages([]);
      const message = error instanceof Error ? error.message : String(error);
      setChatError(`加载会话失败: ${message}`);
    }
  };

  useEffect(() => {
    const service = getActiveInteractionContextService();
    const ownerId = 'agents-page:right-panel-chat';

    if (rightPanel.state === 'AGENT_CHAT' && chatAgentId) {
      service.setContext({
        targetScope: 'agent-chat',
        agentContext: {
          agentId: chatAgentId,
          sessionId: chatSessionId ?? undefined,
        },
      }, ownerId);
      return () => {
        service.clearContext(ownerId);
      };
    }

    service.clearContext(ownerId);
    return () => {
      service.clearContext(ownerId);
    };
  }, [rightPanel.state, chatAgentId, chatSessionId]);

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
        const hostAddress = `${runtimeHost.host}:${runtimeHost.port}`;
        const runtimeClient = new RuntimeClient();
        for await (const chunk of runtimeClient.streamAgentConversation(runtimeHost, {
          agentId: chatAgentId,
          message: prompt,
          sessionId: chatSessionId ?? undefined,
        })) {
          if (chunk.sessionId) {
            setChatSessionId(chunk.sessionId ?? null);
            rememberRuntimeSession({
              agentId: chatAgentId,
              sessionId: chunk.sessionId,
              hostId: runtimeHost.hostId ?? runtimeHost.id,
              hostAddress,
            });
          }
          switch (chunk.type) {
            case 'session.started':
              setChatSessionId(chunk.sessionId ?? null);
              if (chunk.sessionId) {
                rememberRuntimeSession({
                  agentId: chatAgentId,
                  sessionId: chunk.sessionId,
                  hostId: runtimeHost.hostId ?? runtimeHost.id,
                  hostAddress,
                });
              }
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

  const handleSessionQuickAction = async (session: SessionInfo, response: QuickActionResponse) => {
    const host = resolveRuntimeHostForSession(session);
    setRuntimeHostError('');
    const runtimeClient = new RuntimeClient();
    const result = await runtimeClient.submitQuickAction(host, session.id, response);
    if (!result.ok) {
      setRuntimeHostError(`提交会话动作失败: ${result.error.message}`);
    }
  };

  const handleSessionMarkWaiting = async (session: SessionInfo) => {
    const host = resolveRuntimeHostForSession(session);
    setRuntimeHostError('');
    const runtimeClient = new RuntimeClient();
    const result = await runtimeClient.markSessionWaiting(host, session.id);
    if (!result.ok) {
      setRuntimeHostError(`标记等待决策失败: ${result.error.message}`);
    }
  };

  const handleStopPtyAgent = async (ptyId: string, sourceHostId?: string | null) => {
    const host = resolveRuntimeHostBySourceHostId(sourceHostId) ?? resolveActiveRuntimeHost();
    setRuntimeHostError('');
    setIsPtyStopping(true);
    try {
      const runtimeClient = new RuntimeClient();
      const result = await runtimeClient.stopPtyAgent(host, ptyId);
      if (!result.ok) {
        setRuntimeHostError(`停止 Terminal Agent 失败: ${result.error.message}`);
        return;
      }
      if (activePtyId === ptyId) {
        setActivePtyId(null);
        setActivePtyHostId(null);
      }
      closeRightPanel();
      await fetchPtyAgents();
      refreshSessions();
    } finally {
      setIsPtyStopping(false);
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
    // 保留 PTY 终端面板状态（避免切换 Tab 丢失终端会话）
    if (rightPanel.state !== 'PTY_TERMINAL') {
      closeRightPanel();
    }
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
  const [showPtySpawnDialog, setShowPtySpawnDialog] = useState(false);

  const openPtyTerminal = (ptyId: string, hostId?: string) => {
    setActivePtyId(ptyId);
    setActivePtyHostId(hostId ?? null);
    setRightPanel({ state: 'PTY_TERMINAL', ptyId });
  };

  const handleRightPanelDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX; // Moving left increases panel width
      const newWidth = Math.max(300, Math.min(700, startWidth + delta));
      setRightPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  /** Resolve the first available RT base URL from runtime host snapshots. */
  const resolveRtBaseUrl = (): string => {
    const host = activeSignalRouteHost ?? sortRouteHostsByPriority(runtimeHostSnapshots).find((s) => s.host)?.host;
    if (host) return `http://${formatHostForUrl(host.host)}:${host.port}`;
    return `http://127.0.0.1:${DEFAULT_EMBEDDED_RUNTIME_PORT}`;
  };

  /** Resolve the auth token for the currently active RT host. */
  const resolveRtAuthToken = (): string | undefined => {
    const activeHost = activeSignalRouteHost ?? sortRouteHostsByPriority(runtimeHostSnapshots).find((s) => s.host)?.host;
    if (activeHost?.authToken) return activeHost.authToken;
    return runtimeServiceStatus?.authSecret ?? undefined;
  };

  const resolveActiveRuntimeHost = (): RuntimeHostRecord => {
    const directHost = activeSignalRouteHost
      ?? sortRouteHostsByPriority(runtimeHostSnapshots).find((snapshot) => snapshot.host)?.host;
    if (directHost) return directHost;

    const resolvedUrl = new URL(resolveRtBaseUrl());
    const fallbackPort = resolvedUrl.port
      ? Number(resolvedUrl.port)
      : resolvedUrl.protocol === 'https:'
        ? 443
        : 80;
    return createDirectRuntimeHost(resolvedUrl.hostname, fallbackPort);
  };

  const resolveRuntimeHostBySourceHostId = (sourceHostId?: string | null): RuntimeHostRecord | null => {
    if (!sourceHostId) return null;
    const matchedHost = runtimeHostSnapshots.find((snapshot) => (
      snapshot.host.hostId === sourceHostId
      || snapshot.host.id === sourceHostId
      || snapshot.topology?.host_id === sourceHostId
    ))?.host;
    return matchedHost ?? null;
  };

  const resolveRuntimeHostForSession = (session: SessionInfo): RuntimeHostRecord => {
    const matchedHost = resolveRuntimeHostBySourceHostId(session.source_host_id);
    if (matchedHost) return matchedHost;
    return resolveActiveRuntimeHost();
  };

  const resolveRuntimeConnectionForSession = (session: SessionInfo) => {
    const host = resolveRuntimeHostForSession(session);
    return {
      rtBaseUrl: `http://${formatHostForUrl(host.host)}:${host.port}`,
      authToken: host.authToken ?? resolveRtAuthToken(),
    };
  };

  const resolveRuntimeConnectionForHostId = (hostId?: string | null) => {
    const matchedHost = resolveRuntimeHostBySourceHostId(hostId);
    if (matchedHost) {
      return {
        rtBaseUrl: `http://${formatHostForUrl(matchedHost.host)}:${matchedHost.port}`,
        authToken: matchedHost.authToken ?? resolveRtAuthToken(),
      };
    }
    return {
      rtBaseUrl: resolveRtBaseUrl(),
      authToken: resolveRtAuthToken(),
    };
  };

  const sessionStreamTargets = useMemo(() => {
    const sortedHosts = sortRouteHostsByPriority(runtimeHostSnapshots);
    if (sortedHosts.length > 0) {
      return sortedHosts.map((snapshot) => ({
        id: snapshot.host.hostId ?? snapshot.topology?.host_id ?? snapshot.host.id,
        rtBaseUrl: `http://${formatHostForUrl(snapshot.host.host)}:${snapshot.host.port}`,
        authToken: snapshot.host.authToken,
        hostName: snapshot.host.name,
        hostAddress: `${snapshot.host.host}:${snapshot.host.port}`,
      }));
    }

    const host = resolveActiveRuntimeHost();
    return [{
      id: host.id,
      rtBaseUrl: `http://${formatHostForUrl(host.host)}:${host.port}`,
      authToken: host.authToken ?? resolveRtAuthToken(),
      hostName: host.name,
      hostAddress: `${host.host}:${host.port}`,
    }];
  }, [runtimeHostSnapshots, activeSignalRouteHost, runtimeServiceStatus]);

  const {
    sessions: liveSessions,
    loading: sessionLoading,
    error: sessionError,
    refresh: refreshSessions,
  } = useSessionStream({
    rtBaseUrl: null,
    targets: sessionStreamTargets,
    enabled: (viewMode === 'sessions' || viewMode === 'tiled') && !useMockData,
  });

  const dashboardSessions = useMemo(
    () => (useMockData ? MOCK_SESSIONS : liveSessions),
    [liveSessions, useMockData],
  );

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
      const [routes, agentsResult, historyResponse, energyResult] = await Promise.all([
        routeService.listRoutes(),
        runtimeClient.getAgents(host),
        fetch(`http://${formatHostForUrl(host.host)}:${host.port}/signals/history?limit=120`),
        runtimeClient.getAllEnergy(host).catch(() => ({ ok: false as const, error: { code: 'network' as const, message: 'energy fetch failed' } })),
      ]);

      // Build energy lookup map
      const energyMap = new Map<string, AgentEnergySnapshot>();
      if (energyResult.ok) {
        for (const snap of energyResult.data) {
          energyMap.set(snap.agent_id, snap);
        }
      }

      const agents = agentsResult.ok
        ? mapRuntimeAgentsForHost(host, agentsResult.data).map((agent) => ({
            ...agent,
            energy: energyMap.get(agent.id),
          }))
        : [];
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

  const fetchPtyAgents = async () => {
    try {
      const rtUrl = resolveRtBaseUrl();
      const headers: Record<string, string> = {};
      const token = resolveRtAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const resp = await fetch(`${rtUrl}/pty`, { headers });
      if (resp.ok) {
        const data = await resp.json() as Array<{ id: string; name: string; status: string; workdir: string }>;
        setPtyAgents(prev => {
          if (
            prev.length === data.length &&
            prev.every((p, i) =>
              p.id === data[i].id && p.name === data[i].name && p.status === data[i].status
            )
          ) {
            return prev; // No change — preserve reference identity
          }
          return data;
        });
        // Clear activePtyId if the PTY agent was removed
        setActivePtyId(prev => {
          if (prev && !data.some(d => d.id === prev)) return null;
          return prev;
        });
        setActivePtyHostId(prev => {
          if (activePtyId && prev && !data.some(d => d.id === activePtyId)) return null;
          return prev;
        });
      }
    } catch {
      // PTY endpoint may not be available; silently ignore
    }
  };
  // Keep ref in sync so the polling interval always calls the latest version.
  fetchPtyAgentsRef.current = fetchPtyAgents;

  const refreshRuntimeSnapshot = async () => {
    const snapshot = await getRuntimeManager().refreshSnapshot();
    applyRuntimeSnapshot(snapshot);
    await refreshSignalRoutesFromSnapshot(snapshot);
    await fetchPtyAgents();
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
      await fetchPtyAgents();
    };

    const refreshInterval = setInterval(() => {
      void (async () => {
        try {
          const nextRuntimeSnapshot = await getRuntimeManager().refreshSnapshot();
          if (disposed) return;
          applyRuntimeSnapshot(nextRuntimeSnapshot);
          await refreshSignalRoutesFromSnapshot(nextRuntimeSnapshot, () => disposed);
          await fetchPtyAgentsRef.current();
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

  const handleRuntimeTargetModeChange = async (mode: RuntimeTargetMode) => {
    const runtimeControlService = getRuntimeControlService();
    setRuntimeTargetError('');
    try {
      await setPersistedRuntimeTargetMode(mode);
      syncRuntimeTargetState();
      setRuntimeServiceStatus(await runtimeControlService.getStatus());
      await refreshRuntimeSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeTargetError(message);
    }
  };

  const handleEmbeddedRuntimeNetworkModeChange = async (mode: EmbeddedRuntimeNetworkMode) => {
    setRuntimeTargetError('');
    try {
      const persistedMode = await setPersistedEmbeddedRuntimeNetworkMode(mode);
      setEmbeddedRuntimeNetworkModeValue(persistedMode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeTargetError(message);
    }
  };

  const handleApplyRuntimeExternalAddress = async () => {
    const runtimeControlService = getRuntimeControlService();
    try {
      setRuntimeTargetError('');
      setRuntimeExternalAddress(runtimeExternalAddressDraft);
      await setPersistedRuntimeTargetMode('external');
      syncRuntimeTargetState();
      setRuntimeServiceStatus(await runtimeControlService.getStatus());
      await refreshRuntimeSnapshot();
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
  const ptyGraphNodes = useMemo((): SignalGraphNode[] => {
    return ptyAgents.map((pty, idx) => ({
      id: `pty-${pty.id}`,
      type: 'agent' as const,
      label: pty.name,
      status: pty.status === 'running' ? 'Terminal · running' : 'Terminal · offline',
      position: { x: 600, y: 80 + idx * 100 },
    }));
  }, [ptyAgents]);
  const allGraphNodes = useMemo(
    () => [...baseSignalGraph.nodes, ...ptyGraphNodes],
    [baseSignalGraph.nodes, ptyGraphNodes]
  );
  const topologyManualResult = useMemo(
    () => applyManualLayoutSnapshot({
      nodes: allGraphNodes,
      snapshot: topologyManualSnapshot,
    }),
    [allGraphNodes, topologyManualSnapshot]
  );
  const signalGraph = useMemo(() => {
    const nodes = topologyLayoutMode === 'manual'
      ? topologyManualResult.nodes
      : buildAutoFlowLayout(allGraphNodes);
    return {
      nodes,
      edges: baseSignalGraph.edges,
    };
  }, [baseSignalGraph.edges, topologyLayoutMode, topologyManualResult.nodes, allGraphNodes]);
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
    if (viewMode === 'sessions') {
      return (
        <SessionsView
          sessions={dashboardSessions}
          loading={sessionLoading}
          error={sessionError}
          useMockData={useMockData}
          onRefresh={refreshSessions}
          onSessionClick={(session) => {
            // If the session has a PTY, open it in the right panel
            if (session.pty_id) {
              openPtyTerminal(session.pty_id, session.source_host_id);
            }
          }}
          onStopSession={(session) => {
            if (!session.pty_id) return;
            void handleStopPtyAgent(session.pty_id, session.source_host_id);
          }}
        />
      );
    }
    if (viewMode === 'tiled') {
      // Filter active sessions for tiled view
      const activeSessions = dashboardSessions.filter(
        (s) => s.status !== 'completed' && s.status !== 'archived',
      );
      return (
        <div className="flex h-full flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">
                {activeSessions.length} 个活跃会话
              </span>
              <GlobalStatusIndicator sessions={activeSessions} />
            </div>
            <LayoutSelector value={tiledLayout} onChange={setTiledLayout} />
          </div>
          <div className="flex-1 min-h-0">
            <TiledGrid
              sessions={activeSessions}
              layout={tiledLayout}
              resolveSessionConnection={resolveRuntimeConnectionForSession}
              focusedIndex={tiledFocusedIndex}
              onFocusPane={setTiledFocusedIndex}
              onSessionClick={(session) => {
                if (session.pty_id) openPtyTerminal(session.pty_id, session.source_host_id);
              }}
              paneOrder={tiledPaneOrder}
              onReorder={setTiledPaneOrder}
              onQuickAction={(session, response) => {
                void handleSessionQuickAction(session, response);
              }}
              onMarkWaiting={(session) => {
                void handleSessionMarkWaiting(session);
              }}
              onStopSession={(session) => {
                if (!session.pty_id) return;
                void handleStopPtyAgent(session.pty_id, session.source_host_id);
              }}
            />
          </div>
        </div>
      );
    }
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
          // PTY nodes: open terminal panel or navigate on mobile
          if (nodeId.startsWith('pty-')) {
            const ptyId = nodeId.replace('pty-', '');
            if (supportsInlineRightPanel) {
              openPtyTerminal(ptyId);
            } else {
              const ptyParams = new URLSearchParams({ baseUrl: resolveRtBaseUrl() });
              const tok = resolveRtAuthToken();
              const ptyState: Record<string, unknown> = tok ? { ptyToken: tok } : {};
              navigateToSecondaryPage(`/agents/pty/${encodeURIComponent(ptyId)}?${ptyParams.toString()}`, ptyState);
            }
            return;
          }
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
    dashboardSessions,
    sessionLoading,
    sessionError,
    refreshSessions,
    useMockData,
    viewMode,
    tiledLayout,
    tiledFocusedIndex,
    tiledPaneOrder,
    resolveRuntimeConnectionForSession,
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
              data-testid="pty-spawn-button"
              onClick={() => setShowPtySpawnDialog(true)}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[#0D9488] px-3 text-sm text-white"
              aria-label="新建 Terminal"
            >
              <TerminalSquare size={16} />
              <span className="hidden sm:inline">Terminal</span>
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
        <div className={`flex-1 min-h-0 ${viewMode === 'topology' || viewMode === 'tiled' ? 'overflow-hidden' : 'overflow-auto'} ${viewMode === 'topology' ? '' : viewMode === 'tiled' ? 'px-2 py-2' : 'px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-3 md:px-8 md:pb-6 lg:px-10'}`}>
          {content}
        </div>

        {/* 右侧栏：桌面端可拖拽调整宽度。
            当 PTY 终端活跃时，关闭面板只隐藏 aside（display:none），
            PtyTerminal 保持挂载 → SSE 连接不断 → 终端状态持久化。 */}
        {(rightPanel.state !== 'CLOSED' || activePtyId != null) && (
          <>
          {rightPanel.state !== 'CLOSED' && (
            <div
              className="hidden w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-border-card active:bg-[#C75B3A] transition-colors lg:block"
              onMouseDown={handleRightPanelDragStart}
            />
          )}
          <aside
            data-testid="agent-rightpanel-shell"
            className="hidden shrink-0 border-l border-border-card bg-surface text-foreground lg:flex lg:flex-col"
            style={{
              width: rightPanelWidth,
              ...(rightPanel.state === 'CLOSED' ? { display: 'none' } : {}),
            }}
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
                {rightPanel.state === 'PTY_TERMINAL' && 'Terminal'}
              </span>
              <div className="flex items-center gap-1">
                {rightPanel.state === 'PTY_TERMINAL' && rightPanel.ptyId && (
                  <button
                    type="button"
                    onClick={() => {
                      const connection = resolveRuntimeConnectionForHostId(activePtyHostId);
                      const ptyParams = new URLSearchParams({ baseUrl: connection.rtBaseUrl });
                      const tok = connection.authToken;
                      const ptyState: Record<string, unknown> = tok ? { ptyToken: tok } : {};
                      window.history.pushState(ptyState, '', `/agents/pty/${rightPanel.ptyId}?${ptyParams.toString()}`);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                    aria-label="全屏"
                  >
                    <Maximize2 size={14} />
                  </button>
                )}
                {rightPanel.state === 'PTY_TERMINAL' && rightPanel.ptyId && (
                  <button
                    type="button"
                    data-testid="agent-rightpanel-stop-pty"
                    onClick={() => {
                      void handleStopPtyAgent(rightPanel.ptyId!, activePtyHostId);
                    }}
                    disabled={isPtyStopping}
                    className="flex h-7 items-center justify-center rounded px-2 text-xs text-destructive hover:text-destructive/80 disabled:opacity-60"
                    aria-label="结束 Terminal Agent"
                  >
                    {isPtyStopping ? '停止中' : '结束'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeRightPanel}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
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

                    const logStatusColors: Record<string, string> = {
                      online: 'text-foreground',
                      offline: 'text-muted-foreground',
                      warning: 'text-warning',
                      error: 'text-destructive',
                      busy: 'text-warning',
                    };

                    const hasWorkspace = Boolean(runtimeNodeId);
                    const iconToneClass = nodeType === 'agent'
                      ? 'border border-brand-accent/20 bg-brand-accent/10 text-brand-accent'
                      : 'border border-border-subtle bg-background text-strong';
                    const EntityIcon = nodeType === 'agent' ? Brain : Sparkles;
                    const detailStatus = panelEnergy?.is_dormant
                      ? 'dormant'
                      : panelEnergy?.phase === 'dying'
                        ? 'dying'
                        : panelEnergy?.phase === 'critical'
                          ? 'critical'
                          : (agentDetail?.status ?? node?.status ?? 'unknown');
                    const detailStatusClass: Record<string, string> = {
                      online: 'border-transparent bg-success/15 text-success',
                      available: 'border-transparent bg-success/15 text-success',
                      running: 'border-transparent bg-success/15 text-success',
                      offline: 'border-border-subtle bg-background text-secondary',
                      unknown: 'border-border-subtle bg-background text-secondary',
                      error: 'border-transparent bg-destructive/15 text-destructive',
                      busy: 'border-transparent bg-warning/15 text-warning',
                      warning: 'border-transparent bg-warning/15 text-warning',
                      dormant: 'border-[#6B7280]/20 bg-[#6B7280]/10 text-[#6B7280]',
                      critical: 'border-transparent bg-[#F97316]/15 text-[#F97316]',
                      dying: 'border-transparent bg-destructive/15 text-destructive',
                    };

                    return (
                      <div className="flex flex-col gap-4">
                        <Card className="rounded-xl border-border-card bg-card shadow-sm">
                          <CardContent className="space-y-4 p-4">
                            <div className="flex items-start gap-3">
                              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconToneClass}`}>
                                <EntityIcon size={18} />
                              </div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-semibold text-strong">{nodeLabel}</p>
                                  <Badge variant="outline" className="border-border-subtle bg-background text-[10px] text-secondary">
                                    {nodeType === 'agent' ? 'Agent' : 'Actor'}
                                  </Badge>
                                  {!isDetailLoading && (
                                    <Badge variant="outline" className={`text-[10px] ${detailStatusClass[detailStatus] ?? detailStatusClass.unknown}`}>
                                      {detailStatus}
                                    </Badge>
                                  )}
                                </div>
                                <p className="truncate text-xs text-secondary">
                                  Runtime ID · {runtimeNodeId ?? nodeId ?? '--'}
                                </p>
                                {agentDetail?.description ? (
                                  <p className="text-xs leading-5 text-secondary line-clamp-3">{agentDetail.description}</p>
                                ) : (
                                  <p className="text-xs leading-5 text-secondary">
                                    {hasWorkspace
                                      ? '该节点的基础详情暂未返回，但 workspace（工作区）内容仍可继续查看。'
                                      : '当前节点尚未返回扩展详情数据，请稍后再试。'}
                                  </p>
                                )}
                              </div>
                            </div>

                            {rightPanel.state === 'AGENT_DETAIL' && nodeId && (
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 rounded-lg border-brand-accent bg-brand-accent text-white hover:bg-brand-accent/90 hover:text-white"
                                  data-testid="agent-rightpanel-open-chat"
                                  onClick={() => {
                                    void handleOpenAgentChat(nodeId);
                                  }}
                                >
                                  开始聊天
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-lg border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
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

                            {isDetailLoading && (
                              <div className="flex flex-col gap-3">
                                <div className="h-4 w-24 animate-pulse rounded-md bg-background" />
                                <div className="h-16 animate-pulse rounded-xl border border-border-subtle bg-background" />
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="h-16 animate-pulse rounded-lg border border-border-subtle bg-background" />
                                  <div className="h-16 animate-pulse rounded-lg border border-border-subtle bg-background" />
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        {!isDetailLoading && agentDetail?.stats.length ? (
                          <div className="grid grid-cols-2 gap-2">
                            {agentDetail.stats.slice(0, 4).map((s) => (
                              <Card key={s.label} className="rounded-xl border-border-card bg-card shadow-sm">
                                <CardContent className="space-y-1 rounded-xl bg-background/70 p-4">
                                  <p className="text-[11px] text-secondary">{s.label}</p>
                                  <p className="text-sm font-semibold text-strong">{s.value}</p>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        ) : null}

                        {panelEnergy && (
                          <EnergyBar
                            energy={panelEnergy}
                            onRefill={handlePanelRefillEnergy}
                            isRefilling={isPanelRefilling}
                          />
                        )}

                        {!isDetailLoading && agentDetail?.triggerRules.length ? (
                          <Card className="rounded-xl border-border-card bg-card shadow-sm">
                            <CardContent className="space-y-3 p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-strong">触发规则</p>
                                <Badge variant="outline" className="border-brand-accent/20 bg-brand-accent/10 text-[10px] text-brand-accent">
                                  Rules
                                </Badge>
                              </div>
                              <div className="space-y-2">
                                {agentDetail.triggerRules.slice(0, 4).map((r) => (
                                  <div key={r.key} className="flex items-start justify-between gap-3 rounded-lg border border-border-subtle bg-background px-3 py-2">
                                    <span className="font-mono text-[10px] text-secondary">{r.key}</span>
                                    <span className={`text-right text-xs ${r.highlight ? 'font-medium text-brand-accent' : 'text-strong'}`}>
                                      {r.value}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        ) : null}

                        {!isDetailLoading && agentDetail?.recentLogs.length ? (
                          <Card className="rounded-xl border-border-card bg-card shadow-sm">
                            <CardContent className="space-y-3 p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-strong">最近日志</p>
                                <Badge variant="outline" className="border-brand-accent/20 bg-brand-accent/10 text-[10px] text-brand-accent">
                                  Logs
                                </Badge>
                              </div>
                              <div className="space-y-3">
                                {agentDetail.recentLogs.slice(0, 5).map((log, i) => (
                                  <div key={i} className="flex gap-3">
                                    <div className="flex flex-col items-center">
                                      <span className="mt-1 h-2 w-2 rounded-full bg-brand-accent" />
                                      {i !== Math.min(agentDetail.recentLogs.length, 5) - 1 && (
                                        <span className="mt-1 h-full w-px bg-border-subtle" />
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-background px-3 py-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[11px] text-secondary">{log.time}</span>
                                        <span className={`text-[11px] ${logStatusColors[log.status] ?? logStatusColors.online}`}>
                                          {log.status}
                                        </span>
                                      </div>
                                      <p className={`mt-1 truncate text-xs ${logStatusColors[log.status] ?? logStatusColors.online}`}>
                                        {log.title}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        ) : null}

                        {!isDetailLoading && !agentDetail && (
                          <Card className="rounded-xl border-border-card bg-card shadow-sm">
                            <CardContent className="space-y-2 p-4">
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-background text-secondary">
                                  <Bot size={16} />
                                </div>
                                <div className="space-y-0.5">
                                  <p className="text-sm font-semibold text-strong">详细信息暂不可用</p>
                                  <p className="text-xs text-secondary">
                                    {hasWorkspace
                                      ? '基础详情接口暂未返回，但该节点的 workspace（工作区）数据仍可正常查看。'
                                      : '当前节点尚未提供更多详情数据，请稍后再试。'}
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        )}

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
                    const historyEvent = nodeId ? signalHistory.find((eventItem) => eventItem.id === nodeId) : null;
                    const normalizedNodeId = nodeId?.includes(':')
                      ? nodeId.split(':').slice(1).join(':')
                      : nodeId;
                    const routeMatchKey = historyEvent?.topic ?? normalizedNodeId ?? nodeId ?? '';
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
                          <p className="text-xs font-medium text-muted-foreground">
                            {historyEvent ? '信号 ID' : '节点 ID'}
                          </p>
                          <p className="font-mono text-sm text-foreground">{nodeId ?? '—'}</p>
                        </div>

                        {historyEvent && (
                          <div className="flex flex-col gap-3 rounded-xl border border-border-card bg-card p-3">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: signalTopicTint(historyEvent.topic) }}
                              />
                              <p className="font-mono text-xs text-foreground">{historyEvent.topic}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="flex flex-col gap-0.5">
                                <p className="text-[10px] text-muted-foreground">来源</p>
                                <p className="text-xs text-foreground">{historyEvent.source}</p>
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <p className="text-[10px] text-muted-foreground">时间</p>
                                <p className="text-xs text-foreground">{formatSignalTime(historyEvent.ts)}</p>
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <p className="text-[10px] text-muted-foreground">主机</p>
                                <p className="text-xs text-foreground">{historyEvent.origin_host_id}</p>
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <p className="text-[10px] text-muted-foreground">跳数</p>
                                <p className="text-xs text-foreground">{historyEvent.hop}</p>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1">
                              <p className="text-[10px] text-muted-foreground">Payload</p>
                              <pre className="overflow-x-auto rounded-lg bg-background p-3 text-[10px] text-foreground">
                                {formatSignalPayload(historyEvent.payload)}
                              </pre>
                            </div>
                          </div>
                        )}

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
              {/* PTY terminal — stays mounted when activePtyId is set, hidden when panel shows other content */}
              {activePtyId && (
                <div
                  data-testid="agent-rightpanel-pty-terminal"
                  className="flex h-full flex-col overflow-hidden"
                  style={rightPanel.state !== 'PTY_TERMINAL' ? { display: 'none' } : undefined}
                >
                  {(() => {
                    const connection = resolveRuntimeConnectionForHostId(activePtyHostId);
                    return (
                  <PtyTerminal
                        rtBaseUrl={connection.rtBaseUrl}
                        ptyId={activePtyId}
                        authToken={connection.authToken}
                      />
                    );
                  })()}
                </div>
              )}
            </div>
          </aside>
          </>
        )}
      </div>

      {/* PTY Spawn Dialog */}
      <PtySpawnDialog
        open={showPtySpawnDialog}
        onOpenChange={setShowPtySpawnDialog}
        rtBaseUrl={resolveRtBaseUrl()}
        authToken={resolveRtAuthToken()}
        defaultWorkdir={import.meta.env.VITE_PTY_DEFAULT_WORKDIR ?? ''}
        onSpawned={(info) => {
          openPtyTerminal(info.id);
          void refreshRuntimeSnapshot();
        }}
      />

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
