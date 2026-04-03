import type { SessionInfo } from '@/lib/types/session';
import {
  buildWorkbenchSessionProjection,
  type WorkbenchSessionProjection,
} from './workbench-session-interop';

export const WORKBENCH_PHASE1_STORAGE_KEY = 'exomind:workbench:phase1-flat:v1';

export type WorkbenchBindingType =
  | 'agent-session'
  | 'pty-runtime'
  | 'ssh-runtime'
  | 'browser-runtime';

export type WorkbenchViewKind = 'session-view' | 'runtime-view' | 'inspector-view';

export type WorkbenchPaneStatus =
  | 'running'
  | 'attached'
  | 'ready'
  | 'waiting'
  | 'idle'
  | 'error';

export type WorkbenchSurfaceState = {
  id: string;
  layoutPreset: 'flat-2up' | 'flat-stack';
};

export type WorkbenchPaneState = {
  id: string;
  title: string;
  viewKind: WorkbenchViewKind;
  bindingType: WorkbenchBindingType;
  status: WorkbenchPaneStatus;
  description: string;
  sessionId?: string;
  agentId?: string;
  ptyId?: string;
  /**
   * Navigation path / 导航路径:
   * agent-session -> legacy chat（旧聊天页）
   * runtime pane -> legacy agents hub（旧网络页）
   */
  openPath?: string;
};

export type WorkbenchSpaceState = {
  id: string;
  name: string;
  restoredAt: string;
};

export type WorkbenchFlatState = {
  version: 1;
  space: WorkbenchSpaceState;
  surface: WorkbenchSurfaceState;
  panes: WorkbenchPaneState[];
};

export type WorkbenchLegacyIntent =
  | { source: 'agents-hub'; route: '/agents' }
  | { source: 'agent-chat'; route: string; agentId: string };

const WORKBENCH_BINDING_TYPES: WorkbenchBindingType[] = [
  'agent-session',
  'pty-runtime',
  'ssh-runtime',
  'browser-runtime',
];

const WORKBENCH_VIEW_KINDS: WorkbenchViewKind[] = [
  'session-view',
  'runtime-view',
  'inspector-view',
];

const WORKBENCH_PANE_STATUSES: WorkbenchPaneStatus[] = [
  'running',
  'attached',
  'ready',
  'waiting',
  'idle',
  'error',
];

function createDefaultWorkbenchFlatState(nowIso: string): WorkbenchFlatState {
  return {
    version: 1,
    space: { id: 'default-space', name: 'Agent Workbench', restoredAt: nowIso },
    surface: { id: 'surface-main', layoutPreset: 'flat-2up' },
    panes: [
      {
        id: 'pane-agent-daily',
        title: 'Daily Agent Session',
        viewKind: 'session-view',
        bindingType: 'agent-session',
        status: 'running',
        description: 'Primary agent-backed session / 主会话面板',
      },
      {
        id: 'pane-ssh-ops',
        title: 'SSH Runtime',
        viewKind: 'runtime-view',
        bindingType: 'ssh-runtime',
        status: 'attached',
        description: 'Remote shell attachment / 远程终端挂接',
      },
    ],
  };
}

function isWorkbenchPaneState(value: unknown): value is WorkbenchPaneState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<WorkbenchPaneState>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.viewKind === 'string'
    && WORKBENCH_VIEW_KINDS.includes(candidate.viewKind as WorkbenchViewKind)
    && typeof candidate.bindingType === 'string'
    && WORKBENCH_BINDING_TYPES.includes(candidate.bindingType as WorkbenchBindingType)
    && typeof candidate.status === 'string'
    && WORKBENCH_PANE_STATUSES.includes(candidate.status as WorkbenchPaneStatus)
  );
}

function isWorkbenchSurfaceState(value: unknown): value is WorkbenchSurfaceState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<WorkbenchSurfaceState>;
  return typeof candidate.id === 'string'
    && (candidate.layoutPreset === 'flat-2up' || candidate.layoutPreset === 'flat-stack');
}

function hasValidWorkbenchPanes(value: unknown): value is WorkbenchPaneState[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((pane) => isWorkbenchPaneState(pane));
}

function isLegacyWorkbenchFlatState(_value: unknown): boolean {
  return false;
}

function normalizeLegacyWorkbenchFlatState(_legacy: unknown): WorkbenchFlatState {
  throw new Error('legacy migration not implemented in this commit');
}

function isWorkbenchFlatState(value: unknown): value is WorkbenchFlatState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<WorkbenchFlatState>;
  const space = candidate.space as Partial<WorkbenchSpaceState> | undefined;
  const surface = candidate.surface as Partial<WorkbenchSurfaceState> | undefined;

  return (
    candidate.version === 1
    && !!space
    && typeof space.id === 'string'
    && typeof space.name === 'string'
    && typeof space.restoredAt === 'string'
    && !!surface
    && isWorkbenchSurfaceState(surface)
    && hasValidWorkbenchPanes(candidate.panes)
  );
}

function parseWorkbenchFlatState(raw: string): WorkbenchFlatState | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isWorkbenchFlatState(parsed)) {
      return parsed;
    }
    if (isLegacyWorkbenchFlatState(parsed)) {
      return normalizeLegacyWorkbenchFlatState(parsed);
    }
  } catch {
    return null;
  }

  return null;
}

export function writeWorkbenchFlatState(state: WorkbenchFlatState): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(WORKBENCH_PHASE1_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort cache only / 尽力缓存即可。
  }
}

export function readWorkbenchFlatState(): WorkbenchFlatState | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WORKBENCH_PHASE1_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return parseWorkbenchFlatState(raw);
  } catch {
    return null;
  }
}

export function readOrCreateWorkbenchFlatState(
  now: () => string = () => new Date().toISOString(),
): WorkbenchFlatState {
  const stored = readWorkbenchFlatState();
  if (stored) {
    return stored;
  }

  const created = createDefaultWorkbenchFlatState(now());
  writeWorkbenchFlatState(created);
  return created;
}

export function resolveWorkbenchLegacyIntent(search: string): WorkbenchLegacyIntent | null {
  const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(normalizedSearch);
  const legacySource = params.get('legacySource');

  if (legacySource === 'agents-hub') {
    return { source: 'agents-hub', route: '/agents' };
  }

  if (legacySource === 'agent-chat') {
    const agentId = params.get('agentId');
    if (!agentId) {
      return null;
    }
    return {
      source: 'agent-chat',
      route: `/agents/chat/${agentId}`,
      agentId,
    };
  }

  return null;
}

export function applyWorkbenchLegacyIntent(
  state: WorkbenchFlatState,
  intent: WorkbenchLegacyIntent | null,
): WorkbenchFlatState {
  if (!intent || intent.source !== 'agent-chat') {
    return state;
  }

  let didApplyAgentChatHandoff = false;
  const panes = state.panes.map((pane) => {
    if (didApplyAgentChatHandoff || pane.bindingType !== 'agent-session') {
      return pane;
    }

    didApplyAgentChatHandoff = true;
    return {
      ...pane,
      title: `Agent Chat / ${intent.agentId}`,
      description: `Legacy handoff from ${intent.route} / 来自旧聊天入口的接力`,
      agentId: intent.agentId,
      openPath: `${intent.route}?workbenchBypass=true`,
    };
  });

  return { ...state, panes };
}

export function buildWorkbenchPaneHref(session: SessionInfo): string {
  const focusSession = `/agents?workbenchBypass=true&focusSession=${encodeURIComponent(session.id)}`;
  if (session.interaction_mode === 'terminal') {
    return focusSession;
  }

  const agentId = session.agent_id?.trim();
  if (!agentId) {
    return focusSession;
  }

  return `/agents/chat/${encodeURIComponent(agentId)}?workbenchBypass=true`;
}

function readFallbackWorkbenchPanes(): WorkbenchPaneState[] {
  const stored = readWorkbenchFlatState();
  if (stored?.panes.length) {
    return stored.panes;
  }

  return createDefaultWorkbenchFlatState(new Date().toISOString()).panes;
}

export function mergeWorkbenchPaneState(
  runtimePanes: WorkbenchPaneState[],
  fallbackPanes?: WorkbenchPaneState[],
): WorkbenchPaneState[] {
  if (runtimePanes.length > 0) {
    return runtimePanes;
  }

  if (fallbackPanes && fallbackPanes.length > 0) {
    return fallbackPanes;
  }

  return readFallbackWorkbenchPanes();
}

export function buildWorkbenchPanesFromProjection(
  projection: WorkbenchSessionProjection,
  fallbackPanes?: WorkbenchPaneState[],
): WorkbenchPaneState[] {
  const runtimePanes = projection.sessions.map((session): WorkbenchPaneState => {
    const binding = projection.bindings.find((candidate) => candidate.sessionId === session.id);
    const bindingType = binding?.bindingType ?? 'agent-session';
    const viewKind: WorkbenchViewKind = bindingType === 'agent-session'
      ? 'session-view'
      : 'runtime-view';
    const status: WorkbenchPaneStatus = bindingType === 'pty-runtime' && session.status === 'running'
      ? 'attached'
      : session.status;

    return {
      id: `pane-${session.id}`,
      title: session.title,
      viewKind,
      bindingType,
      status,
      description: session.legacyIntent
        ? `Legacy handoff from ${session.legacyIntent.route} / 来自旧聊天入口的接力`
        : (session.summary || 'Runtime session pane / 运行时会话面板'),
      sessionId: session.id,
      agentId: session.agentId,
      ptyId: session.ptyId,
      openPath: bindingType === 'agent-session'
        ? `/agents/chat/${encodeURIComponent(session.agentId ?? session.id)}?workbenchBypass=true`
        : `/agents?workbenchBypass=true&focusSession=${encodeURIComponent(session.id)}`,
    };
  });

  return mergeWorkbenchPaneState(runtimePanes, fallbackPanes);
}

export function buildWorkbenchPanesFromSessions(
  sessions: SessionInfo[],
  fallbackPanes?: WorkbenchPaneState[],
): WorkbenchPaneState[] {
  return buildWorkbenchPanesFromProjection(
    buildWorkbenchSessionProjection(sessions),
    fallbackPanes,
  );
}
