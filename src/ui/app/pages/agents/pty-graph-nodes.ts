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
  sourceHostId?: string;
}

export function findSessionForPty(
  ptyId: string,
  sessions: SessionInfo[],
  options: {
    preferredSourceHostId?: string | null;
  } = {},
): SessionInfo | undefined {
  const matches = sessions.filter((session) => session.pty_id === ptyId);
  if (matches.length === 0) {
    return undefined;
  }

  if (options.preferredSourceHostId) {
    const preferredMatch = matches.find((session) => (
      session.source_host_id === options.preferredSourceHostId
    ));
    if (preferredMatch) {
      return preferredMatch;
    }
  }

  return matches[0];
}

export function buildPtyGraphNodes(
  ptyAgents: PtyGraphAgent[],
  sessions: SessionInfo[],
): SignalGraphNode[] {
  return ptyAgents.map((pty, idx) => {
    const matchingSession = findSessionForPty(pty.id, sessions, {
      preferredSourceHostId: pty.sourceHostId ?? null,
    });

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
