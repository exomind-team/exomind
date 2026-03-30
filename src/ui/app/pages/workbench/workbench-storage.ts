export const WORKBENCH_PHASE1_STORAGE_KEY = 'exomind:workbench:phase1-flat:v1';

export type WorkbenchBindingType =
  | 'agent-session'
  | 'pty-runtime'
  | 'ssh-runtime'
  | 'browser-runtime';

export type WorkbenchViewKind = 'session-view' | 'runtime-view' | 'inspector-view';

export type WorkbenchPaneStatus = 'running' | 'attached' | 'ready' | 'idle' | 'error';

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
  | {
      source: 'agents-hub';
      route: '/agents';
    }
  | {
      source: 'agent-chat';
      route: string;
      agentId: string;
    };

function createDefaultWorkbenchFlatState(nowIso: string): WorkbenchFlatState {
  return {
    version: 1,
    space: {
      id: 'default-space',
      name: 'Agent Workbench',
      restoredAt: nowIso,
    },
    surface: {
      id: 'surface-main',
      layoutPreset: 'flat-2up',
    },
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
  'idle',
  'error',
];

function isWorkbenchPaneState(value: unknown): value is WorkbenchPaneState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<WorkbenchPaneState>;
  return typeof candidate.id === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.viewKind === 'string'
    && WORKBENCH_VIEW_KINDS.includes(candidate.viewKind as WorkbenchViewKind)
    && typeof candidate.bindingType === 'string'
    && WORKBENCH_BINDING_TYPES.includes(candidate.bindingType as WorkbenchBindingType)
    && typeof candidate.status === 'string'
    && WORKBENCH_PANE_STATUSES.includes(candidate.status as WorkbenchPaneStatus)
    && typeof candidate.description === 'string';
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

function isLegacyWorkbenchFlatState(value: unknown): value is {
  version: 1;
  space: WorkbenchSpaceState;
  panes: Array<{
    id: string;
    title: string;
    runtimeKind: 'agent-session' | 'ssh-runtime';
    status: 'running' | 'attached';
    description: string;
  }>;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as {
    version?: number;
    space?: WorkbenchSpaceState;
    panes?: Array<{
      id: string;
      title: string;
      runtimeKind: 'agent-session' | 'ssh-runtime';
      status: 'running' | 'attached';
      description: string;
    }>;
  };

  return candidate.version === 1
    && !!candidate.space
    && typeof candidate.space.id === 'string'
    && typeof candidate.space.name === 'string'
    && typeof candidate.space.restoredAt === 'string'
    && Array.isArray(candidate.panes)
    && candidate.panes.every((pane) =>
      typeof pane.id === 'string'
      && typeof pane.title === 'string'
      && (pane.runtimeKind === 'agent-session' || pane.runtimeKind === 'ssh-runtime')
      && (pane.status === 'running' || pane.status === 'attached')
      && typeof pane.description === 'string'
    );
}

function normalizeLegacyWorkbenchFlatState(legacy: {
  version: 1;
  space: WorkbenchSpaceState;
  panes: Array<{
    id: string;
    title: string;
    runtimeKind: 'agent-session' | 'ssh-runtime';
    status: 'running' | 'attached';
    description: string;
  }>;
}): WorkbenchFlatState {
  return {
    version: legacy.version,
    space: legacy.space,
    surface: {
      id: 'surface-main',
      layoutPreset: 'flat-2up',
    },
    panes: legacy.panes.map((pane) => ({
      id: pane.id,
      title: pane.title,
      viewKind: pane.runtimeKind === 'agent-session' ? 'session-view' : 'runtime-view',
      bindingType: pane.runtimeKind,
      status: pane.status,
      description: pane.description,
    })),
  };
}

function parseWorkbenchFlatState(raw: string): WorkbenchFlatState | null {
  const parsed = JSON.parse(raw) as unknown;

  if (isWorkbenchFlatState(parsed)) {
    return parsed;
  }

  if (isLegacyWorkbenchFlatState(parsed)) {
    return normalizeLegacyWorkbenchFlatState(parsed);
  }

  return null;
}

function isWorkbenchFlatState(value: unknown): value is WorkbenchFlatState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<WorkbenchFlatState>;
  const space = candidate.space as Partial<WorkbenchSpaceState> | undefined;
  const surface = candidate.surface as Partial<WorkbenchSurfaceState> | undefined;

  return candidate.version === 1
    && !!space
    && typeof space.id === 'string'
    && typeof space.name === 'string'
    && typeof space.restoredAt === 'string'
    && !!surface
    && isWorkbenchSurfaceState(surface)
    && hasValidWorkbenchPanes(candidate.panes);
}

export function writeWorkbenchFlatState(state: WorkbenchFlatState): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(WORKBENCH_PHASE1_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage is a best-effort cache during Phase 1 bootstrap.
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

export function readOrCreateWorkbenchFlatState(now: () => string = () => new Date().toISOString()): WorkbenchFlatState {
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
    return {
      source: 'agents-hub',
      route: '/agents',
    };
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
  if (!intent) {
    return state;
  }

  if (intent.source !== 'agent-chat') {
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
    };
  });

  return {
    ...state,
    panes,
  };
}
