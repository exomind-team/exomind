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

function isLikelyLocalSessionTarget(target: Pick<SessionStreamTarget, 'rtBaseUrl' | 'hostAddress'>): boolean {
  const raw = `${target.hostAddress ?? target.rtBaseUrl}`.toLowerCase();
  return raw.includes('127.0.0.1')
    || raw.includes('localhost')
    || raw.includes('0.0.0.0')
    || raw.includes('::1');
}

function dedupeSessionsById(sessions: SessionInfo[]): SessionInfo[] {
  const seen = new Set<string>();
  const deduped: SessionInfo[] = [];

  for (const session of sessions) {
    if (seen.has(session.id)) {
      continue;
    }
    seen.add(session.id);
    deduped.push(session);
  }

  return deduped;
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
  const authWarningKeysRef = useRef<Set<string>>(new Set());
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
          if (response.status === 401) {
            const warningKey = `${target.id}|sessions|${target.authToken ? 'with-token' : 'without-token'}`;
            if (!authWarningKeysRef.current.has(warningKey)) {
              authWarningKeysRef.current.add(warningKey);
              console.warn('[session-stream][auth] unauthorized session fetch', {
                targetId: target.id,
                rtBaseUrl: target.rtBaseUrl,
                hostName: target.hostName,
                hostAddress: target.hostAddress,
                authTokenPresent: Boolean(target.authToken),
              });
            }
          }
          throw new Error(`${target.hostName ?? target.rtBaseUrl}: HTTP ${response.status}`);
        }
        const data: SessionInfo[] = await response.json();
        return data.map((session) => decorateSession(session, target));
      }));
      setSessions(dedupeSessionsById(results.flat()));
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
      if (!target.authToken && !isLikelyLocalSessionTarget(target)) {
        const warningKey = `${target.id}|sessions-stream|without-token`;
        if (!authWarningKeysRef.current.has(warningKey)) {
          authWarningKeysRef.current.add(warningKey);
          console.warn('[session-stream][auth] opening session stream without auth token', {
            targetId: target.id,
            rtBaseUrl: target.rtBaseUrl,
            hostName: target.hostName,
            hostAddress: target.hostAddress,
          });
        }
      }
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
                return dedupeSessionsById([session, ...prev]);
              }
              case 'session.updated': {
                const session = decorateSession(data.session as SessionInfo, target);
                return dedupeSessionsById([
                  session,
                  ...prev.filter((item) => item.id !== session.id),
                ]);
              }
              case 'session.deleted': {
                const sessionId = data.session_id as string;
                return prev.filter((item) => item.id !== sessionId);
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
  }, [decorateSession, enabled, fetchSessions, resolvedTargets, supportsEventSource]);

  return {
    sessions,
    loading,
    error,
    refresh: fetchSessions,
  };
}
