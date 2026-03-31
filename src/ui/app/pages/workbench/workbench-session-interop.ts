import type { SessionInfo } from '@/lib/types/session';

export type WorkbenchLegacyIntent =
  | { source: 'agents-hub'; route: '/agents' }
  | { source: 'agent-chat'; route: string; agentId: string };

export type WorkbenchSessionStatus = 'running' | 'waiting' | 'idle' | 'error';

export type WorkbenchSessionKind = 'agent' | 'terminal';

export type WorkbenchSessionObjectReadModel = {
  id: string;
  sessionKind: WorkbenchSessionKind;
  interactionMode: SessionInfo['interaction_mode'];
  title: string;
  summary: string;
  status: WorkbenchSessionStatus;
  agentId?: string;
  ptyId?: string;
  sourceHostId?: string;
  sourceHostAddress?: string;
  legacyIntent?: {
    route: string;
    agentId: string;
  };
};

export type WorkbenchRuntimeBindingReadModel = {
  sessionId: string;
  bindingType: 'agent-session' | 'pty-runtime' | 'ssh-runtime';
  runtimeRef: string;
  runtimeKey: string;
  hostId?: string;
  hostAddress?: string;
};

export type WorkbenchSessionProjection = {
  sessions: WorkbenchSessionObjectReadModel[];
  bindings: WorkbenchRuntimeBindingReadModel[];
  activeLegacySessionId?: string;
};

function mapSessionStatus(status: SessionInfo['status']): WorkbenchSessionStatus {
  switch (status) {
    case 'running':
      return 'running';
    case 'waiting_input':
      return 'waiting';
    case 'error':
      return 'error';
    case 'completed':
    case 'paused':
    case 'archived':
    default:
      return 'idle';
  }
}

function buildRuntimeKey(hostId: string | undefined, runtimeRef: string): string {
  return `${hostId ?? 'default'}::${runtimeRef}`;
}

export function mapSessionInfoToSessionObject(
  session: SessionInfo,
): WorkbenchSessionObjectReadModel {
  return {
    id: session.id,
    sessionKind: session.interaction_mode === 'terminal' ? 'terminal' : 'agent',
    interactionMode: session.interaction_mode,
    title: session.role || session.summary || 'Untitled Session',
    summary: session.summary || session.last_output_preview || '',
    status: mapSessionStatus(session.status),
    agentId: session.agent_id,
    ptyId: session.pty_id,
    sourceHostId: session.source_host_id,
    sourceHostAddress: session.source_host_address,
  };
}

export function mapSessionInfoToRuntimeBinding(
  session: SessionInfo,
): WorkbenchRuntimeBindingReadModel {
  if (session.interaction_mode === 'terminal' && session.pty_id) {
    return {
      sessionId: session.id,
      bindingType: 'pty-runtime',
      runtimeRef: session.pty_id,
      runtimeKey: buildRuntimeKey(session.source_host_id, session.pty_id),
      hostId: session.source_host_id,
      hostAddress: session.source_host_address,
    };
  }

  if (session.interaction_mode === 'terminal') {
    const runtimeRef = `session:${session.id}`;
    return {
      sessionId: session.id,
      bindingType: 'ssh-runtime',
      runtimeRef,
      runtimeKey: buildRuntimeKey(session.source_host_id, session.id),
      hostId: session.source_host_id,
      hostAddress: session.source_host_address,
    };
  }

  const runtimeRef = `agent:${session.agent_id ?? session.id}`;
  return {
    sessionId: session.id,
    bindingType: 'agent-session',
    runtimeRef,
    runtimeKey: buildRuntimeKey(session.source_host_id, runtimeRef),
    hostId: session.source_host_id,
    hostAddress: session.source_host_address,
  };
}

export function buildWorkbenchSessionProjection(
  sessions: SessionInfo[],
): WorkbenchSessionProjection {
  return {
    sessions: sessions.map(mapSessionInfoToSessionObject),
    bindings: sessions.map(mapSessionInfoToRuntimeBinding),
  };
}

export function mergeWorkbenchLegacyIntentIntoProjection(
  projection: WorkbenchSessionProjection,
  legacyIntent: WorkbenchLegacyIntent | null,
): WorkbenchSessionProjection {
  if (!legacyIntent || legacyIntent.source !== 'agent-chat') {
    return projection;
  }

  const activeLegacySession = projection.sessions.find((session) => (
    session.agentId === legacyIntent.agentId
  ));

  if (!activeLegacySession) {
    return projection;
  }

  return {
    ...projection,
    activeLegacySessionId: activeLegacySession.id,
    sessions: projection.sessions.map((session) => (
      session.id === activeLegacySession.id
        ? {
            ...session,
            title: `Agent Chat / ${legacyIntent.agentId}`,
            legacyIntent: {
              route: legacyIntent.route,
              agentId: legacyIntent.agentId,
            },
          }
        : session
    )),
  };
}
