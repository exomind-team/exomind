import { useEffect, useRef, useState, useCallback } from 'react';
import type { SessionInfo } from '@/lib/types/session';

export interface SessionStreamTarget {
  id: string;
  rtBaseUrl: string;
  authToken?: string;
  hostName?: string;
  hostAddress?: string;
}

/** Hook options */
export interface UseSessionStreamOptions {
  /** Base URL for the runtime API (e.g., "http://127.0.0.1:1949") */
  rtBaseUrl: string | null;
  /** Auth token for the runtime API */
  authToken?: string;
  /** Optional multi-host targets（多主机会话源） */
  targets?: SessionStreamTarget[];
  /** Whether to enable the stream */
  enabled?: boolean;
}

/** Hook return value */
export interface UseSessionStreamResult {
  /** Current list of sessions */
  sessions: SessionInfo[];
  /** Whether initial fetch is loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Manually refresh session list */
  refresh: () => void;
}

/**
 * Hook that fetches sessions from the runtime and subscribes to SSE updates.
 * Uses a single multiplexed SSE connection for all session events.
 */
export function useSessionStream({
  rtBaseUrl,
  authToken,
  targets,
  enabled = true,
}: UseSessionStreamOptions): UseSessionStreamResult {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourcesRef = useRef<EventSource[]>([]);
  const supportsEventSource = typeof EventSource !== 'undefined';

  const resolvedTargets = (targets && targets.length > 0)
    ? targets
    : (rtBaseUrl
      ? [{
          id: rtBaseUrl,
          rtBaseUrl,
          authToken,
          hostAddress: rtBaseUrl,
        }]
      : []);

  const decorateSession = useCallback(
    (session: SessionInfo, target: SessionStreamTarget): SessionInfo => ({
      ...session,
      source_host_id: target.id,
      source_host_name: target.hostName,
      source_host_address: target.hostAddress ?? target.rtBaseUrl,
    }),
    [],
  );

  const buildSessionKey = useCallback(
    (session: Pick<SessionInfo, 'id' | 'source_host_id'>, targetId?: string) => (
      `${targetId ?? session.source_host_id ?? 'default'}::${session.id}`
    ),
    [],
  );

  const fetchSessions = useCallback(async () => {
    if (resolvedTargets.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(resolvedTargets.map(async (target) => {
        const headers: Record<string, string> = {};
        if (target.authToken) headers['Authorization'] = `Bearer ${target.authToken}`;
        const response = await fetch(`${target.rtBaseUrl}/sessions`, { headers });
        if (!response.ok) {
          throw new Error(`${target.hostName ?? target.rtBaseUrl}: HTTP ${response.status}`);
        }
        const data: SessionInfo[] = await response.json();
        return data.map((session) => decorateSession(session, target));
      }));
      setSessions(results.flat());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [decorateSession, resolvedTargets]);

  // Initial fetch + SSE subscription
  useEffect(() => {
    for (const eventSource of eventSourcesRef.current) {
      eventSource.close();
    }
    eventSourcesRef.current = [];

    if (!enabled || resolvedTargets.length === 0) {
      setSessions([]);
      return;
    }

    // Tests and non-browser environments may not provide EventSource.
    // In real browsers this stays always-on; in unsupported environments we no-op.
    if (!supportsEventSource) {
      return;
    }

    // Fetch initial data
    void fetchSessions();

    for (const target of resolvedTargets) {
      const streamUrl = target.authToken
        ? `${target.rtBaseUrl}/sessions/stream?token=${encodeURIComponent(target.authToken)}`
        : `${target.rtBaseUrl}/sessions/stream`;
      const es = new EventSource(streamUrl);
      eventSourcesRef.current.push(es);

      const handleEvent = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          setSessions((prev) => {
            switch (event.type) {
              case 'session.created': {
                const session = decorateSession(data.session as SessionInfo, target);
                const sessionKey = buildSessionKey(session);
                if (prev.some((item) => buildSessionKey(item) === sessionKey)) return prev;
                return [session, ...prev];
              }
              case 'session.updated': {
                const session = decorateSession(data.session as SessionInfo, target);
                const sessionKey = buildSessionKey(session);
                return prev.map((item) => (
                  buildSessionKey(item) === sessionKey ? session : item
                ));
              }
              case 'session.deleted': {
                const sessionId = data.session_id as string;
                return prev.filter((item) => buildSessionKey(item) !== buildSessionKey({
                  id: sessionId,
                  source_host_id: target.id,
                }, target.id));
              }
              default:
                return prev;
            }
          });
        } catch {
          // Ignore malformed events
        }
      };

      es.addEventListener('session.created', handleEvent);
      es.addEventListener('session.updated', handleEvent);
      es.addEventListener('session.deleted', handleEvent);
    }

    return () => {
      for (const eventSource of eventSourcesRef.current) {
        eventSource.close();
      }
      eventSourcesRef.current = [];
    };
  }, [buildSessionKey, decorateSession, enabled, fetchSessions, resolvedTargets, supportsEventSource]);

  return {
    sessions,
    loading,
    error,
    refresh: fetchSessions,
  };
}
