import type { SessionInfo } from '@/lib/types/session';
import {
  AGENT_KIND_LABELS,
  SESSION_STATUS_INDICATORS,
} from '@/lib/types/session';
import type { SignalGraphNode } from '../agents-signal-topology';

export interface PtyGraphAgent {
  id: string;
  name: string;
  status: string;
  workdir: string;
}

export function findSessionForPty(
  ptyId: string,
  sessions: SessionInfo[],
): SessionInfo | undefined {
  return sessions.find((session) => session.pty_id === ptyId);
}

export function buildPtyGraphNodes(
  ptyAgents: PtyGraphAgent[],
  sessions: SessionInfo[],
): SignalGraphNode[] {
  return ptyAgents.map((pty, idx) => {
    const matchingSession = findSessionForPty(pty.id, sessions);

    return {
      id: `pty-${pty.id}`,
      type: 'agent' as const,
      label: matchingSession?.role || pty.name,
      status: matchingSession
        ? `${AGENT_KIND_LABELS[matchingSession.agent_kind]} · ${SESSION_STATUS_INDICATORS[matchingSession.status].label}`
        : (pty.status === 'running' ? 'Terminal · running' : 'Terminal · offline'),
      position: { x: 600, y: 80 + idx * 100 },
    };
  });
}
