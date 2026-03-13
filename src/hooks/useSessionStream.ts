import { useEffect, useRef, useState, useCallback } from 'react';
import type { SessionInfo } from '@/lib/types/session';

/** Hook options */
export interface UseSessionStreamOptions {
  /** Base URL for the runtime API (e.g., "http://127.0.0.1:1949") */
  rtBaseUrl: string | null;
  /** Auth token for the runtime API */
  authToken?: string;
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
  enabled = true,
}: UseSessionStreamOptions): UseSessionStreamResult {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!rtBaseUrl) return;

    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const response = await fetch(`${rtBaseUrl}/sessions`, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: SessionInfo[] = await response.json();
      setSessions(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [rtBaseUrl, authToken]);

  // Initial fetch + SSE subscription
  useEffect(() => {
    if (!enabled || !rtBaseUrl) {
      setSessions([]);
      return;
    }

    // Fetch initial data
    void fetchSessions();

    // Connect to SSE stream
    const streamUrl = authToken
      ? `${rtBaseUrl}/sessions/stream?token=${encodeURIComponent(authToken)}`
      : `${rtBaseUrl}/sessions/stream`;
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    const handleEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        setSessions((prev) => {
          switch (event.type) {
            case 'session.created': {
              const session = data.session as SessionInfo;
              // Avoid duplicates
              if (prev.some((s) => s.id === session.id)) return prev;
              return [session, ...prev];
            }
            case 'session.updated': {
              const session = data.session as SessionInfo;
              return prev.map((s) => (s.id === session.id ? session : s));
            }
            case 'session.deleted': {
              const sessionId = data.session_id as string;
              return prev.filter((s) => s.id !== sessionId);
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

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [enabled, rtBaseUrl, authToken, fetchSessions]);

  return {
    sessions,
    loading,
    error,
    refresh: fetchSessions,
  };
}
