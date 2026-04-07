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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getUseMockDataEnabled,
  MOCK_SESSIONS,
  subscribeUseMockDataChanges,
} from '@/config/mock-data';
import {
  DEFAULT_EMBEDDED_RUNTIME_PORT,
  DEFAULT_EXTERNAL_RUNTIME_PORT,
  EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY,
  getEmbeddedRuntimeNetworkMode,
  getPreferredEmbeddedRuntimePort,
  formatHostForUrl,
  parseRuntimeAddress,
  formatRuntimeTargetAddress,
  getRuntimeExternalAddress,
  getRuntimeExternalAuthToken,
  getSelectedRuntimeTarget,
  resolveEmbeddedRuntimeBindHost,
  subscribeRuntimeTargetChanges,
  type EmbeddedRuntimeNetworkMode,
  type RuntimeTargetMode,
} from '@/config/runtime-target';
import { resolveLocalServiceHost } from '@/config/local-service-host';
import { setPersistedEmbeddedRuntimeNetworkMode } from '@/config/runtime-open-mode';
import {
  setPersistedRuntimeExternalAddress,
  setPersistedRuntimeExternalAuthToken,
  setPersistedRuntimeTargetMode,
} from '@/config/runtime-target-mode';
import { RouteEditPanel } from '@/components/RouteEditPanel';
import { PtyTerminal } from '../components/PtyTerminal';
import { PtySpawnDialog } from '../components/PtySpawnDialog';
import { getAgentHubService, SignalRouteService } from '@/lib/services';
import { getRuntimeHostService } from '@/lib/services/runtime-host.service';
import { SignalStreamService } from '@/lib/services/signal-stream.service';
import { createRuntimeLinkProofService } from '@/lib/services/runtime-link-proof.service';
import { getRuntimeControlService } from '@/lib/services/runtime-control.service';
import { getActiveInteractionContextService } from '@/lib/services/active-interaction-context.service';
import { getRuntimeMeshHostSyncService } from '@/lib/services/runtime-mesh-host-sync.service';
import { getRuntimeMeshSyncService } from '@/lib/services/runtime-mesh-sync.service';
import { KNOWN_AGENT_HUB_TOPICS } from '@/lib/constants/signal-topics';
import type {
  LinkProofRequestPayload,
  SignalEvent,
  SignalRoute,
} from '@/lib/types/signal-pool';
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
  shouldAutoPollRuntimeHost,
  type RuntimeAggregatedAgent,
  type RuntimeHostSnapshot,
} from '@/services/runtime-manager';
import { RuntimeClient } from '@/services/runtime-client';
import type { RuntimeCreateAgentRequest } from '@/services/runtime-client';
import type { QuickActionResponse, SessionInfo, UpdateSessionRequest } from '@/lib/types/session';
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
import { buildPtyGraphNodes, findSessionForPty } from './agents/pty-graph-nodes';
import { applySpawnedSessionToTiledPaneOrder } from './agents/tiled-pane-order';
import { useTiledWorkbenchKeyboard } from './agents/useTiledWorkbenchKeyboard';
import {
  buildRecoverableTerminalSessionSnapshot,
  canResumeHistoricalTerminalSession,
  detectAndPersistHistoricalSessionId,
  hasMatchingHistoricalSessionRecord,
  hasMatchingHistoricalSessionSnapshotRecord,
  matchesRecoverableTerminalSessionSnapshot,
  resumeHistoricalPtySnapshot,
  getRecoverableTerminalSessionSnapshotKey,
  isRecoverableTerminalSession,
  isTerminalSessionPendingHistoricalBinding,
  replacePaneOrderSessionId,
  resolveRecoverableTerminalProjectPathKey,
  resolveTerminalSessionWorkdir,
  type RecoverableTerminalSessionSnapshot,
} from './agents/pty-session-recovery';
import {
  buildNextTiledWorkbenchLayoutName,
  cloneTiledLayoutPersistSnapshot,
  createEmptyTiledLayoutPersistSnapshot,
  createTiledWorkbenchLayoutRecord,
  extractTiledLayoutPersistSnapshot,
  readAgentsTiledWorkbenchPersistState,
  readAgentsTiledPersistState,
  writeAgentsTiledWorkbenchPersistState,
  type TiledLayoutPersistSnapshot,
} from './agents/agents-tiled-persistence';
import {
  applyLegacyPaneOrderToBindings,
  bindSessionToTiledPaneSlot,
  clearTiledPaneSlotBinding,
  createTemplatePaneSlotBindings,
  createTemplatePaneTree,
  flattenTiledPaneTreeSlotIds,
  removeTiledPaneTreeSlot,
  resolveLegacyPaneOrderFromTree,
  splitTiledPaneTreeSlot,
  updateTiledPaneTreeSplitRatio,
  type TiledPaneSplitAxis,
} from './agents/tiled-pane-tree';
import {
  readAgentsViewModePersistState,
  writeAgentsViewModePersistState,
} from './agents/agents-view-persistence';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/components/ui/toast-hook';
import { log } from '@/lib/logger';
import { PageHeaderNav } from '@/ui/app/components/PageHeaderNav';
import {
  buildRuntimeAuthHeaders,
  resolveRuntimeHostBaseUrl,
  resolveRuntimeHostDialAddress,
} from '@/lib/utils/runtime-host-address';
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
  resolvePtySpawnConnectionTarget,
  type PtySpawnConnectionTarget,
  resolveRuntimeEntityId,
  extractPreferredHostId,
  formatSignalPayloadDetails,
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
import { PeerPairingDialog } from '@/ui/app/components/PeerPairingDialog';

export {
  buildListSectionsFromRuntimeAgents,
  ENERGY_PHASE_COLORS,
  mapRuntimeStatusToNodeStatus,
} from './agents/agents-utils';

function inferEmbeddedRuntimeNetworkMode(
  status: RuntimeServiceStatus | null,
): EmbeddedRuntimeNetworkMode {
  return status?.host === '0.0.0.0' ? 'lan' : 'local';
}

function hasExplicitEmbeddedRuntimeNetworkModePreference(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(EMBEDDED_RUNTIME_NETWORK_MODE_STORAGE_KEY) !== null;
}

const LINK_PROOF_TOPIC_PREFIX = 'system.link_proof.';
const LINK_PROOF_REQUEST_TOPIC = 'system.link_proof.request';
const MANUAL_LINK_PROOF_ADOPTION_POLL_INTERVAL_MS = 500;
const FRESH_PTY_PRESENCE_GRACE_MS = 15_000;
const PENDING_HISTORICAL_BINDING_GRACE_MS = 10 * 60_000;
const ACTIVE_PTY_INITIAL_STREAM_RECONNECT_RETRY_LIMIT = 1;
const ACTIVE_PTY_INITIAL_STREAM_RECONNECT_WINDOW_MS = 10_000;

type PendingPtyPresenceCheck = {
  hostId: string | null;
  startedAtMs: number;
  expiresAtMs: number;
};

type PendingSpawnedPtyBinding = {
  ptyId: string;
  slotId?: string | null;
  layoutId?: string | null;
};

function isActiveTiledWorkbenchSession(session: SessionInfo): boolean {
  return session.status !== 'completed' && session.status !== 'archived';
}

function appendUniqueSessionIds(currentIds: string[], sessionIds: string[]): string[] {
  if (sessionIds.length === 0) {
    return currentIds;
  }

  const nextIds = [...currentIds];
  sessionIds.forEach((sessionId) => {
    if (!sessionId || nextIds.includes(sessionId)) {
      return;
    }
    nextIds.push(sessionId);
  });
  return nextIds;
}

function applySessionToTiledLayoutSnapshot({
  snapshot,
  sessions,
  sessionId,
  slotId,
}: {
  snapshot: TiledLayoutPersistSnapshot;
  sessions: SessionInfo[];
  sessionId: string;
  slotId?: string | null;
}): TiledLayoutPersistSnapshot {
  const nextSnapshot = cloneTiledLayoutPersistSnapshot(snapshot);
  const slotIds = flattenTiledPaneTreeSlotIds(nextSnapshot.tree);
  const activeSessionIds = new Set(
    sessions.filter(isActiveTiledWorkbenchSession).map((session) => session.id),
  );
  const matchingSession = sessions.find((session) => session.id === sessionId);
  const recoverySnapshot = matchingSession
    ? buildRecoverableTerminalSessionSnapshot(matchingSession) ?? undefined
    : undefined;

  if (slotId) {
    if (!slotIds.includes(slotId)) {
      return {
        ...nextSnapshot,
        unassignedSessionIds: appendUniqueSessionIds(
          nextSnapshot.unassignedSessionIds.filter((id) => id !== sessionId),
          [sessionId],
        ),
      };
    }

    const displacedSessionId = nextSnapshot.slots.find((slot) => slot.slotId === slotId)?.sessionId ?? null;
    const nextSlots = bindSessionToTiledPaneSlot(
      nextSnapshot.tree,
      nextSnapshot.slots,
      slotId,
      sessionId,
      recoverySnapshot,
    );
    const nextUnassignedSessionIds = nextSnapshot.unassignedSessionIds.filter((id) => id !== sessionId);

    return {
      ...nextSnapshot,
      paneOrder: resolveLegacyPaneOrderFromTree(nextSnapshot.tree, nextSlots),
      slots: nextSlots,
      focusedSlotId: slotId,
      unassignedSessionIds: displacedSessionId
        && displacedSessionId !== sessionId
        && activeSessionIds.has(displacedSessionId)
        ? appendUniqueSessionIds(nextUnassignedSessionIds, [displacedSessionId])
        : nextUnassignedSessionIds,
    };
  }

  const nextPaneOrder = applySpawnedSessionToTiledPaneOrder({
    layout: nextSnapshot.layout,
    paneOrder: nextSnapshot.paneOrder,
    sessions,
    newSessionId: sessionId,
  });
  const nextSlots = applyLegacyPaneOrderToBindings(nextSnapshot.tree, nextSnapshot.slots, nextPaneOrder).map((slot) => (
    slot.sessionId === sessionId && recoverySnapshot
      ? {
          ...slot,
          terminalRecovery: recoverySnapshot,
        }
      : slot
  ));
  const isAssigned = nextSlots.some((slot) => slot.sessionId === sessionId);

  return {
    ...nextSnapshot,
    paneOrder: resolveLegacyPaneOrderFromTree(nextSnapshot.tree, nextSlots),
    slots: nextSlots,
    unassignedSessionIds: isAssigned
      ? nextSnapshot.unassignedSessionIds.filter((id) => id !== sessionId)
      : appendUniqueSessionIds(nextSnapshot.unassignedSessionIds, [sessionId]),
  };
}

function isPendingPtyPresenceCheckActive(
  entry: PendingPtyPresenceCheck | undefined,
  now: number = Date.now(),
): boolean {
  return typeof entry?.expiresAtMs === 'number' && entry.expiresAtMs > now;
}

function isSamePendingPtyPresenceHost(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (left ?? null) === (right ?? null);
}

function isCompletedTerminalSession(session: SessionInfo | null | undefined): boolean {
  return session?.interaction_mode === 'terminal'
    && (session.status === 'completed' || session.status === 'archived');
}

function parseSessionWallClockMs(session: Pick<SessionInfo, 'last_active_at' | 'created_at'>): number {
  const lastActiveAtMs = Date.parse(session.last_active_at);
  if (!Number.isNaN(lastActiveAtMs)) {
    return lastActiveAtMs;
  }
  const createdAtMs = Date.parse(session.created_at);
  if (!Number.isNaN(createdAtMs)) {
    return createdAtMs;
  }
  return 0;
}

function preserveSpecificDisconnectedRuntimeMessage(previous: string, next: string): string {
  return previous.startsWith('RT 暂不可达') ? previous : next;
}

function resolveRecoverableTerminalAgentLabel(agentType?: string | null): string {
  if (agentType === 'claude') {
    return 'Claude Code';
  }
  if (agentType === 'codex') {
    return 'Codex';
  }
  return '终端';
}

function areRecoverableTerminalSessionSnapshotsEqual(
  left: RecoverableTerminalSessionSnapshot | null | undefined,
  right: RecoverableTerminalSessionSnapshot | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.sessionId === right.sessionId
    && left.sourceHostId === right.sourceHostId
    && left.agentType === right.agentType
    && left.innerSessionId === right.innerSessionId
    && left.role === right.role
    && left.workdir === right.workdir
    && left.projectPathKey === right.projectPathKey;
}

function buildHistoricalTerminalSessionIdentityKey(
  session: Pick<SessionInfo, 'agent_kind' | 'interaction_mode' | 'inner_session_id'>,
): string | null {
  if (
    session.interaction_mode !== 'terminal'
    || (session.agent_kind !== 'claude' && session.agent_kind !== 'codex')
  ) {
    return null;
  }
  const innerSessionId = session.inner_session_id?.trim();
  if (!innerSessionId) {
    return null;
  }
  return `${session.agent_kind}:${innerSessionId}`;
}

function compareHistoricalSessionPriority(
  left: SessionInfo,
  right: SessionInfo,
  options: {
    activePtyId?: string | null;
    knownPtyIds: Set<string>;
    tiledPaneOrder: string[];
  },
): number {
  const scoreDiff = getHistoricalSessionOccupancyScore(right, options)
    - getHistoricalSessionOccupancyScore(left, options);
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const timeDiff = parseSessionWallClockMs(right) - parseSessionWallClockMs(left);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  return right.id.localeCompare(left.id);
}

type TerminalResumeSuccessMode = 'live' | 'rebound' | 'resumed';

type TerminalResumeDeferredReason =
  | 'session-in-flight'
  | 'session-auto-resuming'
  | 'historical-session-in-flight'
  | 'already-attempted'
  | 'source-host-settling';

type TerminalResumeFailureReason =
  | 'source-host-unavailable'
  | 'historical-record-mismatch'
  | 'runtime-request-failed';

type TerminalResumeOutcome =
  | {
      status: 'success';
      mode: TerminalResumeSuccessMode;
      ptyId: string;
      sessionId: string;
    }
  | {
      status: 'deferred';
      reason: TerminalResumeDeferredReason;
      sessionId: string;
      historicalSessionKey?: string | null;
    }
  | {
      status: 'failed';
      reason: TerminalResumeFailureReason;
      sessionId: string;
      historicalSessionKey?: string | null;
      message?: string;
    };

function shouldKeepPendingTerminalResumeState(outcome: TerminalResumeOutcome): boolean {
  return outcome.status === 'deferred'
    && (
      outcome.reason === 'session-in-flight'
      || outcome.reason === 'session-auto-resuming'
      || outcome.reason === 'historical-session-in-flight'
      || outcome.reason === 'source-host-settling'
    );
}

function isFreshRunningTerminalSession(
  session: Pick<SessionInfo, 'status' | 'interaction_mode' | 'pty_id' | 'last_active_at' | 'created_at'>,
  now: number = Date.now(),
): boolean {
  if (
    session.status !== 'running'
    || session.interaction_mode !== 'terminal'
    || !session.pty_id
  ) {
    return false;
  }

  const wallClockMs = parseSessionWallClockMs(session);
  if (!Number.isFinite(wallClockMs) || wallClockMs <= 0) {
    return false;
  }

  return now - wallClockMs < FRESH_PTY_PRESENCE_GRACE_MS;
}

function hasRecoverablePendingHistoricalBindingContext(
  session: Pick<SessionInfo, 'context'>,
): boolean {
  const workdir = resolveTerminalSessionWorkdir(session as SessionInfo);
  if (!workdir) {
    return false;
  }

  const trimmed = workdir.trim();
  if (trimmed.length === 0) {
    return false;
  }

  if (/\$\{[^}]+\}/.test(trimmed)) {
    return false;
  }

  return /^[a-z]:[\\/]/i.test(trimmed)
    || trimmed.startsWith('\\\\')
    || trimmed.startsWith('/');
}

function isFreshPendingHistoricalBindingSession(
  session: Pick<SessionInfo, 'status' | 'interaction_mode' | 'agent_kind' | 'inner_session_id' | 'last_active_at' | 'created_at' | 'context'>,
  now: number = Date.now(),
): boolean {
  if (
    session.interaction_mode !== 'terminal'
    || (session.agent_kind !== 'claude' && session.agent_kind !== 'codex')
    || (session.inner_session_id?.trim().length ?? 0) > 0
    || session.status === 'completed'
    || session.status === 'archived'
  ) {
    return false;
  }
  if (!hasRecoverablePendingHistoricalBindingContext(session)) {
    return false;
  }

  const wallClockMs = parseSessionWallClockMs(session);
  if (!Number.isFinite(wallClockMs) || wallClockMs <= 0) {
    return false;
  }

  return now - wallClockMs < PENDING_HISTORICAL_BINDING_GRACE_MS;
}

function shouldKeepFreshPendingHistoricalBindingSessionActive(
  session: Pick<SessionInfo, 'status' | 'interaction_mode' | 'agent_kind' | 'inner_session_id' | 'last_active_at' | 'created_at' | 'context' | 'pty_id' | 'source_host_id'>,
  options: {
    now?: number;
    loadedPtyHostId?: string | null;
    activeEmbeddedRuntimeHostId?: string | null;
    pendingPtyPresenceIds?: ReadonlySet<string>;
    allowRuntimeHostFallback?: boolean;
  } = {},
): boolean {
  if (!isFreshPendingHistoricalBindingSession(session, options.now)) {
    return false;
  }

  if (session.pty_id && options.pendingPtyPresenceIds?.has(session.pty_id)) {
    return true;
  }

  const sourceHostId = session.source_host_id ?? null;
  if (!sourceHostId) {
    return true;
  }

  if (sourceHostId === (options.loadedPtyHostId ?? null)) {
    return true;
  }

  if (sourceHostId === (options.activeEmbeddedRuntimeHostId ?? null)) {
    return true;
  }

  return options.allowRuntimeHostFallback === true;
}

function resolveDialAddressFromBaseUrl(rtBaseUrl: string): string | undefined {
  try {
    const url = new URL(rtBaseUrl);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return undefined;
  }
}

const RAW_RUNTIME_FETCH_TIMEOUT_MS = 3_500;

function isRuntimeFetchTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('abort') || message.includes('timeout');
}

async function fetchRuntimeJsonWithTimeout<T>(
  url: string,
  init?: RequestInit,
  timeoutMs: number = RAW_RUNTIME_FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if (isRuntimeFetchTimeoutError(error)) {
      throw new Error('request timeout（请求超时）');
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function isOpenRecoverableTerminalSession(session: SessionInfo): boolean {
  return isRecoverableTerminalSession(session)
    && session.status !== 'completed'
    && session.status !== 'archived';
}

function hasRecoverableTerminalSessionSnapshot(session: SessionInfo): boolean {
  return buildRecoverableTerminalSessionSnapshot(session) !== null
    && session.status !== 'completed'
    && session.status !== 'archived';
}

function shouldAutoCompleteDisconnectedTerminalSession(session: SessionInfo): boolean {
  if (session.interaction_mode !== 'terminal') {
    return false;
  }

  if (buildTerminalSessionCompletionSteps(session.status).length === 0) {
    return false;
  }

  // Sessions that have already lost their PTY need explicit user handling:
  // open attempts can still try historical recovery, and the UI exposes an
  // end action for manually completing the session when recovery is impossible.
  if (!session.pty_id) {
    return false;
  }

  return true;
}

function getHistoricalSessionOccupancyScore(
  session: SessionInfo,
  options: {
    activePtyId?: string | null;
    knownPtyIds: Set<string>;
    tiledPaneOrder: string[];
  },
): number {
  let score = 0;
  const hasLivePty = !!session.pty_id && options.knownPtyIds.has(session.pty_id);

  if (hasLivePty && session.pty_id === options.activePtyId) {
    score += 16;
  }
  if (hasLivePty) {
    score += 8;
  }
  if (hasLivePty && options.tiledPaneOrder.includes(session.id)) {
    score += 4;
  }
  if (session.status === 'running') {
    score += 2;
  }

  return score;
}

function buildTerminalSessionRetirementSteps(status: SessionInfo['status']): UpdateSessionRequest[] {
  if (status === 'running') {
    return [{ status: 'completed' }, { status: 'archived' }];
  }
  if (status === 'waiting_input' || status === 'paused' || status === 'error') {
    return [{ status: 'running' }, { status: 'completed' }, { status: 'archived' }];
  }
  if (status === 'completed') {
    return [{ status: 'archived' }];
  }
  return [];
}

const TERMINAL_SESSION_RETIREMENT_PROGRESS: Record<SessionInfo['status'], number> = {
  waiting_input: 0,
  paused: 0,
  error: 0,
  running: 1,
  completed: 2,
  archived: 3,
};

function hasReachedTerminalSessionRetirementTarget(
  currentStatus: SessionInfo['status'],
  targetStatus: SessionInfo['status'],
): boolean {
  return TERMINAL_SESSION_RETIREMENT_PROGRESS[currentStatus]
    >= TERMINAL_SESSION_RETIREMENT_PROGRESS[targetStatus];
}

function buildTerminalSessionCompletionSteps(status: SessionInfo['status']): UpdateSessionRequest[] {
  if (status === 'running') {
    return [{ status: 'completed' }];
  }
  if (status === 'waiting_input' || status === 'paused' || status === 'error') {
    return [{ status: 'running' }, { status: 'completed' }];
  }
  return [];
}

function buildDisconnectedTerminalSessionDecisionSignature(session: SessionInfo): string {
  return [
    session.status,
    session.pty_id ?? '',
    session.inner_session_id ?? '',
    session.source_host_id ?? '',
    session.last_active_at ?? '',
  ].join('|');
}

function buildSupersededTerminalSessionDecisionSignature(
  session: SessionInfo,
  canonicalSession: SessionInfo,
): string {
  return [
    session.status,
    session.pty_id ?? '',
    session.inner_session_id ?? '',
    session.source_host_id ?? '',
    canonicalSession.id,
    canonicalSession.pty_id ?? '',
    canonicalSession.source_host_id ?? '',
    canonicalSession.last_active_at ?? '',
  ].join('|');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseLinkProofRequestPayload(event: SignalEvent): LinkProofRequestPayload | null {
  if (event.topic !== LINK_PROOF_REQUEST_TOPIC) {
    return null;
  }

  const payload = asRecord(event.payload);
  if (!payload) {
    return null;
  }

  const proofSessionId = readString(payload, 'proof_session_id');
  const attemptId = readString(payload, 'attempt_id');
  const initiatedByPeerId = readString(payload, 'initiated_by_peer_id');
  const targetPeerId = readString(payload, 'target_peer_id');
  const trigger = readString(payload, 'trigger');
  const sentAtMs = readNumber(payload, 'sent_at_ms');

  if (
    !proofSessionId
    || !attemptId
    || !initiatedByPeerId
    || !targetPeerId
    || (trigger !== 'pairing_auto' && trigger !== 'manual_retry')
    || typeof sentAtMs !== 'number'
  ) {
    return null;
  }

  return {
    proof_session_id: proofSessionId,
    attempt_id: attemptId,
    initiated_by_peer_id: initiatedByPeerId,
    target_peer_id: targetPeerId,
    trigger,
    sent_at_ms: sentAtMs,
  };
}

function mergeSignalHistoryEvents(...eventGroups: SignalEvent[][]): SignalEvent[] {
  const merged = new Map<string, SignalEvent>();
  for (const eventGroup of eventGroups) {
    for (const eventItem of eventGroup) {
      merged.set(eventItem.id, eventItem);
    }
  }

  return [...merged.values()].sort((left, right) => {
    if (right.ts !== left.ts) {
      return right.ts - left.ts;
    }
    return right.id.localeCompare(left.id);
  });
}

function TabBar({
  value,
  onChange,
}: {
  value: AgentHubViewMode;
  onChange: (value: AgentHubViewMode) => void;
}) {
  return (
    <PageHeaderNav
      mode="buttons"
      activeId={value}
      onChange={onChange}
      items={VIEW_ITEMS.map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        testId: `agent-view-toggle-${item.id}`,
      }))}
    />
  );
}


export function AgentsPage() {
  const supportsInlineRightPanel = useIsDesktop(1024);
  const initialRuntimeTarget = getSelectedRuntimeTarget();
  const initialTiledWorkbenchState = useMemo(() => readAgentsTiledWorkbenchPersistState(), []);
  const initialTiledLayoutRecord = initialTiledWorkbenchState.layouts[initialTiledWorkbenchState.activeLayoutId]
    ?? Object.values(initialTiledWorkbenchState.layouts)[0];
  const initialTiledState = useMemo(() => readAgentsTiledPersistState(), []);
  const [viewMode, setViewMode] = useState<AgentHubViewMode>(() => readAgentsViewModePersistState());
  const [nodesFilter, setNodesFilter] = useState<NodeFilterType>('all');
  const [topologyLayoutMode, setTopologyLayoutMode] = useState<TopologyLayoutMode>('manual');
  const [topologyLayoutStore, setTopologyLayoutStore] = useState<TopologyLayoutStore>(() => readTopologyLayoutStore());
  const topologyPendingStoreRef = useRef<TopologyLayoutStore | null>(null);
  const topologyWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to always call the latest fetchPtyAgents from the polling interval (avoids stale closure).
  const fetchPtyAgentsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const runtimeStartInFlightRef = useRef<Promise<void> | null>(null);
  const autoRuntimeRebindKeyRef = useRef<string | null>(null);
  const confirmedMeshReplayKeyRef = useRef<Set<string>>(new Set());
  const missingRuntimeAuthWarningKeysRef = useRef<Set<string>>(new Set());
  const autoAdoptedLinkProofEventIdsRef = useRef<Set<string>>(new Set());
  const inFlightLinkProofPeerIdsRef = useRef<Set<string>>(new Set());
  const inFlightLinkProofSessionIdsRef = useRef<Set<string>>(new Set());
  const isAgentsPageDisposedRef = useRef(false);
  const runtimeHostSnapshotsRef = useRef<RuntimeHostSnapshot[]>([]);
  const runtimeServiceStatusRef = useRef<RuntimeServiceStatus | null>(null);
  const refreshRuntimeHostsRef = useRef<(statusOverride?: RuntimeServiceStatus | null) => Promise<void>>(
    async () => {},
  );
  // ── Tiled view state ──
  const [tiledLayout, setTiledLayout] = useState<TiledLayout>(initialTiledState.layout);
  const [tiledPaneTree, setTiledPaneTree] = useState(initialTiledState.tree);
  const [tiledPaneSlots, setTiledPaneSlots] = useState(initialTiledState.slots);
  const [tiledWorkbenchLayouts, setTiledWorkbenchLayouts] = useState(initialTiledWorkbenchState.layouts);
  const [tiledWorkbenchLayoutOrder, setTiledWorkbenchLayoutOrder] = useState(initialTiledWorkbenchState.layoutOrder);
  const [tiledActiveLayoutId, setTiledActiveLayoutId] = useState(initialTiledWorkbenchState.activeLayoutId);
  const [tiledActiveLayoutNameDraft, setTiledActiveLayoutNameDraft] = useState(
    initialTiledLayoutRecord?.name ?? '默认布局',
  );
  const [tiledFocusedSlotId, setTiledFocusedSlotId] = useState<string | null>(
    initialTiledState.focusedSlotId ?? null,
  );
  const [tiledUnassignedSessionIds, setTiledUnassignedSessionIds] = useState<string[]>(
    initialTiledState.unassignedSessionIds,
  );
  const [tiledUnassignedPoolCollapsed, setTiledUnassignedPoolCollapsed] = useState(
    initialTiledState.unassignedPoolCollapsed,
  );
  const [tiledImmersive, setTiledImmersive] = useState(initialTiledState.immersive);
  const [tiledPassthroughArmed, setTiledPassthroughArmed] = useState(false);
  const tiledSlotIds = useMemo(
    () => flattenTiledPaneTreeSlotIds(tiledPaneTree),
    [tiledPaneTree],
  );
  const tiledPaneOrder = useMemo(
    () => resolveLegacyPaneOrderFromTree(tiledPaneTree, tiledPaneSlots),
    [tiledPaneTree, tiledPaneSlots],
  );
  const tiledActiveLayoutRecord = useMemo(
    () => tiledWorkbenchLayouts[tiledActiveLayoutId]
      ?? tiledWorkbenchLayouts[tiledWorkbenchLayoutOrder[0] ?? '']
      ?? null,
    [tiledActiveLayoutId, tiledWorkbenchLayoutOrder, tiledWorkbenchLayouts],
  );
  const tiledFocusedIndex = useMemo(() => {
    if (!tiledFocusedSlotId) {
      return null;
    }
    const index = tiledSlotIds.indexOf(tiledFocusedSlotId);
    return index === -1 ? null : index;
  }, [tiledFocusedSlotId, tiledSlotIds]);
  const setTiledPaneOrder = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    setTiledPaneSlots((prev) => {
      const prevOrder = resolveLegacyPaneOrderFromTree(tiledPaneTree, prev);
      const nextOrder = typeof next === 'function' ? next(prevOrder) : next;
      return applyLegacyPaneOrderToBindings(tiledPaneTree, prev, nextOrder);
    });
  }, [tiledPaneTree]);
  const handleTiledFocusPane = useCallback((index: number | null) => {
    if (index == null) {
      setTiledFocusedSlotId(null);
      return;
    }
    setTiledFocusedSlotId(tiledSlotIds[index] ?? null);
  }, [tiledSlotIds]);
  const handleTiledLayoutChange = useCallback((nextLayout: TiledLayout) => {
    setTiledLayout(nextLayout);
    const nextTree = createTemplatePaneTree(nextLayout);
    setTiledPaneTree(nextTree);
    setTiledPaneSlots((prev) => {
      const prevOrder = resolveLegacyPaneOrderFromTree(tiledPaneTree, prev);
      return applyLegacyPaneOrderToBindings(
        nextTree,
        createTemplatePaneSlotBindings(nextLayout),
        prevOrder,
      );
    });
    setTiledFocusedSlotId((prev) => {
      const nextSlotIds = flattenTiledPaneTreeSlotIds(nextTree);
      return prev && nextSlotIds.includes(prev) ? prev : nextSlotIds[0] ?? null;
    });
  }, [tiledPaneTree]);
  useEffect(() => {
    if (!tiledFocusedSlotId) {
      if (tiledSlotIds[0]) {
        setTiledFocusedSlotId(tiledSlotIds[0]);
      }
      return;
    }
    if (!tiledSlotIds.includes(tiledFocusedSlotId)) {
      setTiledFocusedSlotId(tiledSlotIds[0] ?? null);
    }
  }, [tiledFocusedSlotId, tiledSlotIds]);
  const toggleTiledImmersive = useCallback(() => {
    setTiledImmersive((prev) => {
      const next = !prev;
      if (next) {
        setTiledUnassignedPoolCollapsed(true);
      }
      return next;
    });
  }, []);
  const toggleTiledUnassignedPool = useCallback(() => {
    setTiledUnassignedPoolCollapsed((prev) => !prev);
  }, []);
  const buildCurrentTiledLayoutSnapshot = useCallback((): TiledLayoutPersistSnapshot => ({
    version: 2,
    layout: tiledLayout,
    paneOrder: tiledPaneOrder,
    tree: tiledPaneTree,
    slots: tiledPaneSlots,
    ...(tiledFocusedSlotId ? { focusedSlotId: tiledFocusedSlotId } : {}),
    unassignedSessionIds: tiledUnassignedSessionIds,
    unassignedPoolCollapsed: tiledUnassignedPoolCollapsed,
    immersive: tiledImmersive,
  }), [
    tiledFocusedSlotId,
    tiledImmersive,
    tiledLayout,
    tiledPaneOrder,
    tiledPaneSlots,
    tiledPaneTree,
    tiledUnassignedPoolCollapsed,
    tiledUnassignedSessionIds,
  ]);
  const applyTiledLayoutSnapshot = useCallback((snapshot: TiledLayoutPersistSnapshot) => {
    const nextSnapshot = extractTiledLayoutPersistSnapshot(snapshot);

    setTiledLayout(nextSnapshot.layout);
    setTiledPaneTree(nextSnapshot.tree);
    setTiledPaneSlots(nextSnapshot.slots);
    setTiledFocusedSlotId(nextSnapshot.focusedSlotId ?? null);
    setTiledUnassignedSessionIds(nextSnapshot.unassignedSessionIds);
    setTiledUnassignedPoolCollapsed(nextSnapshot.unassignedPoolCollapsed);
    setTiledImmersive(nextSnapshot.immersive);
    setTiledPassthroughArmed(false);
  }, []);
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
  const [hasExplicitEmbeddedRuntimeNetworkMode, setHasExplicitEmbeddedRuntimeNetworkMode] = useState<boolean>(
    hasExplicitEmbeddedRuntimeNetworkModePreference(),
  );
  const [runtimeTargetModeValue, setRuntimeTargetModeValue] = useState<RuntimeTargetMode>(initialRuntimeTarget.mode);
  const [runtimeTargetAddress, setRuntimeTargetAddress] = useState(
    formatRuntimeTargetAddress(initialRuntimeTarget),
  );
  const [runtimeExternalAddressDraft, setRuntimeExternalAddressDraft] = useState(
    getRuntimeExternalAddress(),
  );
  const [runtimeExternalAuthTokenDraft, setRuntimeExternalAuthTokenDraft] = useState(
    getRuntimeExternalAuthToken(),
  );
  const [runtimeTargetError, setRuntimeTargetError] = useState('');
  const [rightPanel, setRightPanel] = useState<AgentHubRightPanelContext>(() => (
    supportsInlineRightPanel && initialTiledState.fullscreenPtyId
      ? { state: 'PTY_TERMINAL', ptyId: initialTiledState.fullscreenPtyId }
      : { state: 'CLOSED' }
  ));
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<AgentConversationMessage[]>([]);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');
  const [isChatSending, setIsChatSending] = useState(false);
  const [isAgentCreating, setIsAgentCreating] = useState(false);
  const [isAgentStopping, setIsAgentStopping] = useState(false);
  const [stoppingPtyIds, setStoppingPtyIds] = useState<string[]>([]);
  const [resolvingTerminalSessionIds, setResolvingTerminalSessionIds] = useState<string[]>([]);
  const [hasLoadedPtyAgents, setHasLoadedPtyAgents] = useState(false);
  const [loadedPtyHostId, setLoadedPtyHostId] = useState<string | null>(null);
  const [ptyAgents, setPtyAgents] = useState<Array<{
    id: string;
    name: string;
    status: string;
    workdir: string;
    sourceHostId?: string;
  }>>([]);
  const [failedPtyConnectionIds, setFailedPtyConnectionIds] = useState<string[]>([]);
  const [pendingPtyPresenceChecks, setPendingPtyPresenceChecks] = useState<Record<string, PendingPtyPresenceCheck>>({});
  const [pendingSpawnedPtyBindings, setPendingSpawnedPtyBindings] = useState<PendingSpawnedPtyBinding[]>([]);
  /** The currently active PTY — persists across panel close/open to keep the terminal mounted. */
  const [activePtyId, setActivePtyId] = useState<string | null>(initialTiledState.fullscreenPtyId ?? null);
  const [activePtyHostId, setActivePtyHostId] = useState<string | null>(null);
  const [activePtyTerminalNonce, setActivePtyTerminalNonce] = useState(0);
  const activePtyInitialStreamReconnectStateRef = useRef<Map<string, { retryCount: number; firstFailureAtMs: number }>>(
    new Map(),
  );
  const [fullscreenTerminalRecovery, setFullscreenTerminalRecovery] = useState<RecoverableTerminalSessionSnapshot | null>(
    initialTiledState.fullscreenTerminalRecovery ?? null,
  );
  const [autoResumingSessionIds, setAutoResumingSessionIds] = useState<string[]>([]);
  const autoResumingSessionIdsRef = useRef<Set<string>>(new Set());
  const autoResumeInFlightSessionIdsRef = useRef<Set<string>>(new Set());
  const autoResumeInFlightHistoricalSessionKeysRef = useRef<Set<string>>(new Set());
  const autoResumeAttemptedSessionIdsRef = useRef<Set<string>>(new Set());
  const persistedFullscreenRecoveryAttemptedKeysRef = useRef<Set<string>>(new Set());
  const deferredAutoResumeDecisionSignaturesRef = useRef<Map<string, string>>(new Map());
  const autoCompletingDisconnectedSessionIdsRef = useRef<Set<string>>(new Set());
  const disconnectedSessionDecisionSignaturesRef = useRef<Map<string, string>>(new Map());
  const retiringSupersededSessionIdsRef = useRef<Set<string>>(new Set());
  const supersededSessionDecisionSignaturesRef = useRef<Map<string, string>>(new Map());
  const [persistedFullscreenAutoResumeKey, setPersistedFullscreenAutoResumeKey] = useState<string | null>(null);
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

  useEffect(() => {
    isAgentsPageDisposedRef.current = false;
    return () => {
      isAgentsPageDisposedRef.current = true;
    };
  }, []);

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

  const isPtyStopPending = useCallback(
    (ptyId?: string | null) => Boolean(ptyId && stoppingPtyIds.includes(ptyId)),
    [stoppingPtyIds],
  );
  const setTerminalSessionResolutionPending = useCallback((sessionId: string, isPending: boolean) => {
    setResolvingTerminalSessionIds((prev) => {
      if (isPending) {
        return prev.includes(sessionId) ? prev : [...prev, sessionId];
      }
      return prev.filter((id) => id !== sessionId);
    });
  }, []);
  const isTerminalSessionResolutionPending = useCallback(
    (session: Pick<SessionInfo, 'id' | 'pty_id'>) => (
      isPtyStopPending(session.pty_id)
      || resolvingTerminalSessionIds.includes(session.id)
    ),
    [isPtyStopPending, resolvingTerminalSessionIds],
  );

  const handleStopPtyAgent = async (ptyId: string, sourceHostId?: string | null) => {
    if (isPtyStopPending(ptyId)) {
      return;
    }
    const host = resolveRuntimeHostBySourceHostId(sourceHostId) ?? resolveActiveRuntimeHost();
    const connection = resolveRuntimeConnectionForHostId(sourceHostId);
    const dialAddress = resolveDialAddressFromBaseUrl(connection.rtBaseUrl);
    const requestHost = dialAddress
      ? {
          ...host,
          authToken: connection.authToken ?? host.authToken,
          lastSuccessfulDialAddress: dialAddress,
        }
      : {
          ...host,
          authToken: connection.authToken ?? host.authToken,
        };
    const matchingLocalSession = dashboardSessions.find((session) => (
      session.interaction_mode === 'terminal'
      && session.pty_id === ptyId
      && (sourceHostId == null || session.source_host_id === sourceHostId)
    )) ?? dashboardSessions.find((session) => (
      session.interaction_mode === 'terminal' && session.pty_id === ptyId
    )) ?? null;
    const targetLabel = matchingLocalSession?.role || ptyId;
    const stopToast = toast({
      title: '正在结束 Terminal Agent',
      description: `会话：${targetLabel}`,
      duration: 5000,
    });
    setRuntimeHostError('');
    setStoppingPtyIds((prev) => (prev.includes(ptyId) ? prev : [...prev, ptyId]));
    console.info('[agent-hub][pty][stop] start', {
      ptyId,
      sourceHostId: sourceHostId ?? null,
      hostAddress: dialAddress ?? `${host.host}:${host.port}`,
      targetLabel,
    });
    try {
      const runtimeClient = new RuntimeClient({ timeoutMs: 10000 });
      const result = await runtimeClient.stopPtyAgent(requestHost, ptyId);
      if (!result.ok) {
        let shouldAttemptReconciliation = result.error.status === 404;
        if (!shouldAttemptReconciliation && (result.error.code === 'timeout' || result.error.code === 'network')) {
          const livePtys = await fetchPtyList(
            connection.rtBaseUrl,
            connection.authToken,
            sourceHostId ?? undefined,
          ).catch(() => null);
          shouldAttemptReconciliation = Boolean(livePtys && !livePtys.some((pty) => pty.id === ptyId));
        }

        if (shouldAttemptReconciliation) {
          const matchesPtySession = (session: SessionInfo) => (
            session.interaction_mode === 'terminal' && session.pty_id === ptyId
          );
          const exactLocalMatch = dashboardSessions.find((session) => (
            matchesPtySession(session)
            && (sourceHostId == null || session.source_host_id === sourceHostId)
          ));
          const fallbackLocalMatch = exactLocalMatch ?? dashboardSessions.find(matchesPtySession);

          let recoveredSession = fallbackLocalMatch ?? null;
          if (!recoveredSession) {
            const freshSessions = await fetchSessionList(connection.rtBaseUrl, connection.authToken);
            const exactRemoteMatch = freshSessions?.find((session) => (
              matchesPtySession(session)
              && (sourceHostId == null || session.source_host_id === sourceHostId)
            ));
            recoveredSession = exactRemoteMatch ?? freshSessions?.find(matchesPtySession) ?? null;
            if (recoveredSession) {
              console.warn('[agent-hub][pty] stop reconciliation recovered session via fresh /sessions fetch', {
                ptyId,
                sourceHostId: sourceHostId ?? null,
                matchedSessionId: recoveredSession.id,
                matchedSessionSourceHostId: recoveredSession.source_host_id ?? null,
                hostAddress: dialAddress ?? `${host.host}:${host.port}`,
              });
            }
          } else if (sourceHostId && recoveredSession.source_host_id !== sourceHostId) {
            console.warn('[agent-hub][pty] stop reconciliation fell back to session match without source_host_id', {
              ptyId,
              sourceHostId,
              matchedSessionId: recoveredSession.id,
              matchedSessionSourceHostId: recoveredSession.source_host_id ?? null,
              hostAddress: dialAddress ?? `${host.host}:${host.port}`,
            });
          }

          if (!recoveredSession) {
            const failureMessage = '当前 PTY 已不存在，但未找到对应会话，无法自动收敛。请刷新后重试或直接归档。';
            console.warn('[agent-hub][pty][stop] reconciliation skipped because matching session was not found', {
              ptyId,
              sourceHostId: sourceHostId ?? null,
              hostAddress: dialAddress ?? `${host.host}:${host.port}`,
              dashboardSessionIds: dashboardSessions
                .filter((session) => session.pty_id === ptyId)
                .map((session) => session.id),
            });
            setRuntimeHostError(failureMessage);
            stopToast.update({
              id: stopToast.id,
              title: '结束 Terminal Agent 失败',
              description: failureMessage,
              variant: 'destructive',
              duration: 6000,
            });
            return;
          }

          const recoverySteps: UpdateSessionRequest[] = [];

          if (recoveredSession.status === 'running') {
            recoverySteps.push({ status: 'completed' });
          } else if (
            recoveredSession.status === 'waiting_input'
            || recoveredSession.status === 'paused'
            || recoveredSession.status === 'error'
          ) {
            recoverySteps.push({ status: 'running' }, { status: 'completed' });
          }

          let recoveryFailedMessage: string | null = null;
          for (const step of recoverySteps) {
            const recoveryResult = await runtimeClient.updateSession(requestHost, recoveredSession.id, step);
            if (!recoveryResult.ok) {
              recoveryFailedMessage = recoveryResult.error.message;
              break;
            }
            recoveredSession = recoveryResult.data;
          }

          if (!recoveryFailedMessage) {
            if (activePtyId === ptyId) {
              setActivePtyId(null);
              setActivePtyHostId(null);
            }
            closeRightPanel();
            await fetchPtyAgents();
            refreshSessions();
            console.warn('[agent-hub][pty][stop] reconciled missing PTY session', {
              ptyId,
              sourceHostId: sourceHostId ?? null,
              recoveredSessionId: recoveredSession.id,
              hostAddress: dialAddress ?? `${host.host}:${host.port}`,
              reason: result.error.code,
            });
            stopToast.update({
              id: stopToast.id,
              title: '已收敛失联 Terminal 会话',
              description: '当前 PTY 已不存在，已将会话标记为已完成，可继续归档。',
              duration: 6000,
            });
            return;
          }

          const failureMessage = `停止 Terminal Agent 失败: ${result.error.message}；会话收敛失败: ${recoveryFailedMessage}`;
          console.warn('[agent-hub][pty][stop] reconciliation failed', {
            ptyId,
            sourceHostId: sourceHostId ?? null,
            recoveredSessionId: recoveredSession.id,
            hostAddress: dialAddress ?? `${host.host}:${host.port}`,
            stopError: result.error.message,
            recoveryFailedMessage,
          });
          setRuntimeHostError(failureMessage);
          stopToast.update({
            id: stopToast.id,
            title: '结束 Terminal Agent 失败',
            description: failureMessage,
            variant: 'destructive',
            duration: 6000,
          });
          return;
        }
        const failureMessage = `停止 Terminal Agent 失败: ${result.error.message}`;
        console.warn('[agent-hub][pty][stop] failed', {
          ptyId,
          sourceHostId: sourceHostId ?? null,
          hostAddress: dialAddress ?? `${host.host}:${host.port}`,
          error: result.error,
        });
        setRuntimeHostError(failureMessage);
        stopToast.update({
          id: stopToast.id,
          title: '结束 Terminal Agent 失败',
          description: failureMessage,
          variant: 'destructive',
          duration: 6000,
        });
        return;
      }
      if (activePtyId === ptyId) {
        setActivePtyId(null);
        setActivePtyHostId(null);
      }
      closeRightPanel();
      await fetchPtyAgents();
      refreshSessions();
      console.info('[agent-hub][pty][stop] success', {
        ptyId,
        sourceHostId: sourceHostId ?? null,
        hostAddress: dialAddress ?? `${host.host}:${host.port}`,
        status: result.data.status,
      });
      stopToast.update({
        id: stopToast.id,
        title: '已结束 Terminal Agent',
        description: `会话：${targetLabel}`,
        duration: 4000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureMessage = `停止 Terminal Agent 失败: ${message}`;
      console.warn('[agent-hub][pty][stop] action threw', {
        ptyId,
        sourceHostId: sourceHostId ?? null,
        hostAddress: dialAddress ?? `${host.host}:${host.port}`,
        message,
      });
      setRuntimeHostError(failureMessage);
      stopToast.update({
        id: stopToast.id,
        title: '结束 Terminal Agent 失败',
        description: failureMessage,
        variant: 'destructive',
        duration: 6000,
      });
    } finally {
      setStoppingPtyIds((prev) => prev.filter((id) => id !== ptyId));
    }
  };

  const handleArchiveSession = async (session: SessionInfo): Promise<boolean> => {
    const host = resolveRuntimeHostForSession(session);
    setRuntimeHostError('');
    const runtimeClient = new RuntimeClient();
    const result = await runtimeClient.updateSession(host, session.id, { status: 'archived' });
    if (!result.ok) {
      setRuntimeHostError(`归档会话失败: ${result.error.message}`);
      return false;
    }
    refreshSessions();
    return true;
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
          host = await getRuntimeManager().addHostFromAddress(
            targetAddress,
            `Selected Runtime · ${targetAddress}`,
            selectedTarget.authToken,
          );
        } catch {
          host = createDirectRuntimeHost(selectedTarget.host, selectedTarget.port, selectedTarget.authToken);
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
    writeAgentsViewModePersistState(viewMode);
  }, [viewMode]);

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
  const [ptySpawnTargetSlotId, setPtySpawnTargetSlotId] = useState<string | null>(null);
  const [ptySpawnTargetLayoutId, setPtySpawnTargetLayoutId] = useState<string | null>(null);
  const [peerPairingOpen, setPeerPairingOpen] = useState(false);

  const openPtyTerminal = useCallback((
    ptyId: string,
    hostId?: string,
    options: { expectFreshPresence?: boolean; reconnectIfSame?: boolean } = {},
  ) => {
    setFailedPtyConnectionIds((prev) => prev.filter((id) => id !== ptyId));
    if (options.expectFreshPresence) {
      setPendingPtyPresenceChecks((prev) => {
        const nextHostId = hostId ?? null;
        const now = Date.now();
        const nextEntry: PendingPtyPresenceCheck = {
          hostId: nextHostId,
          startedAtMs: now,
          expiresAtMs: now + FRESH_PTY_PRESENCE_GRACE_MS,
        };
        const previousEntry = prev[ptyId];
        if (
          previousEntry
          && isSamePendingPtyPresenceHost(previousEntry.hostId, nextHostId)
          && isPendingPtyPresenceCheckActive(previousEntry, now)
        ) {
          return prev;
        }
        return { ...prev, [ptyId]: nextEntry };
      });
    }
    if (options.reconnectIfSame && activePtyId === ptyId) {
      setActivePtyTerminalNonce((prev) => prev + 1);
    }
    setActivePtyId(ptyId);
    setActivePtyHostId(hostId ?? null);
    setRightPanel({ state: 'PTY_TERMINAL', ptyId });
  }, [activePtyId]);

  const fetchPtyList = useCallback(async (
    rtBaseUrl: string,
    authToken?: string,
    sourceHostId?: string,
  ): Promise<Array<{
    id: string;
    name: string;
    status: string;
    workdir: string;
    sourceHostId?: string;
  }>> => {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const data = await fetchRuntimeJsonWithTimeout<Array<{
      id: string;
      name: string;
      status: string;
      workdir: string;
    }>>(`${rtBaseUrl}/pty`, { headers });

    return data.map((pty) => ({ ...pty, sourceHostId }));
  }, []);

  const fetchSessionList = useCallback(async (
    rtBaseUrl: string,
    authToken?: string,
  ): Promise<SessionInfo[]> => {
    return fetchRuntimeJsonWithTimeout<SessionInfo[]>(`${rtBaseUrl}/sessions`, {
      headers: Object.fromEntries(buildRuntimeAuthHeaders(authToken).entries()),
    });
  }, []);

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

  const embeddedRuntimeHost = useMemo<RuntimeHostRecord | null>(() => {
    const selectedTarget = getSelectedRuntimeTarget();
    if (selectedTarget.mode !== 'embedded' || !runtimeServiceStatus?.running) {
      return null;
    }

    const embeddedHost = resolveLocalServiceHost(
      runtimeServiceStatus.host === '0.0.0.0'
        ? '127.0.0.1'
        : runtimeServiceStatus.host,
    );

    return {
      ...createDirectRuntimeHost(embeddedHost, runtimeServiceStatus.port, selectedTarget.authToken),
      name: `${embeddedHost}:${runtimeServiceStatus.port}`,
      hostId: runtimeServiceStatus.hostId,
      isLocal: true,
    };
  }, [
    runtimeServiceStatus?.host,
    runtimeServiceStatus?.hostId,
    runtimeServiceStatus?.port,
    runtimeServiceStatus?.running,
    runtimeTargetAddress,
    runtimeTargetModeValue,
  ]);
  const activeEmbeddedRuntimeHostId = embeddedRuntimeHost?.hostId ?? embeddedRuntimeHost?.id ?? null;
  const [embeddedRuntimeHostIdentitySettlingTick, setEmbeddedRuntimeHostIdentitySettlingTick] = useState(0);
  useEffect(() => {
    if (runtimeTargetModeValue !== 'embedded' || !runtimeServiceStatus?.running) {
      return;
    }

    const startedAtMs = runtimeServiceStatus.startedAt
      ? Date.parse(runtimeServiceStatus.startedAt)
      : Number.NaN;
    if (!Number.isFinite(startedAtMs)) {
      return;
    }

    const remainingMs = (startedAtMs + 20_000) - Date.now();
    if (remainingMs <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setEmbeddedRuntimeHostIdentitySettlingTick((current) => current + 1);
    }, remainingMs + 1);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    runtimeServiceStatus?.running,
    runtimeServiceStatus?.startedAt,
    runtimeTargetModeValue,
  ]);
  const embeddedRuntimeHostIdentitySettling = useMemo(() => {
    if (runtimeTargetModeValue !== 'embedded' || !runtimeServiceStatus?.running) {
      return false;
    }
    const startedAtMs = runtimeServiceStatus.startedAt
      ? Date.parse(runtimeServiceStatus.startedAt)
      : Number.NaN;
    if (!Number.isFinite(startedAtMs)) {
      return false;
    }
    return Date.now() - startedAtMs < 20_000;
  }, [
    embeddedRuntimeHostIdentitySettlingTick,
    runtimeServiceStatus?.running,
    runtimeServiceStatus?.startedAt,
    runtimeTargetModeValue,
  ]);

  /** Resolve the first available RT base URL from runtime host snapshots. */
  const resolveRtBaseUrl = (): string => {
    if (embeddedRuntimeHost) {
      return resolveRuntimeHostBaseUrl(embeddedRuntimeHost);
    }
    const host = activeSignalRouteHost ?? sortRouteHostsByPriority(runtimeHostSnapshots).find((s) => s.host)?.host;
    if (host) return resolveRuntimeHostBaseUrl(host);
    const target = getSelectedRuntimeTarget();
    return `http://${formatHostForUrl(target.host)}:${target.port}`;
  };

  const resolveRuntimeHostAuthToken = (
    host?: Pick<RuntimeHostRecord, 'id' | 'name' | 'host' | 'port' | 'authToken'> | null,
  ): string | undefined => {
    if (host?.authToken) {
      return host.authToken;
    }

    const selectedTarget = getSelectedRuntimeTarget();
    const matchesSelectedTarget = Boolean(
      host
      && resolveLocalServiceHost(host.host) === resolveLocalServiceHost(selectedTarget.host)
      && host.port === selectedTarget.port,
    );
    if (!host) {
      return selectedTarget.authToken || undefined;
    }

    if (selectedTarget.authToken && matchesSelectedTarget) {
      return selectedTarget.authToken;
    }

    const isLikelyRemoteHost = !['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]'].includes(host.host);
    if (isLikelyRemoteHost && selectedTarget.mode === 'external' && selectedTarget.authToken) {
      const warningKey = [
        host.id ?? formatRuntimeTargetAddress(host),
        selectedTarget.mode,
        formatRuntimeTargetAddress(selectedTarget),
        selectedTarget.authToken ? 'selected-with-token' : 'selected-without-token',
      ].join('|');
      if (!missingRuntimeAuthWarningKeysRef.current.has(warningKey)) {
        missingRuntimeAuthWarningKeysRef.current.add(warningKey);
        console.warn('[agent-hub][auth] unresolved runtime host auth token', {
          hostId: host.id,
          hostName: host.name,
          hostAddress: formatRuntimeTargetAddress(host),
          selectedTargetMode: selectedTarget.mode,
          selectedTargetAddress: formatRuntimeTargetAddress(selectedTarget),
          selectedTargetAuthTokenPresent: Boolean(selectedTarget.authToken),
          matchedSelectedTarget: matchesSelectedTarget,
        });
      }
    }

    return undefined;
  };

  /** Resolve the auth token for the currently active RT host. */
  const resolveRtAuthToken = (): string | undefined => {
    if (embeddedRuntimeHost) {
      return resolveRuntimeHostAuthToken(embeddedRuntimeHost);
    }
    const activeHost = activeSignalRouteHost ?? sortRouteHostsByPriority(runtimeHostSnapshots).find((s) => s.host)?.host;
    return resolveRuntimeHostAuthToken(activeHost);
  };

  const resolveActiveRuntimeHost = (): RuntimeHostRecord => {
    if (embeddedRuntimeHost) {
      return embeddedRuntimeHost;
    }
    const directHost = activeSignalRouteHost
      ?? sortRouteHostsByPriority(runtimeHostSnapshots).find((snapshot) => snapshot.host)?.host;
    if (directHost) return directHost;

    const selectedTarget = getSelectedRuntimeTarget();
    return createDirectRuntimeHost(selectedTarget.host, selectedTarget.port, selectedTarget.authToken);
  };

  const resolveRuntimeHostBySourceHostId = (sourceHostId?: string | null): RuntimeHostRecord | null => {
    if (!sourceHostId) return null;
    if (embeddedRuntimeHost?.hostId && embeddedRuntimeHost.hostId === sourceHostId) {
      return embeddedRuntimeHost;
    }
    const matchedHost = runtimeHostSnapshots.find((snapshot) => (
      snapshot.host.hostId === sourceHostId
      || snapshot.host.id === sourceHostId
      || snapshot.topology?.host_id === sourceHostId
    ))?.host;
    return matchedHost ?? null;
  };

  const resolveRuntimeSnapshotPeerId = (snapshot: RuntimeHostSnapshot): string | undefined => (
    snapshot.topology?.host_id ?? snapshot.host.hostId
  );

  const toLiveRuntimePeerHost = (snapshot: RuntimeHostSnapshot): RuntimeHostRecord => {
    const livePeerId = resolveRuntimeSnapshotPeerId(snapshot);
    if (!livePeerId || livePeerId === snapshot.host.hostId) {
      return snapshot.host;
    }

    return {
      ...snapshot.host,
      hostId: livePeerId,
    };
  };

  const resolveRuntimeHostForSession = (session: SessionInfo): RuntimeHostRecord => {
    const matchedHost = resolveRuntimeHostBySourceHostId(session.source_host_id);
    if (matchedHost) return matchedHost;
    return resolveActiveRuntimeHost();
  };

  const resolveRuntimeConnectionForSession = (session: SessionInfo) => {
    const host = resolveRuntimeHostForSession(session);
    return {
      rtBaseUrl: resolveRuntimeHostBaseUrl(host),
      authToken: resolveRuntimeHostAuthToken(host),
    };
  };

  const resolveRuntimeConnectionForHostId = (hostId?: string | null) => {
    const matchedHost = resolveRuntimeHostBySourceHostId(hostId);
    if (matchedHost) {
      return {
        rtBaseUrl: resolveRuntimeHostBaseUrl(matchedHost),
        authToken: resolveRuntimeHostAuthToken(matchedHost),
      };
    }
    return {
      rtBaseUrl: resolveRtBaseUrl(),
      authToken: resolveRtAuthToken(),
    };
  };
  const ptySpawnConnection = useMemo(() => {
    return resolvePtySpawnConnectionTarget({
      runtimeHostSnapshots,
      selectedTarget: getSelectedRuntimeTarget(),
      runtimeServiceStatus,
    });
  }, [runtimeHostSnapshots, runtimeServiceStatus]);

  const sessionStreamTargets = useMemo(() => {
    if (embeddedRuntimeHost) {
      return [{
        id: embeddedRuntimeHost.hostId ?? embeddedRuntimeHost.id,
        rtBaseUrl: resolveRuntimeHostBaseUrl(embeddedRuntimeHost),
        authToken: resolveRuntimeHostAuthToken(embeddedRuntimeHost),
        hostName: embeddedRuntimeHost.name,
        hostAddress: resolveRuntimeHostDialAddress(embeddedRuntimeHost),
      }];
    }

    const sortedHosts = sortRouteHostsByPriority(
      runtimeHostSnapshots.filter((snapshot) => shouldAutoPollRuntimeHost(snapshot.host)),
    );
    if (sortedHosts.length > 0) {
      return sortedHosts.map((snapshot) => ({
        id: resolveRuntimeSnapshotPeerId(snapshot) ?? snapshot.host.id,
        rtBaseUrl: resolveRuntimeHostBaseUrl(snapshot.host),
        authToken: resolveRuntimeHostAuthToken(snapshot.host),
        hostName: snapshot.host.name,
        hostAddress: resolveRuntimeHostDialAddress(snapshot.host),
      }));
    }

    const host = resolveActiveRuntimeHost();
      return [{
        id: host.id,
        rtBaseUrl: resolveRuntimeHostBaseUrl(host),
        authToken: resolveRuntimeHostAuthToken(host),
        hostName: host.name,
        hostAddress: resolveRuntimeHostDialAddress(host),
      }];
  }, [activeSignalRouteHost, embeddedRuntimeHost, runtimeHostSnapshots, runtimeServiceStatus]);
  const runtimeHostService = useMemo(() => getRuntimeHostService(), []);
  const localLinkProofHost = useMemo(() => {
    if (!runtimeServiceStatus?.running) {
      return null;
    }

    const localHost = runtimeServiceStatus.host === '0.0.0.0'
      ? '127.0.0.1'
      : runtimeServiceStatus.host;

    return {
      id: 'runtime-host-local-link-proof',
      name: `Local Runtime (${localHost}:${runtimeServiceStatus.port})`,
      host: localHost,
      port: runtimeServiceStatus.port,
      status: 'online',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      isLocal: true,
      hostId: runtimeServiceStatus.hostId,
      trustState: 'manual_seed' as const,
    } satisfies RuntimeHostRecord;
  }, [
    runtimeServiceStatus?.running,
    runtimeServiceStatus?.host,
    runtimeServiceStatus?.port,
    runtimeServiceStatus?.hostId,
  ]);
  const localLinkProofSignalService = useMemo(() => (
    localLinkProofHost
      ? new SignalStreamService({ host: localLinkProofHost })
      : null
  ), [localLinkProofHost]);
  const runtimeLinkProofService = useMemo(() => (
    localLinkProofSignalService
      ? createRuntimeLinkProofService({
          signalService: localLinkProofSignalService,
          hostService: runtimeHostService,
        })
      : null
  ), [localLinkProofSignalService, runtimeHostService]);

  const syncLocalMeshHosts = async (status: RuntimeServiceStatus | null) => {
    if (!status?.running) {
      confirmedMeshReplayKeyRef.current.clear();
      return;
    }

    const localHost = status.host === '0.0.0.0' ? '127.0.0.1' : status.host;
    const runtimeBaseUrl = `http://${formatHostForUrl(localHost)}:${status.port}`;
    await getRuntimeMeshHostSyncService().syncLocalRuntimeMeshState(
      runtimeBaseUrl,
    );
  };

  const replayConfirmedMeshPeers = async (
    status: RuntimeServiceStatus | null,
    snapshot: { hosts: RuntimeHostSnapshot[] },
  ) => {
    if (!status?.running) {
      confirmedMeshReplayKeyRef.current.clear();
      return;
    }

    const confirmedHosts = snapshot.hosts
      .filter((item) => item.host.trustState === 'confirmed_peer')
      .map((item) => toLiveRuntimePeerHost(item))
      .filter((host) => host.hostId);

    for (const host of confirmedHosts) {
      const replayKey = [
        status.hostId ?? 'local',
        status.port,
        host.hostId,
        resolveRuntimeHostDialAddress(host),
      ].join('|');

      if (confirmedMeshReplayKeyRef.current.has(replayKey)) {
        continue;
      }

      try {
        await getRuntimeMeshSyncService().ensurePeerPair(host);
        confirmedMeshReplayKeyRef.current.add(replayKey);
      } catch {
        // Mesh replay is best-effort（运行时 peer 回放失败不阻塞页面刷新）.
      }
    }
  };

  const peerPairingRuntimeBaseUrl = useMemo(() => {
    const host = runtimeServiceStatus?.host === '0.0.0.0'
      ? '127.0.0.1'
      : runtimeServiceStatus?.host ?? '127.0.0.1';
    const port = runtimeServiceStatus?.port ?? DEFAULT_EMBEDDED_RUNTIME_PORT;
    return `http://${formatHostForUrl(host)}:${port}`;
  }, [runtimeServiceStatus]);

  const peerPairingLocalHostId = runtimeServiceStatus?.hostId ?? 'local';
  const peerPairingLocalAuthToken = undefined;
  const peerPairingKnownHosts = useMemo(
    () => runtimeHostSnapshots
      .filter((snapshot) => (
        snapshot.connectionState === 'online'
        && !!resolveRuntimeSnapshotPeerId(snapshot)
        && resolveRuntimeSnapshotPeerId(snapshot) !== peerPairingLocalHostId
      ))
      .map((snapshot) => toLiveRuntimePeerHost(snapshot)),
    [runtimeHostSnapshots, peerPairingLocalHostId],
  );

  const {
    sessions: liveSessions,
    loading: sessionLoading,
    error: sessionError,
    refresh: refreshSessions,
  } = useSessionStream({
    rtBaseUrl: null,
    targets: sessionStreamTargets,
    enabled: !useMockData,
  });

  const dashboardSessions = useMemo(
    () => (useMockData ? MOCK_SESSIONS : liveSessions),
    [liveSessions, useMockData],
  );
  const tiledSessionById = useMemo(
    () => new Map(dashboardSessions.map((session) => [session.id, session])),
    [dashboardSessions],
  );
  const activeTiledSessions = useMemo(
    () => dashboardSessions.filter(
      (session) => session.status !== 'completed' && session.status !== 'archived',
    ),
    [dashboardSessions],
  );
  const tiledAssignedSessionIds = useMemo(
    () => new Set(
      tiledPaneSlots.flatMap((slot) => (slot.sessionId ? [slot.sessionId] : [])),
    ),
    [tiledPaneSlots],
  );
  const tiledUnassignedSessions = useMemo(() => {
    const orderedSessionIds = [...tiledUnassignedSessionIds, ...activeTiledSessions.map((session) => session.id)];
    const seen = new Set<string>();

    return orderedSessionIds.flatMap((sessionId) => {
      if (seen.has(sessionId) || tiledAssignedSessionIds.has(sessionId)) {
        return [];
      }
      seen.add(sessionId);
      const session = tiledSessionById.get(sessionId);
      return session ? [session] : [];
    });
  }, [
    activeTiledSessions,
    tiledAssignedSessionIds,
    tiledSessionById,
    tiledUnassignedSessionIds,
  ]);
  const focusedTiledPtyTarget = useMemo(() => {
    if (!tiledFocusedSlotId) {
      return null;
    }

    const sessionId = tiledPaneSlots.find((slot) => slot.slotId === tiledFocusedSlotId)?.sessionId;
    if (!sessionId) {
      return null;
    }

    const session = tiledSessionById.get(sessionId);
    if (
      !session?.pty_id
      || session.interaction_mode !== 'terminal'
      || session.status === 'completed'
      || session.status === 'archived'
    ) {
      return null;
    }

    const connection = resolveRuntimeConnectionForSession(session);
    return {
      ...connection,
      ptyId: session.pty_id,
    };
  }, [
    tiledFocusedSlotId,
    tiledPaneSlots,
    tiledSessionById,
    resolveRuntimeConnectionForSession,
  ]);
  useEffect(() => {
    setTiledActiveLayoutNameDraft(tiledActiveLayoutRecord?.name ?? '默认布局');
  }, [tiledActiveLayoutRecord?.name]);
  const boundHistoricalSessionIds = useMemo(
    () => dashboardSessions.flatMap((session) => {
      const sessionId = session.inner_session_id?.trim();
      return sessionId ? [sessionId] : [];
    }),
    [dashboardSessions],
  );
  const getPreferredHistoricalBindingSessionIds = useCallback((session: SessionInfo): string[] => {
    const sessionProjectPathKey = resolveRecoverableTerminalProjectPathKey(session);
    if (!sessionProjectPathKey) {
      return [];
    }

    return Array.from(new Set(
      dashboardSessions
        .filter((candidate) => (
          candidate.id !== session.id
          && candidate.interaction_mode === 'terminal'
          && candidate.agent_kind === session.agent_kind
          && resolveRecoverableTerminalProjectPathKey(candidate) === sessionProjectPathKey
        ))
        .sort((left, right) => {
          const wallClockDiff = parseSessionWallClockMs(right) - parseSessionWallClockMs(left);
          if (wallClockDiff !== 0) {
            return wallClockDiff;
          }

          return right.id.localeCompare(left.id);
        })
        .flatMap((candidate) => {
          const historicalSessionId = candidate.inner_session_id?.trim();
          return historicalSessionId ? [historicalSessionId] : [];
        }),
    ));
  }, [dashboardSessions]);
  const appendTiledUnassignedSessionIds = useCallback((sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      return;
    }
    setTiledUnassignedSessionIds((prev) => {
      const next = [...prev];
      sessionIds.forEach((sessionId) => {
        if (!sessionId || next.includes(sessionId)) {
          return;
        }
        next.push(sessionId);
      });
      return next.join('\u0000') === prev.join('\u0000') ? prev : next;
    });
  }, []);
  const bindSessionToTiledSlot = useCallback((slotId: string, sessionId: string) => {
    const displacedSessionId = tiledPaneSlots.find((slot) => slot.slotId === slotId)?.sessionId ?? null;
    const session = tiledSessionById.get(sessionId);
    const recoverySnapshot = session ? buildRecoverableTerminalSessionSnapshot(session) : null;

    setTiledPaneSlots((prev) => bindSessionToTiledPaneSlot(
      tiledPaneTree,
      prev,
      slotId,
      sessionId,
      recoverySnapshot ?? undefined,
    ));
    setTiledFocusedSlotId(slotId);
    setTiledUnassignedSessionIds((prev) => prev.filter((id) => id !== sessionId));
    if (
      displacedSessionId
      && displacedSessionId !== sessionId
      && activeTiledSessions.some((candidate) => candidate.id === displacedSessionId)
    ) {
      appendTiledUnassignedSessionIds([displacedSessionId]);
    }
  }, [
    activeTiledSessions,
    appendTiledUnassignedSessionIds,
    tiledPaneSlots,
    tiledPaneTree,
    tiledSessionById,
  ]);
  const applySessionToNamedTiledWorkbenchLayout = useCallback(({
    sessionId,
    slotId,
    layoutId,
  }: {
    sessionId: string;
    slotId?: string | null;
    layoutId?: string | null;
  }) => {
    const targetLayoutId = layoutId ?? tiledActiveLayoutId;
    if (targetLayoutId === tiledActiveLayoutId) {
      if (slotId && !tiledSlotIds.includes(slotId)) {
        appendTiledUnassignedSessionIds([sessionId]);
        return;
      }

      const nextSnapshot = applySessionToTiledLayoutSnapshot({
        snapshot: buildCurrentTiledLayoutSnapshot(),
        sessions: dashboardSessions,
        sessionId,
        ...(slotId ? { slotId } : {}),
      });
      applyTiledLayoutSnapshot(nextSnapshot);
      return;
    }

    const targetLayout = tiledWorkbenchLayouts[targetLayoutId];
    if (!targetLayout) {
      appendTiledUnassignedSessionIds([sessionId]);
      return;
    }

    const now = new Date().toISOString();
    setTiledWorkbenchLayouts((prev) => {
      const currentLayout = prev[targetLayoutId];
      if (!currentLayout) {
        return prev;
      }

      return {
        ...prev,
        [targetLayoutId]: {
          ...currentLayout,
          snapshot: applySessionToTiledLayoutSnapshot({
            snapshot: currentLayout.snapshot,
            sessions: dashboardSessions,
            sessionId,
            ...(slotId ? { slotId } : {}),
          }),
          updatedAt: now,
        },
      };
    });
  }, [
    appendTiledUnassignedSessionIds,
    applyTiledLayoutSnapshot,
    buildCurrentTiledLayoutSnapshot,
    dashboardSessions,
    tiledActiveLayoutId,
    tiledSlotIds,
    tiledWorkbenchLayouts,
  ]);
  const clearTiledSlot = useCallback((slotId: string) => {
    const currentSlot = tiledPaneSlots.find((slot) => slot.slotId === slotId);
    if (!currentSlot) {
      return;
    }

    setTiledPaneSlots((prev) => clearTiledPaneSlotBinding(tiledPaneTree, prev, slotId));

    if (
      currentSlot.sessionId
      && activeTiledSessions.some((session) => session.id === currentSlot.sessionId)
    ) {
      appendTiledUnassignedSessionIds([currentSlot.sessionId]);
    }
  }, [
    activeTiledSessions,
    appendTiledUnassignedSessionIds,
    tiledPaneSlots,
    tiledPaneTree,
  ]);
  const closeTiledSlot = useCallback((slotId: string) => {
    if (tiledSlotIds.length <= 1) {
      clearTiledSlot(slotId);
      return;
    }

    const currentSlot = tiledPaneSlots.find((slot) => slot.slotId === slotId);
    const nextTree = removeTiledPaneTreeSlot(tiledPaneTree, slotId);
    const nextSlotIds = flattenTiledPaneTreeSlotIds(nextTree);

    setTiledPaneTree(nextTree);
    setTiledPaneSlots((prev) => prev.filter(
      (slot) => slot.slotId !== slotId && nextSlotIds.includes(slot.slotId),
    ));
    setTiledFocusedSlotId((prev) => (
      prev && nextSlotIds.includes(prev) ? prev : nextSlotIds[0] ?? null
    ));

    if (
      currentSlot?.sessionId
      && activeTiledSessions.some((session) => session.id === currentSlot.sessionId)
    ) {
      appendTiledUnassignedSessionIds([currentSlot.sessionId]);
    }
  }, [
    activeTiledSessions,
    appendTiledUnassignedSessionIds,
    clearTiledSlot,
    tiledPaneSlots,
    tiledPaneTree,
    tiledSlotIds.length,
  ]);
  const splitTiledSlot = useCallback((slotId: string, axis: TiledPaneSplitAxis) => {
    const result = splitTiledPaneTreeSlot(tiledPaneTree, slotId, axis);
    if (!result) {
      return;
    }

    setTiledPaneTree(result.tree);
    setTiledPaneSlots((prev) => {
      const next = prev.filter((slot) => slot.slotId !== result.newSlotId);
      next.push({ slotId: result.newSlotId });
      return next;
    });
    setTiledFocusedSlotId(result.newSlotId);
  }, [tiledPaneTree]);
  const resizeTiledSplit = useCallback((path: number[], ratio: number) => {
    setTiledPaneTree((prev) => updateTiledPaneTreeSplitRatio(prev, path, ratio));
  }, []);
  const openPtySpawnDialogForSlot = useCallback((slotId: string | null) => {
    setPtySpawnTargetSlotId(slotId);
    setPtySpawnTargetLayoutId(viewMode === 'tiled' ? tiledActiveLayoutId : null);
    setShowPtySpawnDialog(true);
    if (slotId) {
      setTiledFocusedSlotId(slotId);
    }
  }, [tiledActiveLayoutId, viewMode]);
  const commitActiveTiledLayoutName = useCallback((rawName: string) => {
    const normalizedName = rawName.trim() || tiledActiveLayoutRecord?.name || '默认布局';
    setTiledActiveLayoutNameDraft(normalizedName);

    if (!tiledActiveLayoutRecord || tiledActiveLayoutRecord.name === normalizedName) {
      return normalizedName;
    }

    const now = new Date().toISOString();
    setTiledWorkbenchLayouts((prev) => ({
      ...prev,
      [tiledActiveLayoutRecord.id]: {
        ...tiledActiveLayoutRecord,
        name: normalizedName,
        updatedAt: now,
      },
    }));
    return normalizedName;
  }, [tiledActiveLayoutRecord]);
  const switchTiledWorkbenchLayout = useCallback((nextLayoutId: string) => {
    if (!nextLayoutId || nextLayoutId === tiledActiveLayoutId) {
      return;
    }

    const nextLayout = tiledWorkbenchLayouts[nextLayoutId];
    if (!nextLayout) {
      return;
    }

    const currentSnapshot = buildCurrentTiledLayoutSnapshot();
    const currentLayoutName = commitActiveTiledLayoutName(tiledActiveLayoutNameDraft);
    const nextSnapshot = cloneTiledLayoutPersistSnapshot(nextLayout.snapshot);
    const now = new Date().toISOString();

    setTiledWorkbenchLayouts((prev) => {
      const currentLayout = prev[tiledActiveLayoutId];
      return {
        ...prev,
        ...(currentLayout ? {
          [tiledActiveLayoutId]: {
            ...currentLayout,
            name: currentLayoutName,
            snapshot: currentSnapshot,
            updatedAt: now,
          },
        } : {}),
        [nextLayoutId]: {
          ...nextLayout,
          lastUsedAt: now,
        },
      };
    });
    setTiledActiveLayoutId(nextLayoutId);
    applyTiledLayoutSnapshot(nextSnapshot);
  }, [
    applyTiledLayoutSnapshot,
    buildCurrentTiledLayoutSnapshot,
    commitActiveTiledLayoutName,
    tiledActiveLayoutId,
    tiledActiveLayoutNameDraft,
    tiledWorkbenchLayouts,
  ]);
  const createEmptyTiledWorkbenchLayout = useCallback(() => {
    const currentSnapshot = buildCurrentTiledLayoutSnapshot();
    const currentLayoutName = commitActiveTiledLayoutName(tiledActiveLayoutNameDraft);
    const nextSnapshot = createEmptyTiledLayoutPersistSnapshot(
      tiledLayout,
      activeTiledSessions.map((session) => session.id),
    );
    const nextLayout = createTiledWorkbenchLayoutRecord(nextSnapshot, {
      name: buildNextTiledWorkbenchLayoutName(tiledWorkbenchLayouts),
    });
    const now = nextLayout.createdAt;

    setTiledWorkbenchLayouts((prev) => ({
      ...prev,
      ...(tiledActiveLayoutRecord ? {
        [tiledActiveLayoutRecord.id]: {
          ...tiledActiveLayoutRecord,
          name: currentLayoutName,
          snapshot: currentSnapshot,
          updatedAt: now,
        },
      } : {}),
      [nextLayout.id]: nextLayout,
    }));
    setTiledWorkbenchLayoutOrder((prev) => [...prev, nextLayout.id]);
    setTiledActiveLayoutId(nextLayout.id);
    applyTiledLayoutSnapshot(nextLayout.snapshot);
    setTiledActiveLayoutNameDraft(nextLayout.name);
  }, [
    activeTiledSessions,
    applyTiledLayoutSnapshot,
    buildCurrentTiledLayoutSnapshot,
    commitActiveTiledLayoutName,
    tiledActiveLayoutNameDraft,
    tiledActiveLayoutRecord,
    tiledLayout,
    tiledWorkbenchLayouts,
  ]);
  const duplicateActiveTiledWorkbenchLayout = useCallback(() => {
    const currentSnapshot = cloneTiledLayoutPersistSnapshot(buildCurrentTiledLayoutSnapshot());
    const currentLayoutName = commitActiveTiledLayoutName(tiledActiveLayoutNameDraft);
    const nextLayout = createTiledWorkbenchLayoutRecord(currentSnapshot, {
      name: buildNextTiledWorkbenchLayoutName(
        tiledWorkbenchLayouts,
        `${currentLayoutName} 副本`,
      ),
    });
    const now = nextLayout.createdAt;

    setTiledWorkbenchLayouts((prev) => ({
      ...prev,
      ...(tiledActiveLayoutRecord ? {
        [tiledActiveLayoutRecord.id]: {
          ...tiledActiveLayoutRecord,
          name: currentLayoutName,
          snapshot: currentSnapshot,
          updatedAt: now,
        },
      } : {}),
      [nextLayout.id]: nextLayout,
    }));
    setTiledWorkbenchLayoutOrder((prev) => [...prev, nextLayout.id]);
    setTiledActiveLayoutId(nextLayout.id);
    applyTiledLayoutSnapshot(nextLayout.snapshot);
    setTiledActiveLayoutNameDraft(nextLayout.name);
  }, [
    applyTiledLayoutSnapshot,
    buildCurrentTiledLayoutSnapshot,
    commitActiveTiledLayoutName,
    tiledActiveLayoutNameDraft,
    tiledActiveLayoutRecord,
    tiledWorkbenchLayouts,
  ]);
  const deleteActiveTiledWorkbenchLayout = useCallback(() => {
    if (tiledWorkbenchLayoutOrder.length <= 1) {
      return;
    }

    const currentIndex = tiledWorkbenchLayoutOrder.indexOf(tiledActiveLayoutId);
    const fallbackLayoutId = tiledWorkbenchLayoutOrder[currentIndex - 1]
      ?? tiledWorkbenchLayoutOrder[currentIndex + 1]
      ?? null;
    if (!fallbackLayoutId) {
      return;
    }

    const fallbackLayout = tiledWorkbenchLayouts[fallbackLayoutId];
    if (!fallbackLayout) {
      return;
    }

    const nextSnapshot = cloneTiledLayoutPersistSnapshot(fallbackLayout.snapshot);
    const now = new Date().toISOString();

    setTiledWorkbenchLayouts((prev) => {
      const nextLayouts = { ...prev };
      delete nextLayouts[tiledActiveLayoutId];
      if (nextLayouts[fallbackLayoutId]) {
        nextLayouts[fallbackLayoutId] = {
          ...nextLayouts[fallbackLayoutId]!,
          lastUsedAt: now,
        };
      }
      return nextLayouts;
    });
    setTiledWorkbenchLayoutOrder((prev) => prev.filter((layoutId) => layoutId !== tiledActiveLayoutId));
    setTiledActiveLayoutId(fallbackLayoutId);
    applyTiledLayoutSnapshot(nextSnapshot);
    setTiledActiveLayoutNameDraft(fallbackLayout.name);
  }, [
    applyTiledLayoutSnapshot,
    tiledActiveLayoutId,
    tiledWorkbenchLayoutOrder,
    tiledWorkbenchLayouts,
  ]);
  const tiledWorkbenchKeyboardSuspended = showPtySpawnDialog
    || sheetOpen
    || hostManagerOpen
    || agentCreateOpen
    || peerPairingOpen;

  useEffect(() => {
    if (
      tiledPassthroughArmed
      && (
        viewMode !== 'tiled'
        || !focusedTiledPtyTarget
        || tiledWorkbenchKeyboardSuspended
      )
    ) {
      setTiledPassthroughArmed(false);
    }
  }, [
    focusedTiledPtyTarget,
    tiledPassthroughArmed,
    tiledWorkbenchKeyboardSuspended,
    viewMode,
  ]);

  useTiledWorkbenchKeyboard({
    enabled: viewMode === 'tiled',
    suspended: tiledWorkbenchKeyboardSuspended,
    tree: tiledPaneTree,
    focusedSlotId: tiledFocusedSlotId,
    focusedPtyTarget: focusedTiledPtyTarget,
    passthroughArmed: tiledPassthroughArmed,
    onPassthroughArmedChange: setTiledPassthroughArmed,
    onFocusSlot: setTiledFocusedSlotId,
    onSplitSlot: splitTiledSlot,
    onClearSlot: clearTiledSlot,
    onCloseSlot: closeTiledSlot,
    onOpenSlotEntry: openPtySpawnDialogForSlot,
  });

  useEffect(() => {
    const currentSnapshot = buildCurrentTiledLayoutSnapshot();
    const now = new Date().toISOString();
    const persistedLayouts = tiledActiveLayoutRecord
      ? {
          ...tiledWorkbenchLayouts,
          [tiledActiveLayoutRecord.id]: {
            ...tiledActiveLayoutRecord,
            snapshot: currentSnapshot,
            updatedAt: now,
          },
        }
      : tiledWorkbenchLayouts;

    writeAgentsTiledWorkbenchPersistState({
      version: 3,
      activeLayoutId: tiledActiveLayoutId,
      layoutOrder: tiledWorkbenchLayoutOrder,
      layouts: persistedLayouts,
      ...(activePtyId ? { fullscreenPtyId: activePtyId } : {}),
      ...(activePtyId && fullscreenTerminalRecovery ? { fullscreenTerminalRecovery } : {}),
    });
  }, [
    activePtyId,
    buildCurrentTiledLayoutSnapshot,
    fullscreenTerminalRecovery,
    tiledActiveLayoutId,
    tiledActiveLayoutRecord,
    tiledWorkbenchLayoutOrder,
    tiledWorkbenchLayouts,
  ]);

  useEffect(() => {
    if (sessionLoading) {
      return;
    }

    const visibleTiledSessionIds = new Set(activeTiledSessions.map((session) => session.id));

    setTiledPaneSlots((prev) => {
      const next = prev
        .filter((slot) => tiledSlotIds.includes(slot.slotId))
        .map((slot) => {
          const session = slot.sessionId ? tiledSessionById.get(slot.sessionId) ?? null : null;
          const recoverySnapshot = session
            ? buildRecoverableTerminalSessionSnapshot(session) ?? slot.terminalRecovery
            : slot.terminalRecovery;

          if (slot.sessionId && !visibleTiledSessionIds.has(slot.sessionId)) {
            return {
              slotId: slot.slotId,
              ...(recoverySnapshot ? { terminalRecovery: recoverySnapshot } : {}),
            };
          }

          return {
            slotId: slot.slotId,
            ...(slot.sessionId ? { sessionId: slot.sessionId } : {}),
            ...(recoverySnapshot ? { terminalRecovery: recoverySnapshot } : {}),
          };
        });
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
    setTiledUnassignedSessionIds((prev) => {
      const next = prev.filter((id) => visibleTiledSessionIds.has(id));
      activeTiledSessions.forEach((session) => {
        if (!tiledAssignedSessionIds.has(session.id) && !next.includes(session.id)) {
          next.push(session.id);
        }
      });
      return next.join('\u0000') === prev.join('\u0000') ? prev : next;
    });
  }, [
    activeTiledSessions,
    sessionLoading,
    tiledAssignedSessionIds,
    tiledSessionById,
    tiledSlotIds,
  ]);

  useEffect(() => {
    if (pendingSpawnedPtyBindings.length === 0) {
      return;
    }

    const matchedPtyIds = new Set<string>();

    pendingSpawnedPtyBindings.forEach(({ ptyId, slotId, layoutId }) => {
      const matchingSession = dashboardSessions.find((session) => (
          session.pty_id === ptyId
          && session.status !== 'completed'
          && session.status !== 'archived'
        ));
      if (!matchingSession) {
        return;
      }

      matchedPtyIds.add(ptyId);
      applySessionToNamedTiledWorkbenchLayout({
        sessionId: matchingSession.id,
        ...(slotId ? { slotId } : {}),
        ...(layoutId ? { layoutId } : {}),
      });
    });

    if (matchedPtyIds.size === 0) {
      return;
    }

    setPendingSpawnedPtyBindings((prev) => prev.filter(({ ptyId }) => !matchedPtyIds.has(ptyId)));
  }, [
    applySessionToNamedTiledWorkbenchLayout,
    dashboardSessions,
    pendingSpawnedPtyBindings,
  ]);

  const matchingActivePty = useMemo(
    () => ptyAgents.find((pty) => pty.id === activePtyId) ?? null,
    [activePtyId, ptyAgents],
  );

  useEffect(() => {
    if (!activePtyId || activePtyHostId) return;

    if (matchingActivePty?.sourceHostId) {
      setActivePtyHostId(matchingActivePty.sourceHostId);
      return;
    }

    const matchingSession = dashboardSessions.find((session) => session.pty_id === activePtyId);
    if (matchingSession?.source_host_id) {
      setActivePtyHostId(matchingSession.source_host_id);
    }
  }, [activePtyHostId, activePtyId, dashboardSessions, matchingActivePty]);

  useEffect(() => {
    if (useMockData) {
      return;
    }

    let cancelled = false;
    const pendingSessions = dashboardSessions.filter(isTerminalSessionPendingHistoricalBinding);
    if (pendingSessions.length === 0) {
      return;
    }

    pendingSessions.forEach((session) => {
      const workdir = resolveTerminalSessionWorkdir(session);
      if (!workdir) {
        return;
      }
      const preferredBaselineSessionIds = getPreferredHistoricalBindingSessionIds(session);

      const host = resolveRuntimeHostForSession(session);
      void detectAndPersistHistoricalSessionId({
        rtBaseUrl: resolveRuntimeHostBaseUrl(host),
        authToken: host.authToken,
        sessionRecordId: session.id,
        agentType: session.agent_kind === 'claude' ? 'claude' : 'codex',
        baselineSessionIds: boundHistoricalSessionIds,
        preferredBaselineSessionIds,
        allowImmediatePreferredBaselineMatch: true,
        expectedWorkdir: workdir,
        startedAtMs: Date.parse(session.created_at),
      }).then((detectedSessionId) => {
        if (!detectedSessionId || cancelled) {
          return;
        }
        refreshSessions();
      }).catch((error) => {
        console.warn('[agent-hub][pty] failed to backfill terminal inner session id', {
          sessionId: session.id,
          ptyId: session.pty_id ?? null,
          agentType: session.agent_kind,
          workdir,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });

    return () => {
      cancelled = true;
    };
  }, [boundHistoricalSessionIds, dashboardSessions, getPreferredHistoricalBindingSessionIds, refreshSessions, useMockData]);

  const resolvedActivePtyHostId = useMemo(
    () => (
      activePtyHostId
      ?? matchingActivePty?.sourceHostId
      ?? dashboardSessions.find((session) => session.pty_id === activePtyId)?.source_host_id
      ?? null
    ),
    [activePtyHostId, activePtyId, dashboardSessions, matchingActivePty],
  );
  const activePtySession = useMemo(
    () => (
      activePtyId
        ? findSessionForPty(activePtyId, dashboardSessions, {
            preferredSourceHostId: activePtyHostId ?? matchingActivePty?.sourceHostId ?? null,
          }) ?? null
        : null
    ),
    [activePtyHostId, activePtyId, dashboardSessions, matchingActivePty],
  );
  const activePtyTerminalKey = useMemo(
    () => (
      activePtyId
        ? `${activePtyId}:${resolvedActivePtyHostId ?? 'no-host'}:${activePtyTerminalNonce}`
        : null
    ),
    [activePtyId, activePtyTerminalNonce, resolvedActivePtyHostId],
  );
  const knownPtyIds = useMemo(
    () => new Set(
      ptyAgents
        .filter((pty) => pty.status === 'running')
        .map((pty) => pty.id),
    ),
    [ptyAgents],
  );
  const activePtyRecoverySnapshot = useMemo(
    () => (
      activePtySession
        ? buildRecoverableTerminalSessionSnapshot(activePtySession)
        : null
    ),
    [activePtySession],
  );
  useEffect(() => {
    if (!activePtyId) {
      setFullscreenTerminalRecovery((prev) => (prev ? null : prev));
      setPersistedFullscreenAutoResumeKey(null);
      return;
    }

    if (!activePtySession) {
      return;
    }

    if (!activePtyRecoverySnapshot) {
      setFullscreenTerminalRecovery((prev) => (prev ? null : prev));
      return;
    }

    setFullscreenTerminalRecovery((prev) => (
      areRecoverableTerminalSessionSnapshotsEqual(prev, activePtyRecoverySnapshot)
        ? prev ?? null
        : activePtyRecoverySnapshot
    ));
  }, [activePtyId, activePtyRecoverySnapshot, activePtySession]);
  const fullscreenTerminalRecoveryKey = useMemo(
    () => (
      fullscreenTerminalRecovery
        ? getRecoverableTerminalSessionSnapshotKey(fullscreenTerminalRecovery)
        : null
    ),
    [fullscreenTerminalRecovery],
  );
  const matchedFullscreenRecoverySession = useMemo(() => {
    if (!fullscreenTerminalRecovery) {
      return null;
    }

    return dashboardSessions
      .filter((session) => (
        isOpenRecoverableTerminalSession(session)
        && matchesRecoverableTerminalSessionSnapshot(session, fullscreenTerminalRecovery)
      ))
      .sort((left, right) => compareHistoricalSessionPriority(left, right, {
          activePtyId,
          knownPtyIds,
          tiledPaneOrder,
        }))[0] ?? null;
  }, [activePtyId, dashboardSessions, fullscreenTerminalRecovery, knownPtyIds, tiledPaneOrder]);
  const pendingPtyPresenceIds = useMemo(
    () => {
      const now = Date.now();
      return new Set(
        Object.entries(pendingPtyPresenceChecks)
          .filter(([, entry]) => isPendingPtyPresenceCheckActive(entry, now))
          .map(([ptyId]) => ptyId),
      );
    },
    [pendingPtyPresenceChecks],
  );
  const occupiedHistoricalSessions = useMemo(() => {
    const groupedSessions = new Map<string, SessionInfo[]>();

    dashboardSessions.forEach((session) => {
      const innerSessionId = session.inner_session_id?.trim();
      if (!innerSessionId || !isOpenRecoverableTerminalSession(session)) {
        return;
      }

      const existing = groupedSessions.get(innerSessionId);
      if (existing) {
        existing.push(session);
        return;
      }

      groupedSessions.set(innerSessionId, [session]);
    });

    const next = new Map<string, SessionInfo>();
    groupedSessions.forEach((sessions, innerSessionId) => {
      const canonicalSession = [...sessions].sort((left, right) => compareHistoricalSessionPriority(left, right, {
          activePtyId,
          knownPtyIds,
          tiledPaneOrder,
        }))[0];

      if (canonicalSession) {
        next.set(innerSessionId, canonicalSession);
      }
    });

    return next;
  }, [activePtyId, dashboardSessions, knownPtyIds, tiledPaneOrder]);
  const occupiedHistoricalSessionIds = useMemo(
    () => [...occupiedHistoricalSessions.keys()],
    [occupiedHistoricalSessions],
  );
  const occupiedHistoricalSessionLabels = useMemo(
    () => Object.fromEntries(
      [...occupiedHistoricalSessions.entries()].map(([innerSessionId, session]) => [
        innerSessionId,
        session.role?.trim() || session.pty_id || session.id,
      ]),
    ),
    [occupiedHistoricalSessions],
  );
  const resolveOccupiedHistoricalSession = useCallback(
    (historicalSessionId?: string | null) => {
      const normalizedHistoricalSessionId = historicalSessionId?.trim();
      if (!normalizedHistoricalSessionId) {
        return null;
      }

      return occupiedHistoricalSessions.get(normalizedHistoricalSessionId) ?? null;
    },
    [occupiedHistoricalSessions],
  );
  useEffect(() => {
    if (sessionLoading) {
      return;
    }

    const nextAutoBindings: Array<{
      slotId: string;
      sessionId: string;
      terminalRecovery: RecoverableTerminalSessionSnapshot;
    }> = [];
    const assignedSessionIds = new Set(
      tiledPaneSlots.flatMap((slot) => (slot.sessionId ? [slot.sessionId] : [])),
    );

    tiledPaneSlots.forEach((slot) => {
      const snapshot = slot.terminalRecovery;
      if (slot.sessionId || !snapshot) {
        return;
      }

      const matchedSession = resolveOccupiedHistoricalSession(snapshot.innerSessionId);
      if (
        !matchedSession
        || !matchesRecoverableTerminalSessionSnapshot(matchedSession, snapshot)
        || assignedSessionIds.has(matchedSession.id)
      ) {
        return;
      }

      const recoverySnapshot = buildRecoverableTerminalSessionSnapshot(matchedSession) ?? snapshot;
      assignedSessionIds.add(matchedSession.id);
      nextAutoBindings.push({
        slotId: slot.slotId,
        sessionId: matchedSession.id,
        terminalRecovery: recoverySnapshot,
      });
    });

    if (nextAutoBindings.length === 0) {
      return;
    }

    setTiledPaneSlots((prev) => {
      let next = prev;
      nextAutoBindings.forEach(({ slotId, sessionId, terminalRecovery }) => {
        next = bindSessionToTiledPaneSlot(
          tiledPaneTree,
          next,
          slotId,
          sessionId,
          terminalRecovery,
        );
      });
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
    setTiledUnassignedSessionIds((prev) => prev.filter(
      (id) => !nextAutoBindings.some((binding) => binding.sessionId === id),
    ));
  }, [
    resolveOccupiedHistoricalSession,
    sessionLoading,
    tiledPaneSlots,
    tiledPaneTree,
  ]);
  const isSourceHostAvailable = useCallback((sourceHostId?: string | null) => {
    if (!sourceHostId) {
      return false;
    }
    return resolveRuntimeHostBySourceHostId(sourceHostId) != null;
  }, [runtimeHostSnapshots]);
  const canJudgePtyPresenceForHost = useCallback((sourceHostId?: string | null) => {
    if (!hasLoadedPtyAgents) {
      return false;
    }
    if (!sourceHostId) {
      return true;
    }
    if (!isSourceHostAvailable(sourceHostId)) {
      return true;
    }
    if (!loadedPtyHostId) {
      return false;
    }
    return sourceHostId === loadedPtyHostId;
  }, [hasLoadedPtyAgents, isSourceHostAvailable, loadedPtyHostId]);
  const shouldDeferUnavailableSourceHostHandling = useCallback((
    session: SessionInfo,
    matchedHost: RuntimeHostRecord | null,
  ) => Boolean(
    session.source_host_id
    && !matchedHost
    && runtimeTargetModeValue === 'embedded'
    && (!runtimeServiceStatus?.running || embeddedRuntimeHostIdentitySettling)
  ), [
    embeddedRuntimeHostIdentitySettling,
    runtimeServiceStatus?.running,
    runtimeTargetModeValue,
  ]);
  const sessionUsesActiveEmbeddedRuntimeDialAddress = useCallback((session: SessionInfo) => {
    if (
      runtimeTargetModeValue !== 'embedded'
      || !runtimeServiceStatus?.running
      || !embeddedRuntimeHost
    ) {
      return false;
    }

    const activeHost = resolveLocalServiceHost(embeddedRuntimeHost.host);
    const activePort = embeddedRuntimeHost.port;
    const candidates = [session.source_host_address, session.source_host_name];

    return candidates.some((value) => {
      if (!value) {
        return false;
      }

      const dialAddress = resolveDialAddressFromBaseUrl(value) ?? value;
      try {
        const parsed = parseRuntimeAddress(dialAddress);
        return parsed.port === activePort && resolveLocalServiceHost(parsed.host) === activeHost;
      } catch {
        return false;
      }
    });
  }, [
    embeddedRuntimeHost,
    runtimeServiceStatus?.running,
    runtimeTargetModeValue,
  ]);
  const canFallbackToActiveRuntimeHostForSession = useCallback((session: SessionInfo) => {
    if (
      runtimeTargetModeValue !== 'embedded'
      || !runtimeServiceStatus?.running
      || !session.source_host_id
    ) {
      return false;
    }

    const matchedHost = resolveRuntimeHostBySourceHostId(session.source_host_id);
    if (!matchedHost) {
      return true;
    }

    if (!activeEmbeddedRuntimeHostId || !loadedPtyHostId || loadedPtyHostId !== activeEmbeddedRuntimeHostId) {
      return false;
    }

    const matchedHostId = matchedHost.hostId ?? matchedHost.id;
    if (matchedHostId === activeEmbeddedRuntimeHostId) {
      return false;
    }

    if (matchedHost.isLocal !== true) {
      return sessionUsesActiveEmbeddedRuntimeDialAddress(session);
    }

    return true;
  }, [
    activeEmbeddedRuntimeHostId,
    loadedPtyHostId,
    resolveRuntimeHostBySourceHostId,
    runtimeServiceStatus?.running,
    sessionUsesActiveEmbeddedRuntimeDialAddress,
    runtimeTargetModeValue,
  ]);
  const canJudgeSessionPtyPresence = useCallback((session: SessionInfo) => (
    canJudgePtyPresenceForHost(session.source_host_id)
    || canFallbackToActiveRuntimeHostForSession(session)
  ), [canFallbackToActiveRuntimeHostForSession, canJudgePtyPresenceForHost]);
  const isFreshTerminalSessionPresenceProtected = useCallback((session: SessionInfo) => {
    if (!session.pty_id) {
      return false;
    }
    if (failedPtyConnectionIds.includes(session.pty_id)) {
      return false;
    }
    if (pendingPtyPresenceIds.has(session.pty_id)) {
      return true;
    }
    return isFreshRunningTerminalSession(session);
  }, [failedPtyConnectionIds, pendingPtyPresenceIds]);
  const resolveTerminalSessionHostId = useCallback((session: SessionInfo) => (
    canFallbackToActiveRuntimeHostForSession(session)
      ? activeEmbeddedRuntimeHostId
      : session.source_host_id ?? null
  ), [activeEmbeddedRuntimeHostId, canFallbackToActiveRuntimeHostForSession]);
  const disconnectedSessionPtyIds = useMemo(() => {
    // A confirmed stream/liveness failure should override stale PTY cache entries
    // until the runtime positively reports that the PTY is still present.
    const disconnectedIds = new Set(failedPtyConnectionIds);
    if (!hasLoadedPtyAgents) {
      return disconnectedIds;
    }

    dashboardSessions.forEach((session) => {
      if (
        session.interaction_mode === 'terminal'
        && session.pty_id
      ) {
        if (!canJudgeSessionPtyPresence(session)) {
          return;
        }
        if (isFreshTerminalSessionPresenceProtected(session)) {
          return;
        }
        if (knownPtyIds.has(session.pty_id)) {
          return;
        }
        disconnectedIds.add(session.pty_id);
      }
    });

    return disconnectedIds;
  }, [
    canJudgeSessionPtyPresence,
    dashboardSessions,
    failedPtyConnectionIds,
    hasLoadedPtyAgents,
    isFreshTerminalSessionPresenceProtected,
    knownPtyIds,
  ]);
  const isSessionPtyDisconnected = useCallback(
    (session: SessionInfo) => !!session.pty_id && disconnectedSessionPtyIds.has(session.pty_id),
    [disconnectedSessionPtyIds],
  );

  const setSessionAutoResuming = useCallback((sessionId: string, isResuming: boolean) => {
    if (isResuming) {
      autoResumingSessionIdsRef.current.add(sessionId);
    } else {
      autoResumingSessionIdsRef.current.delete(sessionId);
    }

    setAutoResumingSessionIds(Array.from(autoResumingSessionIdsRef.current));
  }, []);
  const completeDisconnectedTerminalSession = useCallback(async (
    session: SessionInfo,
    reason: string,
  ) => {
    const completionSteps = buildTerminalSessionCompletionSteps(session.status);
    if (completionSteps.length === 0) {
      return session;
    }

    const host = resolveRuntimeHostForSession(session);
    const runtimeClient = new RuntimeClient();
    let currentSession = session;
    for (const step of completionSteps) {
      const result = await runtimeClient.updateSession(host, currentSession.id, step);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      currentSession = result.data;
    }

    console.warn('[agent-hub][pty] auto-completed disconnected terminal session', {
      sessionId: currentSession.id,
      ptyId: currentSession.pty_id ?? null,
      sourceHostId: currentSession.source_host_id ?? null,
      status: session.status,
      reason,
    });
    refreshSessions();
    return currentSession;
  }, [refreshSessions]);
  const completeSessionWithoutRuntimeControl = useCallback(async (
    session: SessionInfo,
    reason: string,
  ) => {
    const completionSteps = buildTerminalSessionCompletionSteps(session.status);
    if (completionSteps.length === 0) {
      return session;
    }

    const host = resolveRuntimeHostForSession(session);
    const runtimeClient = new RuntimeClient();
    let currentSession = session;
    for (const step of completionSteps) {
      const result = await runtimeClient.updateSession(host, currentSession.id, step);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      currentSession = result.data;
    }

    console.info('[agent-hub][session][resolve] completed session without runtime control', {
      sessionId: currentSession.id,
      interactionMode: currentSession.interaction_mode,
      ptyId: currentSession.pty_id ?? null,
      sourceHostId: currentSession.source_host_id ?? null,
      status: session.status,
      reason,
    });
    refreshSessions();
    return currentSession;
  }, [refreshSessions]);
  const handleResolveTerminalSession = useCallback(async (session: SessionInfo) => {
    if (isTerminalSessionResolutionPending(session)) {
      return;
    }

    if (session.pty_id) {
      setTerminalSessionResolutionPending(session.id, true);
      try {
        await handleStopPtyAgent(session.pty_id, session.source_host_id);
      } finally {
        setTerminalSessionResolutionPending(session.id, false);
      }
      return;
    }

    const targetLabel = session.role || session.inner_session_id || session.id;
    const resolveToast = toast({
      title: '正在结束 Terminal 会话',
      description: `会话：${targetLabel}`,
      duration: 5000,
    });
    setRuntimeHostError('');
    setTerminalSessionResolutionPending(session.id, true);
    console.info('[agent-hub][pty][resolve] completing active terminal session without PTY', {
      sessionId: session.id,
      sourceHostId: session.source_host_id ?? null,
      innerSessionId: session.inner_session_id ?? null,
      status: session.status,
    });

    try {
      const completedSession = await completeSessionWithoutRuntimeControl(
        session,
        'manual-missing-pty-resolution',
      );
      resolveToast.update({
        id: resolveToast.id,
        title: '已结束 Terminal 会话',
        description: `会话：${targetLabel}`,
        duration: 4000,
      });
      console.info('[agent-hub][pty][resolve] completed active terminal session without PTY', {
        sessionId: session.id,
        sourceHostId: session.source_host_id ?? null,
        innerSessionId: session.inner_session_id ?? null,
        nextStatus: completedSession.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureMessage = `结束 Terminal 会话失败: ${message}`;
      setRuntimeHostError(failureMessage);
      console.warn('[agent-hub][pty][resolve] failed to complete active terminal session without PTY', {
        sessionId: session.id,
        sourceHostId: session.source_host_id ?? null,
        innerSessionId: session.inner_session_id ?? null,
        status: session.status,
        message,
      });
      resolveToast.update({
        id: resolveToast.id,
        title: '结束 Terminal 会话失败',
        description: failureMessage,
        variant: 'destructive',
        duration: 6000,
      });
    } finally {
      setTerminalSessionResolutionPending(session.id, false);
    }
  }, [
    completeSessionWithoutRuntimeControl,
    handleStopPtyAgent,
    isTerminalSessionResolutionPending,
    setTerminalSessionResolutionPending,
  ]);
  const handleCloseSessionWithoutPty = useCallback(async (session: SessionInfo) => {
    if (isTerminalSessionResolutionPending(session)) {
      return;
    }

    const targetLabel = session.role || session.id;
    const closeToast = toast({
      title: '正在关闭会话',
      description: `会话：${targetLabel}`,
      duration: 5000,
    });
    setRuntimeHostError('');
    setTerminalSessionResolutionPending(session.id, true);
    console.info('[agent-hub][session][close] closing active session without PTY', {
      sessionId: session.id,
      interactionMode: session.interaction_mode,
      sourceHostId: session.source_host_id ?? null,
      status: session.status,
    });

    try {
      const completedSession = await completeSessionWithoutRuntimeControl(
        session,
        'manual-non-terminal-without-pty-close',
      );
      closeToast.update({
        id: closeToast.id,
        title: '已关闭会话',
        description: `会话：${targetLabel}`,
        duration: 4000,
      });
      console.info('[agent-hub][session][close] closed active session without PTY', {
        sessionId: session.id,
        interactionMode: session.interaction_mode,
        sourceHostId: session.source_host_id ?? null,
        nextStatus: completedSession.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureMessage = `关闭会话失败: ${message}`;
      setRuntimeHostError(failureMessage);
      console.warn('[agent-hub][session][close] failed to close active session without PTY', {
        sessionId: session.id,
        interactionMode: session.interaction_mode,
        sourceHostId: session.source_host_id ?? null,
        status: session.status,
        message,
      });
      closeToast.update({
        id: closeToast.id,
        title: '关闭会话失败',
        description: failureMessage,
        variant: 'destructive',
        duration: 6000,
      });
    } finally {
      setTerminalSessionResolutionPending(session.id, false);
    }
  }, [
    completeSessionWithoutRuntimeControl,
    isTerminalSessionResolutionPending,
    setTerminalSessionResolutionPending,
  ]);
  const retireSupersededTerminalSession = useCallback(async (session: SessionInfo) => {
    const retirementSteps = buildTerminalSessionRetirementSteps(session.status);
    if (retirementSteps.length === 0) {
      return;
    }

    const host = resolveRuntimeHostForSession(session);
    const runtimeClient = new RuntimeClient();
    for (const step of retirementSteps) {
      const result = await runtimeClient.updateSession(host, session.id, step);
      if (!result.ok) {
        if (result.error.status === 409 && step.status) {
          const latest = await runtimeClient.getSession(host, session.id);
          if (
            latest.ok
            && hasReachedTerminalSessionRetirementTarget(latest.data.status, step.status)
          ) {
            console.info(
              '[agent-hub][pty] superseded terminal session retirement step already satisfied after conflict',
              {
                sessionId: session.id,
                sourceHostId: session.source_host_id ?? null,
                requestedStatus: step.status,
                latestStatus: latest.data.status,
              },
            );
            continue;
          }
        }
        throw new Error(result.error.message);
      }
    }

    refreshSessions();
  }, [refreshSessions]);
  const reconcileSupersededTerminalSession = useCallback(async (
    session: SessionInfo,
    canonicalSession: SessionInfo,
  ) => {
    const runtimeClient = new RuntimeClient({ timeoutMs: 10_000 });

    if (
      session.pty_id
      && session.pty_id !== canonicalSession.pty_id
    ) {
      const host = resolveRuntimeHostForSession(session);
      const result = await runtimeClient.stopPtyAgent(host, session.pty_id);
      if (!result.ok && result.error.status !== 404) {
        throw new Error(result.error.message);
      }
      console.warn('[agent-hub][pty] stopped superseded duplicate PTY before retiring session', {
        sessionId: session.id,
        supersededBySessionId: canonicalSession.id,
        ptyId: session.pty_id,
        canonicalPtyId: canonicalSession.pty_id ?? null,
        sourceHostId: session.source_host_id ?? null,
        status: result.ok ? result.data.status : 'missing',
      });
      await fetchPtyAgentsRef.current();
    }

    await retireSupersededTerminalSession(session);
    console.warn('[agent-hub][pty] retired superseded terminal session', {
      sessionId: session.id,
      supersededBySessionId: canonicalSession.id,
      innerSessionId: session.inner_session_id ?? null,
      ptyId: session.pty_id ?? null,
      sourceHostId: session.source_host_id ?? null,
    });
  }, [knownPtyIds, retireSupersededTerminalSession]);

  const attemptDisconnectedTerminalSessionResume = useCallback(async function attemptDisconnectedTerminalSessionResumeInternal(
    session: SessionInfo,
    options: { force?: boolean; activateTerminal?: boolean } = {},
  ): Promise<TerminalResumeOutcome> {
    if (!canResumeHistoricalTerminalSession(session) || !session.inner_session_id) {
      return {
        status: 'failed',
        reason: 'historical-record-mismatch',
        sessionId: session.id,
      };
    }

    const currentPtyId = session.pty_id?.trim() || null;
    const historicalSessionKey = buildHistoricalTerminalSessionIdentityKey(session);
    if (autoResumeInFlightSessionIdsRef.current.has(session.id)) {
      return {
        status: 'deferred',
        reason: 'session-in-flight',
        sessionId: session.id,
        historicalSessionKey,
      };
    }
    if (autoResumingSessionIdsRef.current.has(session.id)) {
      return {
        status: 'deferred',
        reason: 'session-auto-resuming',
        sessionId: session.id,
        historicalSessionKey,
      };
    }
    if (historicalSessionKey && autoResumeInFlightHistoricalSessionKeysRef.current.has(historicalSessionKey)) {
      return {
        status: 'deferred',
        reason: 'historical-session-in-flight',
        sessionId: session.id,
        historicalSessionKey,
      };
    }
    if (!options.force && autoResumeAttemptedSessionIdsRef.current.has(session.id)) {
      return {
        status: 'deferred',
        reason: 'already-attempted',
        sessionId: session.id,
        historicalSessionKey,
      };
    }

    const occupiedSession = resolveOccupiedHistoricalSession(session.inner_session_id);
    if (occupiedSession && occupiedSession.id !== session.id) {
      if (
        isSessionPtyDisconnected(occupiedSession)
        || !occupiedSession.pty_id
      ) {
        return attemptDisconnectedTerminalSessionResumeInternal(occupiedSession, options);
      }

      autoResumeAttemptedSessionIdsRef.current.add(session.id);
      setTiledPaneOrder((prev) => replacePaneOrderSessionId(prev, session.id, occupiedSession.id));

      if (options.activateTerminal || options.force || activePtyId === currentPtyId) {
        openPtyTerminal(occupiedSession.pty_id!, occupiedSession.source_host_id, {
          reconnectIfSame: true,
        });
      }

      void reconcileSupersededTerminalSession(session, occupiedSession).catch((error) => {
        console.warn('[agent-hub][pty] failed to retire superseded terminal session', {
          sessionId: session.id,
          supersededBySessionId: occupiedSession.id,
          innerSessionId: session.inner_session_id,
          message: error instanceof Error ? error.message : String(error),
        });
      });

      return {
        status: 'success',
        mode: 'rebound',
        ptyId: occupiedSession.pty_id!,
        sessionId: occupiedSession.id,
      };
    }

    const matchedHost = resolveRuntimeHostBySourceHostId(session.source_host_id);
    const shouldFallbackToActiveRuntimeHost = canFallbackToActiveRuntimeHostForSession(session);
    const shouldDeferUnavailableSourceHostResume = shouldDeferUnavailableSourceHostHandling(
      session,
      matchedHost,
    );
    if (shouldDeferUnavailableSourceHostResume) {
      console.info('[agent-hub][pty] defer terminal auto-resume while embedded runtime host identity is settling', {
        sessionId: session.id,
        agentType: session.agent_kind,
        ptyId: session.pty_id,
        innerSessionId: session.inner_session_id,
        sourceHostId: session.source_host_id,
        runtimeRunning: runtimeServiceStatus?.running ?? null,
        runtimeStartedAt: runtimeServiceStatus?.startedAt ?? null,
      });
      return {
        status: 'deferred',
        reason: 'source-host-settling',
        sessionId: session.id,
        historicalSessionKey,
      };
    }
    if (session.source_host_id && !matchedHost && !shouldFallbackToActiveRuntimeHost) {
      console.warn('[agent-hub][pty] skip terminal auto-resume because source host is no longer available', {
        sessionId: session.id,
        agentType: session.agent_kind,
        ptyId: session.pty_id,
        innerSessionId: session.inner_session_id,
        sourceHostId: session.source_host_id,
      });
      return {
        status: 'failed',
        reason: 'source-host-unavailable',
        sessionId: session.id,
        historicalSessionKey,
      };
    }

    const host = matchedHost && !shouldFallbackToActiveRuntimeHost
      ? matchedHost
      : resolveActiveRuntimeHost();
    const sessionHostId = shouldFallbackToActiveRuntimeHost
      ? activeEmbeddedRuntimeHostId
      : session.source_host_id ?? null;
    const runtimeBaseUrl = resolveRuntimeHostBaseUrl(host);
    const headers = Object.fromEntries(buildRuntimeAuthHeaders(host.authToken, {
      'Content-Type': 'application/json',
    }).entries());
    const workdir = resolveTerminalSessionWorkdir(session);

    console.info('[agent-hub][pty] attempting disconnected terminal auto-resume', {
      sessionId: session.id,
      agentType: session.agent_kind,
      ptyId: currentPtyId,
      innerSessionId: session.inner_session_id,
      sourceHostId: session.source_host_id ?? null,
      hostAddress: `${host.host}:${host.port}`,
      activateTerminal: options.activateTerminal ?? false,
      force: options.force ?? false,
    });
    if (historicalSessionKey) {
      autoResumeInFlightHistoricalSessionKeysRef.current.add(historicalSessionKey);
    }
    autoResumeInFlightSessionIdsRef.current.add(session.id);

    try {
      const livePtys = currentPtyId
        ? await fetchPtyList(
            runtimeBaseUrl,
            host.authToken,
            sessionHostId ?? undefined,
          )
        : null;
      if (currentPtyId && livePtys?.some((pty) => pty.id === currentPtyId)) {
        console.warn('[agent-hub][pty] skip terminal auto-resume because PTY is still live', {
          sessionId: session.id,
          agentType: session.agent_kind,
          ptyId: currentPtyId,
          innerSessionId: session.inner_session_id,
          hostAddress: `${host.host}:${host.port}`,
        });
        setFailedPtyConnectionIds((prev) => prev.filter((id) => id !== currentPtyId));
        if (options.activateTerminal || options.force || activePtyId === currentPtyId) {
          openPtyTerminal(currentPtyId, sessionHostId ?? undefined, {
            reconnectIfSame: true,
          });
        }
        return {
          status: 'success',
          mode: 'live',
          ptyId: currentPtyId,
          sessionId: session.id,
        };
      }

      deferredAutoResumeDecisionSignaturesRef.current.delete(session.id);
      setSessionAutoResuming(session.id, true);
      autoResumeAttemptedSessionIdsRef.current.add(session.id);

      const hasMatchingHistoricalRecord = await hasMatchingHistoricalSessionRecord(
        runtimeBaseUrl,
        session,
        host.authToken,
      );
      console.info('[agent-hub][pty] disconnected terminal historical record lookup completed', {
        sessionId: session.id,
        agentType: session.agent_kind,
        ptyId: currentPtyId,
        innerSessionId: session.inner_session_id,
        sourceHostId: session.source_host_id ?? null,
        workdir: workdir ?? null,
        hasMatchingHistoricalRecord,
      });
      if (!hasMatchingHistoricalRecord) {
        console.warn('[agent-hub][pty] skip terminal auto-resume because historical session record does not match workdir', {
          sessionId: session.id,
          agentType: session.agent_kind,
          ptyId: currentPtyId,
          innerSessionId: session.inner_session_id,
          workdir: workdir ?? null,
        });
        return {
          status: 'failed',
          reason: 'historical-record-mismatch',
          sessionId: session.id,
          historicalSessionKey,
        };
      }

      console.info('[agent-hub][pty] posting disconnected terminal resume request', {
        sessionId: session.id,
        agentType: session.agent_kind,
        ptyId: currentPtyId,
        innerSessionId: session.inner_session_id,
        sourceHostId: session.source_host_id ?? null,
        hostAddress: `${host.host}:${host.port}`,
      });
      const response = await fetch(`${runtimeBaseUrl}/pty/resume`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent_type: session.agent_kind,
          session_id: session.inner_session_id,
          ...(session.role ? { name: session.role } : {}),
          ...(workdir ? { workdir } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const info = await response.json() as { id: string };
      if (!info.id) {
        throw new Error('missing resumed PTY id');
      }

      if (options.activateTerminal || options.force || activePtyId === currentPtyId) {
        openPtyTerminal(info.id, sessionHostId ?? undefined, {
          expectFreshPresence: true,
          reconnectIfSame: true,
        });
      }

      await retireSupersededTerminalSession(session);

      await fetchPtyAgentsRef.current();
      await Promise.resolve(refreshSessions());
      return {
        status: 'success',
        mode: 'resumed',
        ptyId: info.id,
        sessionId: session.id,
      };
    } catch (error) {
      if (!autoResumeAttemptedSessionIdsRef.current.has(session.id)) {
        deferredAutoResumeDecisionSignaturesRef.current.set(
          session.id,
          buildDisconnectedTerminalSessionDecisionSignature(session),
        );
      }
      console.warn('[agent-hub][pty] terminal auto-resume failed', {
        sessionId: session.id,
        agentType: session.agent_kind,
        ptyId: currentPtyId,
        innerSessionId: session.inner_session_id,
        hostAddress: `${host.host}:${host.port}`,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 'failed',
        reason: 'runtime-request-failed',
        sessionId: session.id,
        historicalSessionKey,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      autoResumeInFlightSessionIdsRef.current.delete(session.id);
      if (historicalSessionKey) {
        autoResumeInFlightHistoricalSessionKeysRef.current.delete(historicalSessionKey);
      }
      setSessionAutoResuming(session.id, false);
    }
  }, [
    activePtyId,
    canFallbackToActiveRuntimeHostForSession,
    fetchPtyList,
    refreshSessions,
    reconcileSupersededTerminalSession,
    resolveOccupiedHistoricalSession,
    runtimeServiceStatus?.running,
    runtimeServiceStatus?.startedAt,
    setSessionAutoResuming,
    isSessionPtyDisconnected,
    shouldDeferUnavailableSourceHostHandling,
  ]);
  const resumeDisconnectedTerminalSession = useCallback(async (
    session: SessionInfo,
    options: { force?: boolean; activateTerminal?: boolean } = {},
  ) => {
    const outcome = await attemptDisconnectedTerminalSessionResume(session, options);
    return outcome.status === 'success' ? outcome.ptyId : null;
  }, [attemptDisconnectedTerminalSessionResume]);

  const handleOpenSessionTerminal = useCallback(async (session: SessionInfo) => {
    if (!session.pty_id) {
      const recoverableSnapshot = buildRecoverableTerminalSessionSnapshot(session);
      const missingPtyLogPayload = {
        sessionId: session.id,
        sourceHostId: session.source_host_id ?? null,
        status: session.status,
        innerSessionId: session.inner_session_id ?? null,
      };

      if (!recoverableSnapshot) {
        const failureMessage = '该会话没有关联 PTY；可在“网络 / 会话”中点击右上角“强制完成”将其收敛。';
        console.warn('[agent-hub][pty][open] session is missing pty_id and cannot resume', missingPtyLogPayload);
        setRuntimeHostError(failureMessage);
        return;
      }

      const matchedHost = resolveRuntimeHostBySourceHostId(session.source_host_id);
      const shouldFallbackToActiveRuntimeHost = canFallbackToActiveRuntimeHostForSession(session);
      const shouldDeferUnavailableSourceHostResume = shouldDeferUnavailableSourceHostHandling(
        session,
        matchedHost,
      );
      if (shouldDeferUnavailableSourceHostResume) {
        const deferredMessage = 'Terminal 会话缺少 PTY；嵌入式 RT 仍在恢复中，请稍后重试。';
        setRuntimeHostError(deferredMessage);
        console.info('[agent-hub][pty][open] deferred missing-PTY resume while source host is settling', {
          ...missingPtyLogPayload,
          runtimeRunning: runtimeServiceStatus?.running ?? null,
          runtimeStartedAt: runtimeServiceStatus?.startedAt ?? null,
        });
        return;
      }
      if (session.source_host_id && !matchedHost && !shouldFallbackToActiveRuntimeHost) {
        const failureMessage = 'Terminal 会话缺少 PTY，且原始 RT 已不可用；可在“网络 / 会话”中点击右上角“强制完成”将其收敛。';
        setRuntimeHostError(failureMessage);
        console.warn('[agent-hub][pty][open] missing-PTY resume skipped because source host is unavailable', {
          ...missingPtyLogPayload,
          sourceHostId: session.source_host_id,
        });
        return;
      }

      setRuntimeHostError(
        'Terminal 会话缺少 PTY，正在尝试恢复历史终端；若恢复失败，可在“网络 / 会话”中点击右上角“强制完成”将其收敛。',
      );
      console.info('[agent-hub][pty][open] session is missing pty_id; attempting historical resume', {
        ...missingPtyLogPayload,
        recoverableAgentType: recoverableSnapshot.agentType,
        recoverableWorkdir: recoverableSnapshot.workdir,
      });
      try {
        const host = matchedHost && !shouldFallbackToActiveRuntimeHost
          ? matchedHost
          : resolveActiveRuntimeHost();
        const sessionHostId = shouldFallbackToActiveRuntimeHost
          ? activeEmbeddedRuntimeHostId
          : session.source_host_id ?? null;
        const resumed = await resumeHistoricalPtySnapshot({
          rtBaseUrl: resolveRuntimeHostBaseUrl(host),
          authToken: resolveRuntimeHostAuthToken(host),
          snapshot: recoverableSnapshot,
        });
        openPtyTerminal(resumed.id, sessionHostId ?? undefined, {
          expectFreshPresence: true,
          reconnectIfSame: true,
        });
        await fetchPtyAgentsRef.current();
        await Promise.resolve(refreshSessions());
        setRuntimeHostError('');
        console.info('[agent-hub][pty][open] resumed terminal session without PTY', {
          sessionId: session.id,
          resumedPtyId: resumed.id,
          sourceHostId: sessionHostId,
          innerSessionId: recoverableSnapshot.innerSessionId,
        });
        return;
      } catch (error) {
        const failureMessage = 'Terminal 会话缺少 PTY，自动恢复失败；可在“网络 / 会话”中点击右上角“强制完成”将其收敛。';
        setRuntimeHostError(failureMessage);
        console.warn('[agent-hub][pty][open] failed to resume terminal session without PTY', {
          ...missingPtyLogPayload,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }

    }

    setRuntimeHostError('');
    const sessionReadOnlyHistory = isCompletedTerminalSession(session);
    const sessionKnownLive = knownPtyIds.has(session.pty_id);
    const sessionCanJudgePtyPresence = canJudgeSessionPtyPresence(session);
    const sessionFreshPresenceProtected = isFreshTerminalSessionPresenceProtected(session);
    const sessionMissingFromLiveList = sessionCanJudgePtyPresence
      && !sessionKnownLive
      && !sessionFreshPresenceProtected;
    const sessionDisconnected = sessionReadOnlyHistory
      || isSessionPtyDisconnected(session)
      || sessionMissingFromLiveList;
    const sessionTerminalHostId = resolveTerminalSessionHostId(session);
    console.info('[agent-hub][pty][open] requested', {
      sessionId: session.id,
      ptyId: session.pty_id,
      sourceHostId: session.source_host_id ?? null,
      status: session.status,
      disconnected: sessionDisconnected,
      readOnlyHistory: sessionReadOnlyHistory,
      knownLive: sessionKnownLive,
      freshPresenceProtected: sessionFreshPresenceProtected,
      recoverable: isRecoverableTerminalSession(session),
    });

    const occupiedSession = resolveOccupiedHistoricalSession(session.inner_session_id);
    if (
      occupiedSession
      && occupiedSession.id !== session.id
      && !isSessionPtyDisconnected(occupiedSession)
    ) {
      console.info('[agent-hub][pty][open] redirecting duplicate historical session to canonical PTY', {
        sessionId: session.id,
        occupiedSessionId: occupiedSession.id,
        occupiedPtyId: occupiedSession.pty_id ?? null,
        innerSessionId: session.inner_session_id ?? null,
      });
      setTiledPaneOrder((prev) => replacePaneOrderSessionId(prev, session.id, occupiedSession.id));
      openPtyTerminal(occupiedSession.pty_id!, occupiedSession.source_host_id, {
        reconnectIfSame: true,
      });
      void reconcileSupersededTerminalSession(session, occupiedSession).catch((error) => {
        console.warn('[agent-hub][pty] failed to retire duplicate terminal window binding', {
          sessionId: session.id,
          occupiedSessionId: occupiedSession.id,
          innerSessionId: session.inner_session_id,
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    if (sessionDisconnected) {
      const failureMessage = sessionReadOnlyHistory
        ? 'Terminal 会话已结束；下方将展示关闭前历史，可继续归档。'
        : isRecoverableTerminalSession(session)
        ? 'Terminal 已断开，正在尝试恢复；若恢复失败，将展示关闭前历史。'
        : 'Terminal 已断开，无法恢复；下方将展示关闭前历史，可结束后归档。';
      setRuntimeHostError(failureMessage);
      console.warn('[agent-hub][pty][open] session PTY is disconnected', {
        sessionId: session.id,
        ptyId: session.pty_id,
        sourceHostId: session.source_host_id ?? null,
        status: session.status,
        readOnlyHistory: sessionReadOnlyHistory,
        canJudgePtyPresence: sessionCanJudgePtyPresence,
        freshPresenceProtected: sessionFreshPresenceProtected,
        sourceHostAvailable: isSourceHostAvailable(session.source_host_id),
      });
      openPtyTerminal(session.pty_id, sessionTerminalHostId ?? undefined, {
        reconnectIfSame: true,
      });
      console.info('[agent-hub][pty][open] disconnected terminal history panel opened', {
        sessionId: session.id,
        ptyId: session.pty_id,
        sourceHostId: sessionTerminalHostId,
        recoverable: isRecoverableTerminalSession(session),
      });
    }

    if (sessionDisconnected && isRecoverableTerminalSession(session)) {
      const resumeOutcome = await attemptDisconnectedTerminalSessionResume(session, {
        activateTerminal: true,
        force: true,
      });
      if (resumeOutcome.status === 'success') {
        setRuntimeHostError('');
        console.info('[agent-hub][pty][open] resumed disconnected terminal session', {
          sessionId: session.id,
          previousPtyId: session.pty_id,
          resumedPtyId: resumeOutcome.ptyId,
          sourceHostId: session.source_host_id ?? null,
          mode: resumeOutcome.mode,
        });
        return;
      }
      if (shouldKeepPendingTerminalResumeState(resumeOutcome)) {
        return;
      }

      const failureMessage = 'Terminal 已断开，自动恢复失败；下方将展示关闭前历史，可结束后归档。';
      setRuntimeHostError(failureMessage);
      console.warn('[agent-hub][pty][open] auto-resume failed; falling back to disconnected history view', {
        sessionId: session.id,
        ptyId: session.pty_id,
        sourceHostId: session.source_host_id ?? null,
        innerSessionId: session.inner_session_id ?? null,
      });
      return;
    }

    if (!sessionDisconnected && !sessionKnownLive && sessionCanJudgePtyPresence) {
      console.warn('[agent-hub][pty][open] PTY missing from live list; opening terminal to surface failure state', {
        sessionId: session.id,
        ptyId: session.pty_id,
        sourceHostId: session.source_host_id ?? null,
        status: session.status,
      });
    }

    if (sessionDisconnected) {
      return;
    }

    openPtyTerminal(session.pty_id, sessionTerminalHostId ?? undefined, {
      reconnectIfSame: true,
    });
    console.info('[agent-hub][pty][open] terminal panel opened', {
      sessionId: session.id,
      ptyId: session.pty_id,
      sourceHostId: sessionTerminalHostId,
      disconnected: sessionDisconnected,
      knownLive: sessionKnownLive,
    });
  }, [
    activeEmbeddedRuntimeHostId,
    canFallbackToActiveRuntimeHostForSession,
    canJudgePtyPresenceForHost,
    canJudgeSessionPtyPresence,
    isSessionPtyDisconnected,
    isFreshTerminalSessionPresenceProtected,
    isSourceHostAvailable,
    knownPtyIds,
    refreshSessions,
    resolveOccupiedHistoricalSession,
    resolveRuntimeHostBySourceHostId,
    resolveTerminalSessionHostId,
    reconcileSupersededTerminalSession,
    attemptDisconnectedTerminalSessionResume,
    runtimeServiceStatus?.running,
    runtimeServiceStatus?.startedAt,
    shouldDeferUnavailableSourceHostHandling,
  ]);

  const canArchiveActivePtySession = activePtySession?.status === 'completed';
  const handleArchiveActivePtySession = async () => {
    if (!activePtySession) {
      return;
    }

    const archived = await handleArchiveSession(activePtySession);
    if (!archived) {
      return;
    }

    if (activePtyId === activePtySession.pty_id) {
      setActivePtyId(null);
      setActivePtyHostId(null);
    }
    closeRightPanel();
  };

  const handleActivePtyInitialConnectionFailure = useCallback(async (
    ptyId: string,
    hostId?: string | null,
  ) => {
    const now = Date.now();
    const connection = resolveRuntimeConnectionForHostId(hostId);
    const hostAddress = resolveDialAddressFromBaseUrl(connection.rtBaseUrl) ?? connection.rtBaseUrl;
    console.warn('[agent-hub][pty][connect] initial terminal stream failed; rechecking PTY liveness', {
      ptyId,
      sourceHostId: hostId ?? null,
      hostAddress,
    });

    try {
      const livePtys = await fetchPtyList(connection.rtBaseUrl, connection.authToken, hostId ?? undefined);
      if (livePtys?.some((pty) => pty.id === ptyId)) {
        const previousRetryState = activePtyInitialStreamReconnectStateRef.current.get(ptyId);
        const retryWindowActive = previousRetryState != null
          && now - previousRetryState.firstFailureAtMs <= ACTIVE_PTY_INITIAL_STREAM_RECONNECT_WINDOW_MS;
        const retryCount = retryWindowActive ? previousRetryState.retryCount : 0;

        setFailedPtyConnectionIds((prev) => prev.filter((id) => id !== ptyId));
        if (retryCount >= ACTIVE_PTY_INITIAL_STREAM_RECONNECT_RETRY_LIMIT) {
          activePtyInitialStreamReconnectStateRef.current.delete(ptyId);
          console.warn('[agent-hub][pty][connect] stopping automatic same-PTY reconnect after repeated initial stream failures', {
            ptyId,
            sourceHostId: hostId ?? null,
            hostAddress,
            retryCount,
            retryWindowMs: ACTIVE_PTY_INITIAL_STREAM_RECONNECT_WINDOW_MS,
          });
          return;
        }

        activePtyInitialStreamReconnectStateRef.current.set(ptyId, {
          retryCount: retryCount + 1,
          firstFailureAtMs: retryWindowActive
            ? previousRetryState!.firstFailureAtMs
            : now,
        });
        console.info('[agent-hub][pty][connect] PTY still live after initial stream failure; keeping terminal active', {
          ptyId,
          sourceHostId: hostId ?? null,
          hostAddress,
        });
        setRuntimeHostError('');
        setFailedPtyConnectionIds((prev) => prev.filter((id) => id !== ptyId));
        openPtyTerminal(ptyId, hostId ?? undefined, { reconnectIfSame: true });
        return;
      }

      activePtyInitialStreamReconnectStateRef.current.delete(ptyId);
      const failureMessage = 'Terminal 首次连接失败，当前 PTY 已不存在；下方将展示关闭前历史，可结束后归档。';
      console.warn('[agent-hub][pty][connect] PTY missing after initial stream failure; switching terminal to disconnected history view', {
        ptyId,
        sourceHostId: hostId ?? null,
        hostAddress,
      });
      setRuntimeHostError(failureMessage);
    } catch (error) {
      activePtyInitialStreamReconnectStateRef.current.delete(ptyId);
      const message = error instanceof Error ? error.message : String(error);
      const timeout = isRuntimeFetchTimeoutError(error);
      console.warn('[agent-hub][pty][connect] PTY liveness recheck failed after initial stream failure', {
        ptyId,
        sourceHostId: hostId ?? null,
        hostAddress,
        timeout,
        message,
      });
      setRuntimeHostError(
        'RT 暂不可达，Terminal 已进入断开只读态；下方将展示关闭前历史，可结束后归档。',
      );
    }

    console.warn('[agent-hub][pty][connect] marking PTY as disconnected after initial stream failure', {
      ptyId,
      sourceHostId: hostId ?? null,
      hostAddress,
    });
    setFailedPtyConnectionIds((prev) => (
      prev.includes(ptyId) ? prev : [...prev, ptyId]
    ));
    void fetchPtyAgentsRef.current();
  }, [fetchPtyList, openPtyTerminal, resolveRuntimeConnectionForHostId]);

  const applyRuntimeSnapshot = (snapshot: { hosts: RuntimeHostSnapshot[]; agents: RuntimeAggregatedAgent[] }) => {
    setRuntimeHostSnapshots(snapshot.hosts);
    setListSections(buildListSectionsFromRuntimeAgents(snapshot.agents));
  };

  const syncRuntimeTargetState = (target = getSelectedRuntimeTarget()) => {
    setRuntimeTargetModeValue(target.mode);
    setRuntimeTargetAddress(formatRuntimeTargetAddress(target));
    setRuntimeExternalAddressDraft(getRuntimeExternalAddress());
    setRuntimeExternalAuthTokenDraft(getRuntimeExternalAuthToken());
  };

  const syncMatchingExternalTargetAuthToken = async (
    target = getSelectedRuntimeTarget(),
  ): Promise<void> => {
    if (target.mode !== 'external' || !target.authToken) {
      return;
    }

    const hosts = await runtimeHostService.listHosts();
    const matchingHosts = hosts.filter((host) => (
      host.host === target.host
      && host.port === target.port
      && host.authToken !== target.authToken
    ));

    if (matchingHosts.length === 0) {
      return;
    }

    await Promise.all(matchingHosts.map((host) => (
      runtimeHostService.mergeHostMetadata(host.id, {
        authToken: target.authToken,
      })
    )));
  };

  const effectiveEmbeddedRuntimeNetworkMode = hasExplicitEmbeddedRuntimeNetworkMode
    ? embeddedRuntimeNetworkMode
    : (
      runtimeServiceStatus?.running
        ? inferEmbeddedRuntimeNetworkMode(runtimeServiceStatus)
        : embeddedRuntimeNetworkMode
    );
  const desiredEmbeddedRuntimeHost = resolveEmbeddedRuntimeBindHost(effectiveEmbeddedRuntimeNetworkMode);
  const desiredEmbeddedRuntimePort = runtimeServiceStatus?.running
    ? runtimeServiceStatus.port
    : getPreferredEmbeddedRuntimePort();
  const desiredEmbeddedRuntimeAddress = `${desiredEmbeddedRuntimeHost}:${desiredEmbeddedRuntimePort}`;
  const runtimeNeedsRebind = Boolean(
    hasExplicitEmbeddedRuntimeNetworkMode
      && runtimeServiceStatus?.running
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
      const runtimeBaseUrl = resolveRuntimeHostBaseUrl(host);
      const runtimeHeaders = buildRuntimeAuthHeaders(host.authToken);
      const [routes, agentsResult, businessHistoryResponse, proofHistoryResponse, energyResult] = await Promise.all([
        routeService.listRoutes(),
        runtimeClient.getAgents(host),
        fetch(
          `${runtimeBaseUrl}/signals/history?limit=120&exclude_topic_prefix=${encodeURIComponent(LINK_PROOF_TOPIC_PREFIX)}`,
          { headers: runtimeHeaders },
        ).catch(() => null),
        fetch(
          `${runtimeBaseUrl}/signals/history?limit=120&topic_prefix=${encodeURIComponent(LINK_PROOF_TOPIC_PREFIX)}`,
          { headers: runtimeHeaders },
        ).catch(() => null),
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
      const businessHistory = businessHistoryResponse?.ok
        ? ((await businessHistoryResponse.json()) as SignalEvent[])
        : [];
      const proofHistory = proofHistoryResponse?.ok
        ? ((await proofHistoryResponse.json()) as SignalEvent[])
        : [];
      const history = mergeSignalHistoryEvents(businessHistory, proofHistory);
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

  const fetchPtyAgents = async (connectionOverride?: PtySpawnConnectionTarget | null) => {
    const connection = connectionOverride ?? ptySpawnConnection;
    const currentHostId = connection.hostId ?? null;
    const currentHostAddress = resolveDialAddressFromBaseUrl(connection.rtBaseUrl)
      ?? connection.rtBaseUrl;

    try {
      const data = await fetchPtyList(
        connection.rtBaseUrl,
        connection.authToken,
        currentHostId ?? undefined,
      );
      if (isAgentsPageDisposedRef.current) return;
      setFailedPtyConnectionIds((prev) => prev.filter((ptyId) => !data.some((pty) => pty.id === ptyId)));
      setPendingPtyPresenceChecks((prev) => {
        const now = Date.now();
        let changed = false;
        const nextEntries = Object.entries(prev).flatMap(([ptyId, entry]) => {
          if (data.some((pty) => pty.id === ptyId)) {
            changed = true;
            return [];
          }

          if (!isSamePendingPtyPresenceHost(entry.hostId, currentHostId)) {
            return [[ptyId, entry] as const];
          }

          if (isPendingPtyPresenceCheckActive(entry, now)) {
            console.info('[agent-hub][pty] keeping fresh PTY protected until grace window expires', {
              ptyId,
              hostId: currentHostId,
              hostAddress: currentHostAddress,
              expiresInMs: Math.max(0, entry.expiresAtMs - now),
            });
            return [[ptyId, entry] as const];
          }

          changed = true;
          console.warn('[agent-hub][pty] fresh PTY did not appear before grace window expired', {
            ptyId,
            hostId: currentHostId,
            hostAddress: currentHostAddress,
            startedAtMs: entry.startedAtMs,
            expiresAtMs: entry.expiresAtMs,
          });
          return [];
        });
        return changed ? Object.fromEntries(nextEntries) : prev;
      });
      setPtyAgents(prev => {
        if (
          prev.length === data.length &&
          prev.every((p, i) =>
            p.id === data[i].id
            && p.name === data[i].name
            && p.status === data[i].status
            && p.sourceHostId === data[i].sourceHostId
          )
        ) {
          return prev; // No change — preserve reference identity
        }
        return data;
      });
      setLoadedPtyHostId(currentHostId);
      if (activePtyId && data.some((pty) => pty.id === activePtyId)) {
        setRuntimeHostError((prev) => (
          prev.startsWith('RT 暂不可达') ? '' : prev
        ));
      }
    } catch (error) {
      if (isAgentsPageDisposedRef.current) return;
      const activePtyHostIdForFailure = activePtyHostId ?? activePtySession?.source_host_id ?? null;
      const shouldMarkActivePtyDisconnected = Boolean(
        activePtyId && activePtyHostIdForFailure === currentHostId,
      );
      const staleLoadedPtyIds = loadedPtyHostId === currentHostId
        ? ptyAgents.map((pty) => pty.id)
        : [];
      const failedPtyIds = Array.from(new Set([
        ...staleLoadedPtyIds,
        ...(shouldMarkActivePtyDisconnected && activePtyId ? [activePtyId] : []),
      ]));
      console.warn('[agent-hub][pty] failed to refresh PTY list', {
        hostId: currentHostId,
        hostAddress: currentHostAddress,
        message: error instanceof Error ? error.message : String(error),
      });
      console.warn('[agent-hub][pty] keeping last known PTY list because refresh failed', {
        hostId: currentHostId,
        hostAddress: currentHostAddress,
      });
      setLoadedPtyHostId(currentHostId);
      if (
        activePtyId
        && (activePtyHostId ?? activePtySession?.source_host_id ?? null) === currentHostId
      ) {
        setRuntimeHostError(
          'RT 暂不可达，Terminal 已进入断开只读态；下方将展示关闭前历史，可结束后归档。',
        );
      } else {
        setRuntimeHostError((prev) => (
          prev.startsWith('RT 暂不可达') ? '' : prev
        ));
      }
      if (failedPtyIds.length > 0) {
        console.warn('[agent-hub][pty] marking current host PTYs as disconnected because refresh failed', {
          hostId: currentHostId,
          hostAddress: currentHostAddress,
          ptyIds: failedPtyIds,
          loadedPtyHostId,
          activePtyId: activePtyId ?? null,
        });
        setFailedPtyConnectionIds((prev) => Array.from(new Set([...prev, ...failedPtyIds])));
      }
    } finally {
      if (isAgentsPageDisposedRef.current) return;
      setHasLoadedPtyAgents(true);
    }
  };
  // Keep ref in sync so the polling interval always calls the latest version.
  fetchPtyAgentsRef.current = fetchPtyAgents;

  const lastResolvedPtyConnectionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!runtimeServiceStatus?.running && runtimeHostSnapshots.length === 0 && !activeSignalRouteHost) {
      return;
    }

    const connectionKey = [
      ptySpawnConnection.rtBaseUrl,
      ptySpawnConnection.hostId,
      ptySpawnConnection.authToken ?? '',
      runtimeServiceStatus?.running ? 'running' : 'stopped',
    ].join('|');
    if (lastResolvedPtyConnectionKeyRef.current === connectionKey) {
      return;
    }

    lastResolvedPtyConnectionKeyRef.current = connectionKey;
    void fetchPtyAgentsRef.current();
  }, [
    activeSignalRouteHost,
    ptySpawnConnection.authToken,
    ptySpawnConnection.hostId,
    ptySpawnConnection.rtBaseUrl,
    runtimeHostSnapshots.length,
    runtimeServiceStatus?.running,
  ]);

  useEffect(() => {
    if (ptyAgents.length === 0) return;
    setFailedPtyConnectionIds((prev) => prev.filter((ptyId) => !knownPtyIds.has(ptyId)));
  }, [knownPtyIds, ptyAgents.length]);

  const activeDisconnectedPtySession = activePtySession;
  useEffect(() => {
    if (!activePtyId || activePtySession?.status !== 'archived') {
      return;
    }

    setActivePtyId(null);
    setActivePtyHostId(null);
    closeRightPanel();
  }, [activePtyId, activePtySession?.status]);
  const isActivePtyDisconnected = useMemo(() => {
    if (!activePtyId) {
      return false;
    }
    if (isCompletedTerminalSession(activeDisconnectedPtySession)) {
      return true;
    }
    if (failedPtyConnectionIds.includes(activePtyId)) {
      return true;
    }
    if (knownPtyIds.has(activePtyId)) {
      return false;
    }
    if (pendingPtyPresenceIds.has(activePtyId)) {
      return false;
    }
    if (!hasLoadedPtyAgents) {
      return false;
    }

    if (activeDisconnectedPtySession) {
      if (!canJudgeSessionPtyPresence(activeDisconnectedPtySession)) {
        return false;
      }
    } else {
      const expectedHostId = activePtyHostId ?? null;
      if (!canJudgePtyPresenceForHost(expectedHostId)) {
        return false;
      }
    }

    if (activeDisconnectedPtySession?.pty_id && pendingPtyPresenceIds.has(activeDisconnectedPtySession.pty_id)) {
      return false;
    }

    return !knownPtyIds.has(activePtyId);
  }, [
    activeDisconnectedPtySession,
    activePtyHostId,
    activePtyId,
    canJudgePtyPresenceForHost,
    canJudgeSessionPtyPresence,
    failedPtyConnectionIds,
    hasLoadedPtyAgents,
    knownPtyIds,
    pendingPtyPresenceIds,
  ]);
  const isActivePtyAutoResuming = Boolean(
    (activeDisconnectedPtySession
      && autoResumingSessionIds.includes(activeDisconnectedPtySession.id))
    || (fullscreenTerminalRecoveryKey
      && persistedFullscreenAutoResumeKey === fullscreenTerminalRecoveryKey),
  );
  const activeRecoverableTerminalLabel = useMemo(
    () => resolveRecoverableTerminalAgentLabel(
      activeDisconnectedPtySession?.agent_kind ?? fullscreenTerminalRecovery?.agentType ?? null,
    ),
    [activeDisconnectedPtySession?.agent_kind, fullscreenTerminalRecovery?.agentType],
  );

  useEffect(() => {
    if (
      !activePtyId
      || !fullscreenTerminalRecovery
      || !fullscreenTerminalRecoveryKey
      || !hasLoadedPtyAgents
      || !isActivePtyDisconnected
      || (runtimeTargetModeValue === 'embedded' && embeddedRuntimeHostIdentitySettling)
      || autoResumeInFlightHistoricalSessionKeysRef.current.has(fullscreenTerminalRecoveryKey)
    ) {
      return;
    }

    const failureMessage = 'Terminal 已断开，自动恢复失败；下方将展示关闭前历史，可结束后归档。';

    if (
      matchedFullscreenRecoverySession?.pty_id
      && knownPtyIds.has(matchedFullscreenRecoverySession.pty_id)
      && matchedFullscreenRecoverySession.pty_id !== activePtyId
    ) {
      if (fullscreenTerminalRecovery.sessionId) {
        setTiledPaneOrder((prev) => (
          prev.includes(fullscreenTerminalRecovery.sessionId!)
            ? replacePaneOrderSessionId(prev, fullscreenTerminalRecovery.sessionId!, matchedFullscreenRecoverySession.id)
            : prev
        ));
      }
      setRuntimeHostError('');
      openPtyTerminal(
        matchedFullscreenRecoverySession.pty_id,
        matchedFullscreenRecoverySession.source_host_id,
      );
      console.info('[agent-hub][pty] rebound fullscreen terminal from persisted recovery snapshot', {
        previousPtyId: activePtyId,
        nextPtyId: matchedFullscreenRecoverySession.pty_id,
        sessionId: matchedFullscreenRecoverySession.id,
        recoveryKey: fullscreenTerminalRecoveryKey,
      });
      return;
    }

    const runtimeEpochKey = `${fullscreenTerminalRecoveryKey}|${runtimeServiceStatus?.startedAt ?? 'no-started-at'}`;
    if (persistedFullscreenRecoveryAttemptedKeysRef.current.has(runtimeEpochKey)) {
      return;
    }

    if (matchedFullscreenRecoverySession && isSessionPtyDisconnected(matchedFullscreenRecoverySession)) {
      setPersistedFullscreenAutoResumeKey(fullscreenTerminalRecoveryKey);
      setRuntimeHostError((prev) => preserveSpecificDisconnectedRuntimeMessage(
        prev,
        'Terminal 已断开，正在尝试恢复；若恢复失败，将展示关闭前历史。',
      ));
      console.info('[agent-hub][pty] attempting persisted fullscreen recovery via matched session', {
        previousPtyId: activePtyId,
        sessionId: matchedFullscreenRecoverySession.id,
        recoveryKey: fullscreenTerminalRecoveryKey,
      });
      void attemptDisconnectedTerminalSessionResume(matchedFullscreenRecoverySession, {
        activateTerminal: true,
        force: true,
      }).then((outcome) => {
        if (outcome.status === 'success') {
          persistedFullscreenRecoveryAttemptedKeysRef.current.add(runtimeEpochKey);
          setRuntimeHostError('');
          console.info('[agent-hub][pty] persisted fullscreen recovery succeeded via matched session', {
            previousPtyId: activePtyId,
            resumedPtyId: outcome.ptyId,
            sessionId: outcome.sessionId,
            recoveryKey: fullscreenTerminalRecoveryKey,
            mode: outcome.mode,
          });
          return;
        }
        if (shouldKeepPendingTerminalResumeState(outcome)) {
          return;
        }
        persistedFullscreenRecoveryAttemptedKeysRef.current.add(runtimeEpochKey);
        setRuntimeHostError((prev) => preserveSpecificDisconnectedRuntimeMessage(prev, failureMessage));
        console.warn('[agent-hub][pty] persisted fullscreen recovery failed via matched session', {
          previousPtyId: activePtyId,
          sessionId: outcome.sessionId,
          recoveryKey: fullscreenTerminalRecoveryKey,
          reason: outcome.reason,
          ...(outcome.status === 'failed' && outcome.message ? { message: outcome.message } : {}),
        });
      }).finally(() => {
        setPersistedFullscreenAutoResumeKey((prev) => (
          prev === fullscreenTerminalRecoveryKey ? null : prev
        ));
      });
      return;
    }

    let host: RuntimeHostRecord;
    try {
      host = resolveActiveRuntimeHost();
    } catch {
      return;
    }

    persistedFullscreenRecoveryAttemptedKeysRef.current.add(runtimeEpochKey);
    setPersistedFullscreenAutoResumeKey(fullscreenTerminalRecoveryKey);
    autoResumeInFlightHistoricalSessionKeysRef.current.add(fullscreenTerminalRecoveryKey);
    setRuntimeHostError((prev) => preserveSpecificDisconnectedRuntimeMessage(
      prev,
      'Terminal 已断开，正在尝试恢复；若恢复失败，将展示关闭前历史。',
    ));
    console.info('[agent-hub][pty] attempting persisted fullscreen recovery from saved snapshot', {
      previousPtyId: activePtyId,
      recoveryKey: fullscreenTerminalRecoveryKey,
      innerSessionId: fullscreenTerminalRecovery.innerSessionId,
      agentType: fullscreenTerminalRecovery.agentType,
      workdir: fullscreenTerminalRecovery.workdir,
      hostAddress: `${host.host}:${host.port}`,
    });
    void (async () => {
      try {
        const runtimeBaseUrl = resolveRuntimeHostBaseUrl(host);
        const hasMatchingHistoricalRecord = await hasMatchingHistoricalSessionSnapshotRecord(
          runtimeBaseUrl,
          fullscreenTerminalRecovery,
          host.authToken,
        );
        if (!hasMatchingHistoricalRecord) {
          setRuntimeHostError((prev) => preserveSpecificDisconnectedRuntimeMessage(prev, failureMessage));
          console.warn('[agent-hub][pty] persisted fullscreen recovery skipped because historical session record does not match', {
            previousPtyId: activePtyId,
            recoveryKey: fullscreenTerminalRecoveryKey,
            innerSessionId: fullscreenTerminalRecovery.innerSessionId,
            workdir: fullscreenTerminalRecovery.workdir,
          });
          return;
        }

        const resumed = await resumeHistoricalPtySnapshot({
          rtBaseUrl: runtimeBaseUrl,
          authToken: host.authToken,
          snapshot: fullscreenTerminalRecovery,
        });
        openPtyTerminal(
          resumed.id,
          host.hostId ?? activeEmbeddedRuntimeHostId ?? fullscreenTerminalRecovery.sourceHostId,
          { expectFreshPresence: true },
        );
        setRuntimeHostError('');
        await fetchPtyAgentsRef.current();
        await Promise.resolve(refreshSessions());
        console.info('[agent-hub][pty] persisted fullscreen recovery resumed saved terminal snapshot', {
          previousPtyId: activePtyId,
          resumedPtyId: resumed.id,
          recoveryKey: fullscreenTerminalRecoveryKey,
        });
      } catch (error) {
        setRuntimeHostError((prev) => preserveSpecificDisconnectedRuntimeMessage(prev, failureMessage));
        console.warn('[agent-hub][pty] persisted fullscreen recovery failed from saved snapshot', {
          previousPtyId: activePtyId,
          recoveryKey: fullscreenTerminalRecoveryKey,
          innerSessionId: fullscreenTerminalRecovery.innerSessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        autoResumeInFlightHistoricalSessionKeysRef.current.delete(fullscreenTerminalRecoveryKey);
        setPersistedFullscreenAutoResumeKey((prev) => (
          prev === fullscreenTerminalRecoveryKey ? null : prev
        ));
      }
    })();
  }, [
    activeEmbeddedRuntimeHostId,
    activePtyId,
    fetchPtyAgentsRef,
    fullscreenTerminalRecovery,
    fullscreenTerminalRecoveryKey,
    hasLoadedPtyAgents,
    embeddedRuntimeHostIdentitySettling,
    isActivePtyDisconnected,
    isSessionPtyDisconnected,
    knownPtyIds,
    matchedFullscreenRecoverySession,
    openPtyTerminal,
    persistedFullscreenAutoResumeKey,
    refreshSessions,
    attemptDisconnectedTerminalSessionResume,
    runtimeTargetModeValue,
    runtimeServiceStatus?.startedAt,
  ]);

  useEffect(() => {
    if (!hasLoadedPtyAgents) {
      return;
    }

    dashboardSessions.forEach((session) => {
      if (!isRecoverableTerminalSession(session) || !isSessionPtyDisconnected(session)) {
        deferredAutoResumeDecisionSignaturesRef.current.delete(session.id);
      }
    });

    const prioritizedSessions: SessionInfo[] = [];
    const prioritizedSessionIds = new Set<string>();
    const pushPrioritizedSession = (session: SessionInfo | null | undefined) => {
      if (
        !session
        || prioritizedSessionIds.has(session.id)
        || !isRecoverableTerminalSession(session)
        || !isSessionPtyDisconnected(session)
      ) {
        return;
      }
      prioritizedSessionIds.add(session.id);
      prioritizedSessions.push(session);
    };

    pushPrioritizedSession(activeDisconnectedPtySession);

    dashboardSessions.forEach((session) => {
      if (session !== activeDisconnectedPtySession && tiledPaneOrder.includes(session.id)) {
        pushPrioritizedSession(session);
      }
    });

    if (viewMode === 'sessions') {
      dashboardSessions.forEach((session) => {
        pushPrioritizedSession(session);
      });
    }

    const nextRecoverableSession = prioritizedSessions.find((session) => (
      !autoResumeAttemptedSessionIdsRef.current.has(session.id)
      && deferredAutoResumeDecisionSignaturesRef.current.get(session.id)
        !== buildDisconnectedTerminalSessionDecisionSignature(session)
    ));

    if (!nextRecoverableSession) {
      return;
    }

    console.info('[agent-hub][pty] scheduling disconnected terminal auto-resume', {
      sessionId: nextRecoverableSession.id,
      ptyId: nextRecoverableSession.pty_id ?? null,
      innerSessionId: nextRecoverableSession.inner_session_id ?? null,
      sourceHostId: nextRecoverableSession.source_host_id ?? null,
      activePtyId: activePtyId ?? null,
    });
    void resumeDisconnectedTerminalSession(nextRecoverableSession);
  }, [
    activePtyId,
    activeDisconnectedPtySession,
    dashboardSessions,
    hasLoadedPtyAgents,
    isSessionPtyDisconnected,
    resumeDisconnectedTerminalSession,
    tiledPaneOrder,
    viewMode,
  ]);

  useEffect(() => {
    if (useMockData || !hasLoadedPtyAgents || tiledPaneOrder.length === 0) {
      return;
    }

    const sessionById = new Map(dashboardSessions.map((session) => [session.id, session]));
    let nextPaneOrder = tiledPaneOrder;
    let didRebind = false;

    tiledPaneOrder.forEach((sessionId) => {
      const session = sessionById.get(sessionId);
      const innerSessionId = session?.inner_session_id?.trim();
      if (
        !session
        || !innerSessionId
        || !isOpenRecoverableTerminalSession(session)
        || !isSessionPtyDisconnected(session)
      ) {
        return;
      }

      const canonicalSession = resolveOccupiedHistoricalSession(innerSessionId);
      if (
        !canonicalSession
        || canonicalSession.id === session.id
        || isSessionPtyDisconnected(canonicalSession)
      ) {
        return;
      }

      nextPaneOrder = replacePaneOrderSessionId(nextPaneOrder, session.id, canonicalSession.id);
      didRebind = true;
      console.info('[agent-hub][pty] rebound tiled pane from disconnected historical session to canonical live session', {
        previousSessionId: session.id,
        canonicalSessionId: canonicalSession.id,
        innerSessionId,
        previousPtyId: session.pty_id ?? null,
        canonicalPtyId: canonicalSession.pty_id ?? null,
      });
    });

    if (didRebind) {
      setTiledPaneOrder((prev) => (
        prev.join('\u0000') === tiledPaneOrder.join('\u0000')
          ? nextPaneOrder
          : prev
      ));
    }
  }, [
    dashboardSessions,
    hasLoadedPtyAgents,
    isSessionPtyDisconnected,
    resolveOccupiedHistoricalSession,
    tiledPaneOrder,
    useMockData,
  ]);

  useEffect(() => {
    if (useMockData || !hasLoadedPtyAgents) {
      return;
    }

    dashboardSessions.forEach((session) => {
      const innerSessionId = session.inner_session_id?.trim();
      if (!innerSessionId) {
        supersededSessionDecisionSignaturesRef.current.delete(session.id);
        return;
      }
      const canonicalSession = resolveOccupiedHistoricalSession(innerSessionId);
      if (!canonicalSession || canonicalSession.id === session.id) {
        supersededSessionDecisionSignaturesRef.current.delete(session.id);
      }
    });

    const supersededSessions = dashboardSessions
      .map((session) => {
        const innerSessionId = session.inner_session_id?.trim();
        if (!innerSessionId || !isOpenRecoverableTerminalSession(session)) {
          return null;
        }

        const canonicalSession = resolveOccupiedHistoricalSession(innerSessionId);
        if (!canonicalSession || canonicalSession.id === session.id) {
          return null;
        }
        if (isSessionPtyDisconnected(canonicalSession)) {
          return null;
        }

        const decisionSignature = buildSupersededTerminalSessionDecisionSignature(session, canonicalSession);
        if (retiringSupersededSessionIdsRef.current.has(session.id)) {
          return null;
        }
        if (supersededSessionDecisionSignaturesRef.current.get(session.id) === decisionSignature) {
          return null;
        }

        return { session, canonicalSession, decisionSignature };
      })
      .filter((value): value is {
        session: SessionInfo;
        canonicalSession: SessionInfo;
        decisionSignature: string;
      } => value !== null);

    if (supersededSessions.length === 0) {
      return;
    }

    let cancelled = false;
    const reconcileSupersededSessions = async () => {
      for (const { session, canonicalSession, decisionSignature } of supersededSessions) {
        if (cancelled) {
          return;
        }

        retiringSupersededSessionIdsRef.current.add(session.id);
        try {
          await reconcileSupersededTerminalSession(session, canonicalSession);
          supersededSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
        } catch (error) {
          console.warn('[agent-hub][pty] failed to retire superseded terminal session', {
            sessionId: session.id,
            supersededBySessionId: canonicalSession.id,
            innerSessionId: session.inner_session_id ?? null,
            ptyId: session.pty_id ?? null,
            sourceHostId: session.source_host_id ?? null,
            message: error instanceof Error ? error.message : String(error),
          });
          supersededSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
        } finally {
          retiringSupersededSessionIdsRef.current.delete(session.id);
        }
      }
    };

    void reconcileSupersededSessions();

    return () => {
      cancelled = true;
    };
  }, [
    dashboardSessions,
    hasLoadedPtyAgents,
    isSessionPtyDisconnected,
    reconcileSupersededTerminalSession,
    resolveOccupiedHistoricalSession,
    useMockData,
  ]);

  useEffect(() => {
    if (useMockData || !hasLoadedPtyAgents) {
      return;
    }

    dashboardSessions.forEach((session) => {
      const shouldPreserveDecisionSignature = session.interaction_mode === 'terminal' && (
        (!!session.pty_id && isSessionPtyDisconnected(session))
        || (!session.pty_id && hasRecoverableTerminalSessionSnapshot(session))
      );
      if (!shouldPreserveDecisionSignature) {
        disconnectedSessionDecisionSignaturesRef.current.delete(session.id);
      }
    });

    const staleSessions = dashboardSessions.filter((session) => {
      const decisionSignature = buildDisconnectedTerminalSessionDecisionSignature(session);
      if (autoCompletingDisconnectedSessionIdsRef.current.has(session.id)) {
        return false;
      }
      if (disconnectedSessionDecisionSignaturesRef.current.get(session.id) === decisionSignature) {
        return false;
      }
      if (autoResumeInFlightSessionIdsRef.current.has(session.id)) {
        return false;
      }
      if (autoResumingSessionIdsRef.current.has(session.id)) {
        return false;
      }
      if (session.interaction_mode !== 'terminal') {
        return false;
      }
      if (!shouldAutoCompleteDisconnectedTerminalSession(session)) {
        return false;
      }
      if (!isSessionPtyDisconnected(session)) {
        return false;
      }
      if (!canJudgePtyPresenceForHost(session.source_host_id)) {
        return false;
      }
      return true;
    });

    if (staleSessions.length === 0) {
      return;
    }

    let cancelled = false;
    const reconcileDisconnectedSessions = async () => {
      for (const session of staleSessions) {
        if (cancelled) {
          return;
        }

        const decisionSignature = buildDisconnectedTerminalSessionDecisionSignature(session);
        autoCompletingDisconnectedSessionIdsRef.current.add(session.id);
        try {
          const shouldFallbackToActiveRuntimeHost = canFallbackToActiveRuntimeHostForSession(session);
          const matchedSourceHost = resolveRuntimeHostBySourceHostId(session.source_host_id);
          const preferredHistoricalBindingSessionIds = isTerminalSessionPendingHistoricalBinding(session)
            ? getPreferredHistoricalBindingSessionIds(session)
            : [];
          if (shouldKeepFreshPendingHistoricalBindingSessionActive(session, {
            loadedPtyHostId,
            activeEmbeddedRuntimeHostId,
            pendingPtyPresenceIds,
            allowRuntimeHostFallback: shouldFallbackToActiveRuntimeHost,
          })) {
            console.info('[agent-hub][pty] keep disconnected terminal session active because historical binding is still pending', {
              sessionId: session.id,
              ptyId: session.pty_id ?? null,
              sourceHostId: session.source_host_id ?? null,
              agentType: session.agent_kind,
              loadedPtyHostId,
              activeEmbeddedRuntimeHostId,
              pendingPtyPresenceKnown: Boolean(session.pty_id && pendingPtyPresenceIds.has(session.pty_id)),
              allowRuntimeHostFallback: shouldFallbackToActiveRuntimeHost,
            });
            disconnectedSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
            continue;
          }

          if (
            isTerminalSessionPendingHistoricalBinding(session)
            && hasRecoverablePendingHistoricalBindingContext(session)
            && preferredHistoricalBindingSessionIds.length > 0
            && (!session.source_host_id || matchedSourceHost || shouldFallbackToActiveRuntimeHost)
          ) {
            console.info('[agent-hub][pty] keep disconnected terminal session active because historical binding already has a preferred recovery candidate', {
              sessionId: session.id,
              ptyId: session.pty_id ?? null,
              sourceHostId: session.source_host_id ?? null,
              agentType: session.agent_kind,
              preferredHistoricalBindingSessionIds,
              allowRuntimeHostFallback: shouldFallbackToActiveRuntimeHost,
            });
            disconnectedSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
            continue;
          }

          const recoverableSnapshot = buildRecoverableTerminalSessionSnapshot(session);
          if (recoverableSnapshot) {
            const shouldDeferUnavailableSourceHostCompletion = shouldDeferUnavailableSourceHostHandling(
              session,
              matchedSourceHost,
            );
            if (shouldDeferUnavailableSourceHostCompletion) {
              console.info('[agent-hub][pty] keep disconnected terminal session active while embedded runtime is restarting', {
                sessionId: session.id,
                ptyId: session.pty_id ?? null,
                sourceHostId: session.source_host_id ?? null,
                runtimeRunning: runtimeServiceStatus?.running ?? null,
                runtimeStartedAt: runtimeServiceStatus?.startedAt ?? null,
              });
              continue;
            }
            if (session.source_host_id && !matchedSourceHost && !shouldFallbackToActiveRuntimeHost) {
              await completeDisconnectedTerminalSession(session, 'source-host-unavailable');
              disconnectedSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
              continue;
            }

            const host = matchedSourceHost ?? resolveActiveRuntimeHost();
            const runtimeBaseUrl = resolveRuntimeHostBaseUrl(host);
            let hasMatchingHistoricalRecord = false;
            try {
              hasMatchingHistoricalRecord = await hasMatchingHistoricalSessionSnapshotRecord(
                runtimeBaseUrl,
                recoverableSnapshot,
                host.authToken,
              );
            } catch (error) {
              console.warn('[agent-hub][pty] skipped auto-completing disconnected recoverable session because historical lookup failed', {
                sessionId: session.id,
                ptyId: session.pty_id ?? null,
                sourceHostId: session.source_host_id ?? null,
                message: error instanceof Error ? error.message : String(error),
              });
              disconnectedSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
              continue;
            }
            if (cancelled) {
              return;
            }
            if (hasMatchingHistoricalRecord) {
              console.info('[agent-hub][pty] keep disconnected terminal session active because it is still recoverable', {
                sessionId: session.id,
                ptyId: session.pty_id,
                sourceHostId: session.source_host_id ?? null,
                innerSessionId: session.inner_session_id ?? null,
              });
              disconnectedSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
              continue;
            }

            await completeDisconnectedTerminalSession(session, 'historical-session-missing');
            disconnectedSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
            continue;
          }

          await completeDisconnectedTerminalSession(session, 'pty-missing');
          disconnectedSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
        } catch (error) {
          console.warn('[agent-hub][pty] failed to auto-complete disconnected terminal session', {
            sessionId: session.id,
            ptyId: session.pty_id ?? null,
            sourceHostId: session.source_host_id ?? null,
            message: error instanceof Error ? error.message : String(error),
          });
          disconnectedSessionDecisionSignaturesRef.current.set(session.id, decisionSignature);
        } finally {
          autoCompletingDisconnectedSessionIdsRef.current.delete(session.id);
        }
      }
    };

    void reconcileDisconnectedSessions();
    return () => {
      cancelled = true;
    };
  }, [
    activeEmbeddedRuntimeHostId,
    canFallbackToActiveRuntimeHostForSession,
    canJudgePtyPresenceForHost,
    completeDisconnectedTerminalSession,
    dashboardSessions,
    getPreferredHistoricalBindingSessionIds,
    hasLoadedPtyAgents,
    isSessionPtyDisconnected,
    loadedPtyHostId,
    pendingPtyPresenceIds,
    resolveRuntimeHostBySourceHostId,
    shouldDeferUnavailableSourceHostHandling,
    runtimeServiceStatus?.running,
    runtimeServiceStatus?.startedAt,
    runtimeTargetModeValue,
    useMockData,
  ]);

  const refreshRuntimeSnapshot = async (
    statusOverride: RuntimeServiceStatus | null = runtimeServiceStatus,
  ) => {
    await syncLocalMeshHosts(statusOverride);
    const snapshot = await getRuntimeManager().refreshSnapshot();
    const nextPtyConnection = resolvePtySpawnConnectionTarget({
      runtimeHostSnapshots: snapshot.hosts,
      selectedTarget: getSelectedRuntimeTarget(),
      runtimeServiceStatus: statusOverride,
    });
    await replayConfirmedMeshPeers(statusOverride, snapshot);
    applyRuntimeSnapshot(snapshot);
    await refreshSignalRoutesFromSnapshot(snapshot);
    await fetchPtyAgents(nextPtyConnection);
  };
  const resumeRecoverableTiledSlot = useCallback(async (slotId: string) => {
    const slot = tiledPaneSlots.find((candidate) => candidate.slotId === slotId);
    const snapshot = slot?.terminalRecovery;
    const targetLayoutId = tiledActiveLayoutId;
    if (!snapshot) {
      return;
    }

    const matchedSession = resolveOccupiedHistoricalSession(snapshot.innerSessionId);
    if (matchedSession && matchesRecoverableTerminalSessionSnapshot(matchedSession, snapshot)) {
      applySessionToNamedTiledWorkbenchLayout({
        sessionId: matchedSession.id,
        slotId,
        layoutId: targetLayoutId,
      });
      return;
    }

    const host = resolveRuntimeHostBySourceHostId(snapshot.sourceHostId) ?? resolveActiveRuntimeHost();
    const connection = resolveRuntimeConnectionForHostId(host.hostId ?? snapshot.sourceHostId ?? null);

    try {
      const resumed = await resumeHistoricalPtySnapshot({
        rtBaseUrl: connection.rtBaseUrl,
        authToken: connection.authToken,
        snapshot,
      });
      setPendingSpawnedPtyBindings((prev) => (
        prev.some((entry) => entry.ptyId === resumed.id)
          ? prev
          : [...prev, {
              ptyId: resumed.id,
              slotId,
              layoutId: targetLayoutId,
            }]
      ));
      openPtyTerminal(resumed.id, host.hostId ?? snapshot.sourceHostId, {
        expectFreshPresence: true,
        reconnectIfSame: true,
      });
      setRuntimeHostError('');
      await refreshRuntimeSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeHostError(`Terminal 恢复失败：${message}`);
    }
  }, [
    applySessionToNamedTiledWorkbenchLayout,
    resolveOccupiedHistoricalSession,
    openPtyTerminal,
    refreshRuntimeSnapshot,
    resolveRuntimeHostBySourceHostId,
    resolveRuntimeConnectionForHostId,
    tiledActiveLayoutId,
    tiledPaneSlots,
  ]);

  useEffect(() => {
    let disposed = false;
    const service = getAgentHubService();
    const runtimeControlService = getRuntimeControlService();

    const load = async () => {
      try {
        const [nextDevice, nextRuntimeStatus] = await Promise.all([
          service.getDeviceView(),
          runtimeControlService.getStatus(),
        ]);
        await syncLocalMeshHosts(nextRuntimeStatus);
        const nextRuntimeSnapshot = await getRuntimeManager().refreshSnapshot();
        if (disposed) return;
        await replayConfirmedMeshPeers(nextRuntimeStatus, nextRuntimeSnapshot);
        setDeviceGroups(nextDevice);
        setRuntimeServiceStatus(nextRuntimeStatus);
        applyRuntimeSnapshot(nextRuntimeSnapshot);
        await refreshSignalRoutesFromSnapshot(nextRuntimeSnapshot, () => disposed);
        await fetchPtyAgents(resolvePtySpawnConnectionTarget({
          runtimeHostSnapshots: nextRuntimeSnapshot.hosts,
          selectedTarget: getSelectedRuntimeTarget(),
          runtimeServiceStatus: nextRuntimeStatus,
        }));
      } catch (error) {
        console.warn('[agent-hub][poll] initial runtime load failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const refreshInterval = setInterval(() => {
      void (async () => {
        try {
          const nextRuntimeStatus = await runtimeControlService.getStatus();
          await syncLocalMeshHosts(nextRuntimeStatus);
          const nextRuntimeSnapshot = await getRuntimeManager().refreshSnapshot();
          if (disposed) return;
          await replayConfirmedMeshPeers(nextRuntimeStatus, nextRuntimeSnapshot);
          setRuntimeServiceStatus(nextRuntimeStatus);
          applyRuntimeSnapshot(nextRuntimeSnapshot);
          await refreshSignalRoutesFromSnapshot(nextRuntimeSnapshot, () => disposed);
          await fetchPtyAgents(resolvePtySpawnConnectionTarget({
            runtimeHostSnapshots: nextRuntimeSnapshot.hosts,
            selectedTarget: getSelectedRuntimeTarget(),
            runtimeServiceStatus: nextRuntimeStatus,
          }));
        } catch (error) {
          console.warn('[agent-hub][poll] runtime refresh failed', {
            message: error instanceof Error ? error.message : String(error),
          });
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

  const refreshRuntimeHosts = async (
    statusOverride: RuntimeServiceStatus | null = runtimeServiceStatus,
  ) => {
    await syncLocalMeshHosts(statusOverride);
    const nextSnapshot = await getRuntimeManager().refreshSnapshot();
    await replayConfirmedMeshPeers(statusOverride, nextSnapshot);
    applyRuntimeSnapshot(nextSnapshot);
    await refreshSignalRoutesFromSnapshot(nextSnapshot);
  };

  useEffect(() => {
    runtimeHostSnapshotsRef.current = runtimeHostSnapshots;
  }, [runtimeHostSnapshots]);

  useEffect(() => {
    runtimeServiceStatusRef.current = runtimeServiceStatus;
  }, [runtimeServiceStatus]);

  useEffect(() => {
    if (runtimeServiceStatus?.running && runtimeServiceStatus.hostId) {
      return;
    }

    inFlightLinkProofPeerIdsRef.current.clear();
    inFlightLinkProofSessionIdsRef.current.clear();
  }, [runtimeServiceStatus?.running, runtimeServiceStatus?.hostId]);

  useEffect(() => {
    refreshRuntimeHostsRef.current = refreshRuntimeHosts;
  }, [refreshRuntimeHosts]);

  const trackInFlightLinkProof = (
    peerId: string,
    proofSessionId?: string,
  ): (() => void) => {
    inFlightLinkProofPeerIdsRef.current.add(peerId);
    if (proofSessionId) {
      inFlightLinkProofSessionIdsRef.current.add(proofSessionId);
    }

    return () => {
      inFlightLinkProofPeerIdsRef.current.delete(peerId);
      if (proofSessionId) {
        inFlightLinkProofSessionIdsRef.current.delete(proofSessionId);
      }
    };
  };

  const maybeAutoAdoptManualLinkProofRequest = useMemo(() => (
    (event: SignalEvent) => {
      if (!runtimeLinkProofService) {
        return;
      }

      const request = parseLinkProofRequestPayload(event);
      const localStatus = runtimeServiceStatusRef.current;
      if (!request || request.trigger !== 'manual_retry' || !localStatus?.hostId) {
        return;
      }
      if (
        request.target_peer_id !== localStatus.hostId
        || request.initiated_by_peer_id === localStatus.hostId
      ) {
        return;
      }
      if (autoAdoptedLinkProofEventIdsRef.current.has(event.id)) {
        return;
      }
      if (
        inFlightLinkProofPeerIdsRef.current.has(request.initiated_by_peer_id)
        || inFlightLinkProofSessionIdsRef.current.has(request.proof_session_id)
      ) {
        autoAdoptedLinkProofEventIdsRef.current.add(event.id);
        return;
      }

      const targetSnapshot = runtimeHostSnapshotsRef.current.find((item) => (
        item.host.trustState === 'confirmed_peer'
        && resolveRuntimeSnapshotPeerId(item) === request.initiated_by_peer_id
      ));
      if (!targetSnapshot) {
        return;
      }
      if (targetSnapshot.host.verificationStatus === 'running') {
        return;
      }

      const localHostId = localStatus.hostId;
      if (!localHostId) {
        return;
      }

      autoAdoptedLinkProofEventIdsRef.current.add(event.id);
      const releaseInFlightLinkProof = trackInFlightLinkProof(
        request.initiated_by_peer_id,
        request.proof_session_id,
      );

      // Auto-adopt manual device-page verification so one-sided "测试互联" can complete end-to-end.
      void (async () => {
        try {
          await runtimeLinkProofService.runVerification({
            mode: 'joiner',
            localPeerId: localHostId,
            peerId: request.initiated_by_peer_id,
            runtimeHostRecordId: targetSnapshot.host.id,
            adoptedRequestEvent: event,
            trigger: 'manual_retry',
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(
            `[AgentsPage] auto-adopt link proof failed peer=${request.initiated_by_peer_id} session=${request.proof_session_id} error=${message}`,
          );
        } finally {
          releaseInFlightLinkProof();
          const latestStatus = runtimeServiceStatusRef.current;
          if (!latestStatus) {
            return;
          }

          try {
            await refreshRuntimeHostsRef.current(latestStatus);
          } catch {
            // Passive refresh is best-effort（被动刷新失败不应打断验证结果落盘）.
          }
        }
      })();
    }
  ), [runtimeLinkProofService]);

  useEffect(() => {
    if (
      !localLinkProofSignalService
      || !runtimeLinkProofService
      || !runtimeServiceStatus?.running
      || !runtimeServiceStatus.hostId
    ) {
      return;
    }

    autoAdoptedLinkProofEventIdsRef.current.clear();

    const unsubscribe = localLinkProofSignalService.onSignal(maybeAutoAdoptManualLinkProofRequest);

    localLinkProofSignalService.start();

    return () => {
      unsubscribe();
      localLinkProofSignalService.stop();
    };
  }, [
    localLinkProofSignalService,
    runtimeLinkProofService,
    maybeAutoAdoptManualLinkProofRequest,
    runtimeServiceStatus?.running,
    runtimeServiceStatus?.hostId,
  ]);

  useEffect(() => {
    if (
      !localLinkProofSignalService
      || !runtimeLinkProofService
      || !runtimeServiceStatus?.running
      || !runtimeServiceStatus.hostId
    ) {
      return;
    }

    let disposed = false;
    let cursor: string | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNextPoll = () => {
      if (disposed) {
        return;
      }
      timer = setTimeout(() => {
        void poll();
      }, MANUAL_LINK_PROOF_ADOPTION_POLL_INTERVAL_MS);
    };

    const poll = async () => {
      if (disposed) {
        return;
      }

      try {
        const events = await localLinkProofSignalService.history({
          limit: 50,
          topicPrefix: LINK_PROOF_TOPIC_PREFIX,
          afterEventId: cursor,
        });

        if (events.length > 0) {
          cursor = events[events.length - 1]?.id;
        }

        for (const event of events) {
          maybeAutoAdoptManualLinkProofRequest(event);
        }
      } catch {
        // History fallback is best-effort（兜底轮询失败时等待下一轮重试）.
      }

      scheduleNextPoll();
    };

    void (async () => {
      try {
        const latestEvents = await localLinkProofSignalService.history({
          limit: 50,
          topicPrefix: LINK_PROOF_TOPIC_PREFIX,
        });
        if (latestEvents.length > 0) {
          cursor = latestEvents[latestEvents.length - 1]?.id;
        }
      } catch {
        // Bootstrap failure is non-fatal（初始化游标失败不影响后续轮询重试）.
      }

      scheduleNextPoll();
    })();

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    localLinkProofSignalService,
    runtimeLinkProofService,
    maybeAutoAdoptManualLinkProofRequest,
    runtimeServiceStatus?.running,
    runtimeServiceStatus?.hostId,
  ]);

  const handleAddRuntimeHostFromManagerSheet = async () => {
    try {
      setRuntimeHostError('');
      const selectedTarget = getSelectedRuntimeTarget();
      let authToken: string | undefined;
      if (selectedTarget.mode === 'external' && selectedTarget.authToken) {
        const trimmedAddress = runtimeHostModalAddress.trim();
        const normalizedAddress = trimmedAddress.includes(':')
          ? parseRuntimeAddress(trimmedAddress)
          : { host: trimmedAddress, port: DEFAULT_EXTERNAL_RUNTIME_PORT };
        if (
          normalizedAddress.host === selectedTarget.host
          && normalizedAddress.port === selectedTarget.port
        ) {
          authToken = selectedTarget.authToken;
        }
      }
      await getRuntimeManager().addHostFromAddress(
        runtimeHostModalAddress,
        runtimeHostModalName.trim(),
        authToken,
      );
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

  const handleVerifyRuntimePeer = async (hostId: string) => {
    const targetSnapshot = runtimeHostSnapshots.find((item) => item.host.id === hostId);
    if (!targetSnapshot) {
      setRuntimeHostError(`runtime host not found（未找到目标节点）: ${hostId}`);
      return;
    }

    if (!runtimeServiceStatus?.running || !runtimeServiceStatus.hostId) {
      setRuntimeHostError('请先启动本机内嵌 RT，再执行测试互联。');
      return;
    }

    const targetPeerId = resolveRuntimeSnapshotPeerId(targetSnapshot);
    if (!targetPeerId) {
      setRuntimeHostError('目标节点缺少 peer_id，暂时无法验证互通。');
      return;
    }

    if (!runtimeLinkProofService) {
      setRuntimeHostError('链路验证服务尚未就绪，请稍后重试。');
      return;
    }
    if (inFlightLinkProofPeerIdsRef.current.has(targetPeerId)) {
      setRuntimeHostError('该节点正在验证互通，请等待当前结果。');
      return;
    }

    const releaseInFlightLinkProof = trackInFlightLinkProof(targetPeerId);

    try {
      setRuntimeHostError('');
      await runtimeHostService.mergeHostMetadata(hostId, {
        verificationStatus: 'running',
        lastVerificationTrigger: 'manual_retry',
        lastVerificationError: null,
        localInitiatedRttMs: null,
        peerInitiatedRttMs: null,
      });

      await runtimeLinkProofService.runVerification({
        mode: 'owner',
        localPeerId: runtimeServiceStatus.hostId,
        peerId: targetPeerId,
        runtimeHostRecordId: hostId,
        trigger: 'manual_retry',
      });

      await refreshRuntimeHosts(runtimeServiceStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeHostError(message);

      try {
        await runtimeHostService.mergeHostMetadata(hostId, {
          verificationStatus: 'failed',
          lastVerificationTrigger: 'manual_retry',
          lastVerificationError: message,
          localInitiatedRttMs: null,
          peerInitiatedRttMs: null,
        });
        await refreshRuntimeHosts(runtimeServiceStatus);
      } catch {
        // Ignore secondary persistence failures（次级持久化失败仅保留页面错误文案）。
      }
    } finally {
      releaseInFlightLinkProof();
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
      setHasExplicitEmbeddedRuntimeNetworkMode(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeTargetError(message);
    }
  };

  const handleApplyRuntimeExternalAddress = async () => {
    const runtimeControlService = getRuntimeControlService();
    try {
      setRuntimeTargetError('');
      await setPersistedRuntimeExternalAuthToken(runtimeExternalAuthTokenDraft);
      await setPersistedRuntimeExternalAddress(runtimeExternalAddressDraft);
      await setPersistedRuntimeTargetMode('external');
      const appliedTarget = getSelectedRuntimeTarget();
      await syncMatchingExternalTargetAuthToken(appliedTarget);
      syncRuntimeTargetState(appliedTarget);
      setRuntimeServiceStatus(await runtimeControlService.getStatus());
      await refreshRuntimeSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeTargetError(message);
    }
  };

  const handleRuntimeStart = async () => {
    if (runtimeStartInFlightRef.current) {
      await runtimeStartInFlightRef.current;
      return;
    }

    const task = (async () => {
      const runtimeControlService = getRuntimeControlService();
      const targetHost = desiredEmbeddedRuntimeHost;
      const targetPort = desiredEmbeddedRuntimePort;
      try {
        const status = await runtimeControlService.startRuntime({
          host: targetHost,
          port: targetPort,
        });
        setRuntimeServiceStatus(status);
        await refreshRuntimeSnapshot(status);
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
    })();

    runtimeStartInFlightRef.current = task;
    try {
      await task;
    } finally {
      runtimeStartInFlightRef.current = null;
    }
  };

  const handleRuntimeStop = async () => {
    const runtimeControlService = getRuntimeControlService();
    const fallbackHost = runtimeServiceStatus?.host ?? desiredEmbeddedRuntimeHost;
    const fallbackPort = runtimeServiceStatus?.port ?? desiredEmbeddedRuntimePort;
    try {
      const status = await runtimeControlService.stopRuntime();
      setRuntimeServiceStatus(status);
      await refreshRuntimeSnapshot(status);
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

  useEffect(() => {
    if (hasExplicitEmbeddedRuntimeNetworkMode || !runtimeServiceStatus?.running) {
      return;
    }

    const observedMode = inferEmbeddedRuntimeNetworkMode(runtimeServiceStatus);
    setEmbeddedRuntimeNetworkModeValue((current) => (current === observedMode ? current : observedMode));
  }, [hasExplicitEmbeddedRuntimeNetworkMode, runtimeServiceStatus]);

  useEffect(() => {
    if (
      runtimeTargetModeValue !== 'embedded'
      || !runtimeServiceStatus?.running
      || !runtimeNeedsRebind
    ) {
      autoRuntimeRebindKeyRef.current = null;
      return;
    }

    const rebindKey = [
      runtimeServiceStatus.host,
      runtimeServiceStatus.port,
      desiredEmbeddedRuntimeHost,
      desiredEmbeddedRuntimePort,
    ].join('->');

    if (autoRuntimeRebindKeyRef.current === rebindKey) {
      return;
    }

    autoRuntimeRebindKeyRef.current = rebindKey;
    void handleRuntimeStart();
  }, [
    desiredEmbeddedRuntimeHost,
    desiredEmbeddedRuntimePort,
    runtimeNeedsRebind,
    runtimeServiceStatus,
    runtimeTargetModeValue,
  ]);

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
    return buildPtyGraphNodes(ptyAgents, dashboardSessions);
  }, [dashboardSessions, ptyAgents]);
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
          isSessionStopping={(session) => isTerminalSessionResolutionPending(session)}
          onRefresh={refreshSessions}
          onSessionClick={(session) => {
            void handleOpenSessionTerminal(session);
          }}
          onStopSession={(session) => {
            if (session.interaction_mode === 'terminal') {
              void handleResolveTerminalSession(session);
              return;
            }
            void handleCloseSessionWithoutPty(session);
          }}
          onArchiveSession={(session) => {
            void handleArchiveSession(session);
          }}
        />
      );
    }
    if (viewMode === 'tiled') {
      return (
        <div className={`relative flex h-full min-h-0 flex-col ${tiledImmersive ? 'gap-3' : 'gap-2'}`}>
          <div className={`flex items-center justify-between gap-3 ${
            tiledImmersive
              ? 'rounded-lg border border-[#E7E5E4] bg-white/90 px-3 py-2 shadow-sm backdrop-blur dark:border-[#292524] dark:bg-[#0C0A09]/90'
              : ''
          }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">
                {activeTiledSessions.length} 个会话
              </span>
              <GlobalStatusIndicator sessions={activeTiledSessions} />
              {tiledPassthroughArmed ? (
                <span
                  data-testid="agents-tiled-passthrough-armed"
                  className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                    tiledImmersive
                      ? 'border border-[#C75B3A]/30 bg-white/90 text-[#9A3412] shadow-sm dark:border-[#7C2D12] dark:bg-[#1C1917]/90 dark:text-[#FDBA74]'
                      : 'border border-[#FED7AA] bg-[#FFF7ED] text-[#9A3412] dark:border-[#7C2D12] dark:bg-[#1C1917] dark:text-[#FDBA74]'
                  }`}
                >
                  透传下一键
                </span>
              ) : null}
            </div>
            {tiledImmersive ? (
              <button
                type="button"
                onClick={toggleTiledImmersive}
                className="rounded-full border border-[#D6D3D1] bg-white/90 px-3 py-1 text-xs text-[#57534E] shadow-sm backdrop-blur dark:border-[#44403C] dark:bg-[#1C1917]/90 dark:text-[#D6D3D1]"
              >
                退出沉浸
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleTiledUnassignedPool}
                  className="rounded-md border border-[#D6D3D1] px-2 py-1 text-[10px] font-medium text-[#57534E] hover:border-[#C75B3A]/40 hover:text-[#1C1917] dark:border-[#44403C] dark:text-[#D6D3D1]"
                >
                  未分配 {tiledUnassignedSessions.length}
                </button>
                <button
                  type="button"
                  onClick={toggleTiledImmersive}
                  className="rounded-md border border-[#D6D3D1] px-2 py-1 text-[10px] font-medium text-[#57534E] hover:border-[#C75B3A]/40 hover:text-[#1C1917] dark:border-[#44403C] dark:text-[#D6D3D1]"
                >
                  沉浸
                </button>
                <div className="flex items-center gap-1 rounded-md border border-[#E7E5E4] bg-[#FAFAF9] px-1.5 py-1 dark:border-[#292524] dark:bg-[#1C1917]">
                  <select
                    data-testid="agents-tiled-layout-select"
                    value={tiledActiveLayoutId}
                    onChange={(event) => switchTiledWorkbenchLayout(event.target.value)}
                    className="h-6 rounded border border-[#E7E5E4] bg-white px-2 text-[10px] text-[#1C1917] outline-none dark:border-[#44403C] dark:bg-[#0C0A09] dark:text-[#FAFAF9]"
                  >
                    {tiledWorkbenchLayoutOrder.map((layoutId) => (
                      <option key={layoutId} value={layoutId}>
                        {tiledWorkbenchLayouts[layoutId]?.name ?? layoutId}
                      </option>
                    ))}
                  </select>
                  <input
                    data-testid="agents-tiled-layout-name-input"
                    value={tiledActiveLayoutNameDraft}
                    onChange={(event) => {
                      setTiledActiveLayoutNameDraft(event.target.value);
                    }}
                    onBlur={() => {
                      commitActiveTiledLayoutName(tiledActiveLayoutNameDraft);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitActiveTiledLayoutName(tiledActiveLayoutNameDraft);
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        setTiledActiveLayoutNameDraft(tiledActiveLayoutRecord?.name ?? '默认布局');
                      }
                    }}
                    placeholder="布局名称"
                    className="h-6 w-24 rounded border border-[#E7E5E4] bg-white px-2 text-[10px] text-[#1C1917] outline-none placeholder:text-[#A8A29E] dark:border-[#44403C] dark:bg-[#0C0A09] dark:text-[#FAFAF9]"
                  />
                  <button
                    type="button"
                    data-testid="agents-tiled-layout-new"
                    onClick={createEmptyTiledWorkbenchLayout}
                    className="rounded-md border border-[#D6D3D1] px-2 py-1 text-[10px] font-medium text-[#57534E] hover:border-[#C75B3A]/40 hover:text-[#1C1917] dark:border-[#44403C] dark:text-[#D6D3D1]"
                  >
                    新建
                  </button>
                  <button
                    type="button"
                    data-testid="agents-tiled-layout-duplicate"
                    onClick={duplicateActiveTiledWorkbenchLayout}
                    className="rounded-md border border-[#D6D3D1] px-2 py-1 text-[10px] font-medium text-[#57534E] hover:border-[#C75B3A]/40 hover:text-[#1C1917] dark:border-[#44403C] dark:text-[#D6D3D1]"
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    data-testid="agents-tiled-layout-delete"
                    onClick={deleteActiveTiledWorkbenchLayout}
                    disabled={tiledWorkbenchLayoutOrder.length <= 1}
                    className="rounded-md border border-[#D6D3D1] px-2 py-1 text-[10px] font-medium text-[#57534E] hover:border-[#C75B3A]/40 hover:text-[#1C1917] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#44403C] dark:text-[#D6D3D1]"
                  >
                    删除
                  </button>
                </div>
                <LayoutSelector value={tiledLayout} onChange={handleTiledLayoutChange} />
              </div>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <TiledGrid
              sessions={activeTiledSessions}
              layout={tiledLayout}
              tree={tiledPaneTree}
              slots={tiledPaneSlots}
              resolveSessionConnection={resolveRuntimeConnectionForSession}
              isSessionDisconnected={isSessionPtyDisconnected}
              isSessionAutoResuming={(session) => autoResumingSessionIds.includes(session.id)}
              isSessionStopping={(session) => isTerminalSessionResolutionPending(session)}
              focusedIndex={tiledFocusedIndex}
              onFocusPane={handleTiledFocusPane}
              focusedSlotId={tiledFocusedSlotId}
              onFocusSlot={setTiledFocusedSlotId}
              paneOrder={tiledPaneOrder}
              onReorder={setTiledPaneOrder}
              onQuickAction={(session, response) => {
                void handleSessionQuickAction(session, response);
              }}
              onMarkWaiting={(session) => {
                void handleSessionMarkWaiting(session);
              }}
              onStopSession={(session) => {
                if (session.interaction_mode === 'terminal') {
                  void handleResolveTerminalSession(session);
                  return;
                }
                void handleCloseSessionWithoutPty(session);
              }}
              onArchiveSession={(session) => {
                void handleArchiveSession(session);
              }}
              onSplitSlot={splitTiledSlot}
              onResizeSplit={resizeTiledSplit}
              onClearSlot={clearTiledSlot}
              onCloseSlot={closeTiledSlot}
              onOpenEmptySlot={openPtySpawnDialogForSlot}
              onResumeRecoverableSlot={(slotId) => {
                void resumeRecoverableTiledSlot(slotId);
              }}
              unassignedSessions={tiledUnassignedSessions}
              unassignedPoolCollapsed={tiledUnassignedPoolCollapsed}
              onToggleUnassignedPool={toggleTiledUnassignedPool}
              onAssignSessionToSlot={bindSessionToTiledSlot}
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
          embeddedRuntimeNetworkMode={effectiveEmbeddedRuntimeNetworkMode}
          embeddedRuntimeBindAddress={desiredEmbeddedRuntimeAddress}
          runtimeNeedsRebind={runtimeNeedsRebind}
          runtimeTargetMode={runtimeTargetModeValue}
          runtimeTargetAddress={runtimeTargetAddress}
          runtimeTargetError={runtimeTargetError}
          runtimeExternalAddressDraft={runtimeExternalAddressDraft}
          runtimeExternalAuthTokenDraft={runtimeExternalAuthTokenDraft}
          onRuntimeHostProbe={handleProbeRuntimeHost}
          onVerifyPeer={handleVerifyRuntimePeer}
          onEmbeddedRuntimeNetworkModeChange={handleEmbeddedRuntimeNetworkModeChange}
          onRuntimeStart={handleRuntimeStart}
          onRuntimeStop={handleRuntimeStop}
          onRuntimeTargetModeChange={handleRuntimeTargetModeChange}
          onRuntimeExternalAddressDraftChange={setRuntimeExternalAddressDraft}
          onRuntimeExternalAuthTokenDraftChange={setRuntimeExternalAuthTokenDraft}
          onApplyRuntimeExternalAddress={handleApplyRuntimeExternalAddress}
          onOpenHostManager={() => setHostManagerOpen(true)}
          onOpenPeerPairing={() => setPeerPairingOpen(true)}
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
            const matchingPty = ptyAgents.find((pty) => pty.id === ptyId);
            const matchingSession = findSessionForPty(ptyId, dashboardSessions, {
              preferredSourceHostId: matchingPty?.sourceHostId ?? null,
            });
            const resolvedPtyId = matchingPty?.id ?? matchingSession?.pty_id ?? ptyId;
            const resolvedHostId = matchingSession?.source_host_id ?? matchingPty?.sourceHostId;
            console.info('[agent-hub][pty][open] requested', {
              origin: 'topology-node',
              sessionId: matchingSession?.id ?? null,
              ptyId: resolvedPtyId,
              sourceHostId: resolvedHostId ?? null,
              status: matchingSession?.status ?? null,
            });
            if (supportsInlineRightPanel) {
              if (!matchingSession) {
                setFullscreenTerminalRecovery((prev) => (prev ? null : prev));
              }
              openPtyTerminal(resolvedPtyId, resolvedHostId, {
                reconnectIfSame: true,
              });
              console.info('[agent-hub][pty][open] terminal panel opened', {
                origin: 'topology-node',
                sessionId: matchingSession?.id ?? null,
                ptyId: resolvedPtyId,
                sourceHostId: resolvedHostId ?? null,
              });
            } else {
              const connection = resolveRuntimeConnectionForHostId(resolvedHostId);
              const ptyParams = new URLSearchParams({ baseUrl: connection.rtBaseUrl });
              const tok = connection.authToken;
              const ptyState: Record<string, unknown> = tok ? { ptyToken: tok } : {};
              navigateToSecondaryPage(`/agents/pty/${encodeURIComponent(resolvedPtyId)}?${ptyParams.toString()}`, ptyState);
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
    tiledActiveLayoutId,
    tiledActiveLayoutNameDraft,
    tiledActiveLayoutRecord,
    tiledFocusedIndex,
    tiledPaneOrder,
    tiledWorkbenchLayoutOrder,
    tiledWorkbenchLayouts,
    activeTiledSessions,
    commitActiveTiledLayoutName,
    createEmptyTiledWorkbenchLayout,
    deleteActiveTiledWorkbenchLayout,
    duplicateActiveTiledWorkbenchLayout,
    handleTiledLayoutChange,
    handleTiledFocusPane,
    bindSessionToTiledSlot,
    clearTiledSlot,
    closeTiledSlot,
    splitTiledSlot,
    resizeTiledSplit,
    openPtySpawnDialogForSlot,
    toggleTiledImmersive,
    toggleTiledUnassignedPool,
    tiledFocusedSlotId,
    tiledImmersive,
    tiledPassthroughArmed,
    tiledPaneSlots,
    tiledPaneTree,
    tiledUnassignedPoolCollapsed,
    tiledUnassignedSessions,
    switchTiledWorkbenchLayout,
    resolveRuntimeConnectionForSession,
    resolveRuntimeConnectionForHostId,
    isPtyStopPending,
    supportsInlineRightPanel,
  ]);

  const isTiledWorkbenchImmersive = viewMode === 'tiled' && tiledImmersive;

  return (
    <div
      data-testid="agent-hub-page"
      className="relative flex h-full min-h-full flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]"
    >
      {!isTiledWorkbenchImmersive ? (
        <>
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
                  onClick={() => openPtySpawnDialogForSlot(viewMode === 'tiled' ? tiledFocusedSlotId : null)}
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
        </>
      ) : null}

      {/* 主内容区：桌面端三栏（内容区 + 右侧栏），移动端单栏 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 内容区 */}
        <div className={`flex-1 min-h-0 ${viewMode === 'topology' || viewMode === 'tiled' ? 'overflow-hidden' : 'overflow-auto'} ${viewMode === 'topology' ? '' : viewMode === 'tiled' ? 'px-2 py-2' : 'px-5 pb-[calc(env(safe-area-inset-bottom,0px)+108px)] pt-3 md:px-8 md:pb-6 lg:px-10'}`}>
          {runtimeHostError && (
            <button
              type="button"
              data-testid="agent-runtime-error-banner"
              onClick={() => {
                setRuntimeHostError('');
              }}
              className="mb-3 block w-full rounded-lg bg-red-50 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              {runtimeHostError}
            </button>
          )}
          {content}
        </div>

        {/* 右侧栏：桌面端可拖拽调整宽度。
            当 PTY 终端活跃时，关闭面板只隐藏 aside（display:none），
            PtyTerminal 保持挂载 → SSE 连接不断 → 终端状态持久化。
            但平铺视图本身已经占用 PTY，因此不额外挂载右栏终端，避免重复加载。 */}
        {viewMode !== 'tiled' && (rightPanel.state !== 'CLOSED' || activePtyId != null) && (
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
                      const connection = resolveRuntimeConnectionForHostId(resolvedActivePtyHostId);
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
                {rightPanel.state === 'PTY_TERMINAL' && rightPanel.ptyId && canArchiveActivePtySession ? (
                  <button
                    type="button"
                    data-testid="agent-rightpanel-archive-session"
                    onClick={() => {
                      void handleArchiveActivePtySession();
                    }}
                    className="flex h-7 items-center justify-center rounded px-2 text-xs text-muted-foreground hover:text-foreground"
                    aria-label="归档 Terminal 会话"
                  >
                    归档
                  </button>
                ) : rightPanel.state === 'PTY_TERMINAL' && rightPanel.ptyId ? (
                  <button
                    type="button"
                    data-testid="agent-rightpanel-stop-pty"
                    onClick={() => {
                      void handleStopPtyAgent(rightPanel.ptyId!, resolvedActivePtyHostId);
                    }}
                    disabled={isPtyStopPending(rightPanel.ptyId)}
                    className="flex h-7 items-center justify-center rounded px-2 text-xs text-destructive hover:text-destructive/80 disabled:opacity-60"
                    aria-label="结束 Terminal Agent"
                  >
                    {isPtyStopPending(rightPanel.ptyId) ? '停止中' : '结束'}
                  </button>
                ) : null}
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
                                {formatSignalPayloadDetails(historyEvent.payload)}
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
                (() => {
                  const connection = resolveRuntimeConnectionForHostId(resolvedActivePtyHostId);
                  return (
                    <div
                      data-testid="agent-rightpanel-pty-terminal"
                      className="flex h-full flex-col overflow-hidden"
                      style={rightPanel.state !== 'PTY_TERMINAL' ? { display: 'none' } : undefined}
                    >
                      <div className="relative flex-1 overflow-hidden bg-[#1C1917]">
                        <PtyTerminal
                          key={activePtyTerminalKey ?? activePtyId}
                          rtBaseUrl={connection.rtBaseUrl}
                          ptyId={activePtyId}
                          authToken={connection.authToken}
                          onInitialConnectionFailure={() => {
                            void handleActivePtyInitialConnectionFailure(activePtyId, resolvedActivePtyHostId);
                          }}
                        />
                        {isActivePtyDisconnected ? (
                          <div
                            data-testid="agent-rightpanel-pty-disconnected"
                            className="absolute inset-0 flex flex-col"
                          >
                            <div className="space-y-1 border-b border-[#292524] bg-[#1C1917]/92 px-4 py-3 text-xs text-[#A8A29E] backdrop-blur-sm">
                              <p>
                                {isActivePtyAutoResuming
                                  ? `${activeRecoverableTerminalLabel} 会话恢复中，成功后会自动切回实时终端。`
                                  : '当前 PTY 已不存在，RT 可能已经重启。下方保留关闭前历史；如需结束，可点击上方“结束”收敛后归档。'}
                              </p>
                              {runtimeHostError && (
                                <p
                                  data-testid="agent-rightpanel-pty-disconnected-message"
                                  className="text-[#FCA5A5]"
                                >
                                  {runtimeHostError}
                                </p>
                              )}
                            </div>
                            {isActivePtyAutoResuming ? (
                              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[#E7E5E4]">
                                正在恢复 {activeRecoverableTerminalLabel} 历史会话...
                              </div>
                            ) : (
                              <div className="flex-1" />
                            )}
                            <div className="border-t border-[#292524] bg-[#1C1917]/92 px-4 py-2 backdrop-blur-sm">
                              <button
                                type="button"
                                data-testid="agent-rightpanel-pty-disconnected-close"
                                onClick={() => {
                                  setActivePtyId(null);
                                  setActivePtyHostId(null);
                                  closeRightPanel();
                                }}
                                className="rounded border border-[#44403C] px-3 py-1.5 text-xs text-[#E7E5E4] hover:border-[#57534E]"
                              >
                                关闭终端
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </aside>
          </>
        )}
      </div>

      {/* PTY Spawn Dialog */}
      <PtySpawnDialog
        open={showPtySpawnDialog}
        onOpenChange={(open) => {
          setShowPtySpawnDialog(open);
          if (!open) {
            setPtySpawnTargetSlotId(null);
            setPtySpawnTargetLayoutId(null);
          }
        }}
        rtBaseUrl={ptySpawnConnection.rtBaseUrl}
        authToken={ptySpawnConnection.authToken}
        defaultWorkdir={import.meta.env.VITE_PTY_DEFAULT_WORKDIR ?? ''}
        occupiedHistoricalSessionIds={occupiedHistoricalSessionIds}
        occupiedHistoricalSessionLabels={occupiedHistoricalSessionLabels}
        onSpawned={(info) => {
          const matchingSession = dashboardSessions.find((session) => session.pty_id === info.id);
          if (matchingSession) {
            applySessionToNamedTiledWorkbenchLayout({
              sessionId: matchingSession.id,
              ...(ptySpawnTargetSlotId ? { slotId: ptySpawnTargetSlotId } : {}),
              ...(ptySpawnTargetLayoutId ? { layoutId: ptySpawnTargetLayoutId } : {}),
            });
          }
          if (!matchingSession) {
            setPendingSpawnedPtyBindings((prev) => (
              prev.some((entry) => entry.ptyId === info.id)
                ? prev
                : [...prev, {
                    ptyId: info.id,
                    slotId: ptySpawnTargetSlotId,
                    layoutId: ptySpawnTargetLayoutId,
                  }]
            ));
            setFullscreenTerminalRecovery((prev) => (prev ? null : prev));
            setPersistedFullscreenAutoResumeKey(null);
          }
          setPtySpawnTargetSlotId(null);
          setPtySpawnTargetLayoutId(null);
          openPtyTerminal(info.id, ptySpawnConnection.hostId, {
            expectFreshPresence: true,
            reconnectIfSame: true,
          });
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
      <PeerPairingDialog
        open={peerPairingOpen}
        onOpenChange={setPeerPairingOpen}
        runtimeBaseUrl={peerPairingRuntimeBaseUrl}
        localHostId={peerPairingLocalHostId}
        localAuthToken={peerPairingLocalAuthToken}
        knownHosts={peerPairingKnownHosts}
        onPairingSuccess={refreshRuntimeSnapshot}
      />
    </div>
  );
}
