import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
  refresh: () => Promise<void>;
}

export const SESSION_FETCH_TIMEOUT_MS = 4_000;
const SESSION_SNAPSHOT_FALLBACK_AGE_MS = 60_000;

type SessionSnapshotCacheEntry = {
  sessions: SessionInfo[];
  updatedAtMs: number;
};

const sessionSnapshotCache = new Map<string, SessionSnapshotCacheEntry>();
let latestSessionSnapshotCacheEntry: SessionSnapshotCacheEntry | null = null;

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

function cloneCachedSessionSnapshot(entry: SessionSnapshotCacheEntry | null | undefined): SessionInfo[] {
  return entry ? [...entry.sessions] : [];
}

function readCachedSessionSnapshot(signature: string, allowLatestFallback = false): SessionInfo[] {
  const cached = sessionSnapshotCache.get(signature);
  if (cached) {
    return cloneCachedSessionSnapshot(cached);
  }

  if (!allowLatestFallback || !latestSessionSnapshotCacheEntry) {
    return [];
  }

  const ageMs = Date.now() - latestSessionSnapshotCacheEntry.updatedAtMs;
  if (ageMs > SESSION_SNAPSHOT_FALLBACK_AGE_MS) {
    return [];
  }

  return cloneCachedSessionSnapshot(latestSessionSnapshotCacheEntry);
}

function writeCachedSessionSnapshot(signature: string, sessions: SessionInfo[]): void {
  if (!signature) {
    return;
  }

  const deduped = dedupeSessionsById(sessions);
  if (deduped.length === 0) {
    sessionSnapshotCache.delete(signature);
    return;
  }

  const entry = {
    sessions: deduped,
    updatedAtMs: Date.now(),
  } satisfies SessionSnapshotCacheEntry;

  sessionSnapshotCache.set(signature, entry);
  latestSessionSnapshotCacheEntry = entry;
}

export function __resetSessionStreamCacheForTests(): void {
  sessionSnapshotCache.clear();
  latestSessionSnapshotCacheEntry = null;
}

function buildSessionStreamTargetSignature(target: SessionStreamTarget): string {
  return [
    target.id,
    target.rtBaseUrl,
    target.authToken ?? '',
    target.hostName ?? '',
    target.hostAddress ?? '',
  ].join('|');
}

function sortSessionStreamTargets(targets: SessionStreamTarget[]): SessionStreamTarget[] {
  return [...targets].sort((left, right) => {
    const leftKey = buildSessionStreamTargetSignature(left);
    const rightKey = buildSessionStreamTargetSignature(right);
    return leftKey.localeCompare(rightKey);
  });
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
  const fetchRequestIdRef = useRef(0);
  const resolvedTargetsRef = useRef<{
    signature: string;
    targets: SessionStreamTarget[];
  }>({
    signature: '',
    targets: [],
  });
  const supportsEventSource = typeof EventSource !== 'undefined';

  const normalizedTargets = useMemo(() => (
    sortSessionStreamTargets((targets && targets.length > 0)
      ? targets
      : (rtBaseUrl
        ? [{
            id: rtBaseUrl,
            rtBaseUrl,
            authToken,
            hostAddress: rtBaseUrl,
          }]
        : []))
  ), [authToken, rtBaseUrl, targets]);
  const resolvedTargetsSignature = useMemo(
    () => normalizedTargets.map(buildSessionStreamTargetSignature).join('||'),
    [normalizedTargets],
  );

  if (resolvedTargetsRef.current.signature !== resolvedTargetsSignature) {
    resolvedTargetsRef.current = {
      signature: resolvedTargetsSignature,
      targets: normalizedTargets.map((target) => ({ ...target })),
    };
  }

  const resolvedTargets = resolvedTargetsRef.current.targets;

  useEffect(() => {
    setSessions(readCachedSessionSnapshot(resolvedTargetsSignature, true));
    setError(null);
  }, [resolvedTargetsSignature]);

  const decorateSession = useCallback(
    (session: SessionInfo, target: SessionStreamTarget): SessionInfo => ({
      ...session,
      source_host_id: session.source_host_id ?? target.id,
      source_host_name: session.source_host_name ?? target.hostName,
      source_host_address: session.source_host_address ?? target.hostAddress ?? target.rtBaseUrl,
    }),
    [],
  );

  const fetchSessions = useCallback(async () => {
    if (resolvedTargets.length === 0) return;

    const requestId = fetchRequestIdRef.current + 1;
    fetchRequestIdRef.current = requestId;
    const cachedSessions = readCachedSessionSnapshot(resolvedTargetsSignature, true);
    setLoading(true);
    setError(null);
    try {
      const settledResults = await Promise.allSettled(resolvedTargets.map(async (target) => {
        const headers: Record<string, string> = {};
        if (target.authToken) headers['Authorization'] = `Bearer ${target.authToken}`;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = typeof window !== 'undefined'
          ? window.setTimeout(() => controller?.abort(), SESSION_FETCH_TIMEOUT_MS)
          : setTimeout(() => controller?.abort(), SESSION_FETCH_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch(`${target.rtBaseUrl}/sessions`, {
            headers,
            signal: controller?.signal,
          });
        } catch (fetchError) {
          const aborted = controller?.signal.aborted
            || (fetchError instanceof Error && fetchError.name === 'AbortError');
          throw new Error(
            aborted
              ? `${target.hostName ?? target.rtBaseUrl}: timeout`
              : fetchError instanceof Error
                ? fetchError.message
                : String(fetchError),
          );
        } finally {
          clearTimeout(timeoutId);
        }
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

      if (fetchRequestIdRef.current !== requestId) {
        return;
      }

      const successfulSessions = settledResults
        .filter((result): result is PromiseFulfilledResult<SessionInfo[]> => result.status === 'fulfilled')
        .flatMap((result) => result.value);
      const nextSessions = dedupeSessionsById(successfulSessions);
      const failedMessages = settledResults
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

      if (nextSessions.length > 0) {
        setSessions(nextSessions);
        writeCachedSessionSnapshot(resolvedTargetsSignature, nextSessions);
        if (failedMessages.length > 0) {
          console.warn('[session-stream] session fetch partially failed', {
            targets: resolvedTargets.map((target) => ({
              id: target.id,
              rtBaseUrl: target.rtBaseUrl,
              hostName: target.hostName,
              hostAddress: target.hostAddress,
            })),
            errors: failedMessages,
          });
        }
        setError(null);
        return;
      }

      if (cachedSessions.length > 0) {
        setSessions(cachedSessions);
      }
      setError(failedMessages[0] ?? 'session fetch failed（会话拉取失败）');
    } catch (e) {
      if (fetchRequestIdRef.current !== requestId) {
        return;
      }
      if (cachedSessions.length > 0) {
        setSessions(cachedSessions);
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (fetchRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [decorateSession, resolvedTargets, resolvedTargetsSignature]);

  // Initial fetch + SSE subscription
  useEffect(() => {
    for (const eventSource of eventSourcesRef.current) {
      eventSource.close();
    }
    eventSourcesRef.current = [];

    if (!enabled || resolvedTargets.length === 0) {
      if (!enabled) {
        setSessions([]);
      }
      setLoading(false);
      setError(null);
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
                const next = dedupeSessionsById([session, ...prev]);
                writeCachedSessionSnapshot(resolvedTargetsSignature, next);
                return next;
              }
              case 'session.updated': {
                const session = decorateSession(data.session as SessionInfo, target);
                const next = dedupeSessionsById([
                  session,
                  ...prev.filter((item) => item.id !== session.id),
                ]);
                writeCachedSessionSnapshot(resolvedTargetsSignature, next);
                return next;
              }
              case 'session.deleted': {
                const sessionId = data.session_id as string;
                const next = prev.filter((item) => item.id !== sessionId);
                writeCachedSessionSnapshot(resolvedTargetsSignature, next);
                return next;
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
  }, [decorateSession, enabled, fetchSessions, resolvedTargets, resolvedTargetsSignature, supportsEventSource]);

  return {
    sessions,
    loading,
    error,
    refresh: fetchSessions,
  };
}
