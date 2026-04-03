import type { SessionInfo } from '@/lib/types/session';

type RecoverableAgentType = 'claude' | 'codex';

interface HistoricalSessionInfo {
  agent_type: RecoverableAgentType;
  session_id: string;
  project_path: string;
  last_modified: string;
}

interface ResumeHistoricalSessionInput {
  rtBaseUrl: string;
  authToken?: string;
  session: SessionInfo;
  rows?: number;
  cols?: number;
}

interface DetectAndPersistHistoricalSessionInput {
  rtBaseUrl: string;
  authToken?: string;
  sessionRecordId: string;
  agentType: RecoverableAgentType;
  baselineSessionIds: string[];
  expectedWorkdir?: string;
  startedAtMs: number;
  maxAttempts?: number;
  intervalMs?: number;
  candidateWindowMs?: number;
}

interface PtyResumeResponse {
  id: string;
  name: string;
}

const DETECTION_CLOCK_SKEW_MS = 15_000;
const DEFAULT_DETECTION_INTERVAL_MS = 2_000;
const DEFAULT_DETECTION_CANDIDATE_WINDOW_MS = 15 * 60_000;
const inFlightHistoricalSessionDetections = new Map<string, Promise<string | null>>();

function buildHeaders(authToken?: string, includeJsonContentType = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  return headers;
}

function resolveRecoverableTerminalAgentType(session: Pick<SessionInfo, 'agent_kind' | 'interaction_mode'>): RecoverableAgentType | null {
  if (session.interaction_mode !== 'terminal') {
    return null;
  }

  if (session.agent_kind === 'claude' || session.agent_kind === 'codex') {
    return session.agent_kind;
  }

  return null;
}

function normalizeComparablePath(value?: string | null): string {
  return (value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function encodeClaudeProjectPath(value?: string | null): string {
  return (value ?? '')
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/[^A-Za-z0-9_-]/g, '-');
}

function normalizeHistoricalProjectPath(
  agentType: RecoverableAgentType,
  projectPath?: string | null,
): string {
  if (agentType === 'claude') {
    return (projectPath ?? '').trim().toLowerCase();
  }

  return normalizeComparablePath(projectPath);
}

function normalizeExpectedProjectPath(
  agentType: RecoverableAgentType,
  workdir?: string | null,
): string {
  if (agentType === 'claude') {
    return encodeClaudeProjectPath(workdir).toLowerCase();
  }

  return normalizeComparablePath(workdir);
}

function isAbsolutePathLike(value?: string | null): boolean {
  const trimmed = (value ?? '').trim();
  return /^[a-z]:[\\/]/i.test(trimmed)
    || trimmed.startsWith('\\\\')
    || trimmed.startsWith('/');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseModifiedAtMs(lastModified: string): number | null {
  const modifiedAtMs = Date.parse(lastModified);
  return Number.isNaN(modifiedAtMs) ? null : modifiedAtMs;
}

function isHistoricalSessionWithinWindow(
  session: HistoricalSessionInfo,
  lowerBoundMs: number,
  upperBoundMs: number,
): boolean {
  const modifiedAtMs = parseModifiedAtMs(session.last_modified);
  if (modifiedAtMs === null) {
    return true;
  }

  return modifiedAtMs >= lowerBoundMs && modifiedAtMs <= upperBoundMs;
}

function dedupeHistoricalSessionsById(
  sessions: HistoricalSessionInfo[],
): HistoricalSessionInfo[] {
  const byId = new Map<string, HistoricalSessionInfo>();

  sessions.forEach((session) => {
    const existing = byId.get(session.session_id);
    if (!existing) {
      byId.set(session.session_id, session);
      return;
    }

    const existingModifiedAtMs = parseModifiedAtMs(existing.last_modified);
    const nextModifiedAtMs = parseModifiedAtMs(session.last_modified);
    if (
      existingModifiedAtMs === null
      || (nextModifiedAtMs !== null && nextModifiedAtMs > existingModifiedAtMs)
    ) {
      byId.set(session.session_id, session);
    }
  });

  return [...byId.values()];
}

async function persistHistoricalSessionId(
  rtBaseUrl: string,
  sessionRecordId: string,
  matchedSessionId: string,
  authToken?: string,
): Promise<string> {
  const updateResponse = await fetch(
    `${rtBaseUrl}/sessions/${encodeURIComponent(sessionRecordId)}`,
    {
      method: 'PATCH',
      headers: buildHeaders(authToken, true),
      body: JSON.stringify({ inner_session_id: matchedSessionId }),
    },
  );
  if (!updateResponse.ok) {
    const text = await updateResponse.text();
    throw new Error(text || `HTTP ${updateResponse.status}`);
  }

  return matchedSessionId;
}

export function resolveTerminalSessionWorkdir(session: SessionInfo): string | undefined {
  return session.context.work_dir ?? session.context.worktree_path;
}

export function isRecoverableTerminalSession(session: SessionInfo): boolean {
  return resolveRecoverableTerminalAgentType(session) !== null
    && typeof session.pty_id === 'string'
    && session.pty_id.trim().length > 0
    && typeof session.inner_session_id === 'string'
    && session.inner_session_id.trim().length > 0
    && session.status !== 'completed'
    && session.status !== 'archived';
}

export function isTerminalSessionPendingHistoricalBinding(session: SessionInfo): boolean {
  return resolveRecoverableTerminalAgentType(session) !== null
    && (!session.inner_session_id || session.inner_session_id.trim().length === 0)
    && session.status !== 'completed'
    && session.status !== 'archived';
}

export function replacePaneOrderSessionId(
  paneOrder: string[],
  fromSessionId: string,
  toSessionId: string,
): string[] {
  const replaced = paneOrder.map((sessionId) => (
    sessionId === fromSessionId ? toSessionId : sessionId
  ));
  return [...new Set(replaced)];
}

async function fetchHistoricalSessions(
  rtBaseUrl: string,
  agentType: RecoverableAgentType,
  authToken?: string,
): Promise<HistoricalSessionInfo[]> {
  const response = await fetch(
    `${rtBaseUrl}/pty/sessions?agent_type=${encodeURIComponent(agentType)}`,
    { headers: buildHeaders(authToken) },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<HistoricalSessionInfo[]>;
}

export async function resumeHistoricalPtySession({
  rtBaseUrl,
  authToken,
  session,
  rows = 24,
  cols = 80,
}: ResumeHistoricalSessionInput): Promise<PtyResumeResponse> {
  const agentType = resolveRecoverableTerminalAgentType(session);
  if (!agentType || !session.inner_session_id) {
    throw new Error('session is not recoverable');
  }

  const body: Record<string, string | number> = {
    agent_type: agentType,
    session_id: session.inner_session_id,
    rows,
    cols,
  };
  const workdir = resolveTerminalSessionWorkdir(session);
  if (session.role.trim()) {
    body.name = session.role.trim();
  }
  if (workdir?.trim()) {
    body.workdir = workdir.trim();
  }

  const response = await fetch(`${rtBaseUrl}/pty/resume`, {
    method: 'POST',
    headers: buildHeaders(authToken, true),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json() as Promise<PtyResumeResponse>;
}

export async function hasMatchingHistoricalSessionRecord(
  rtBaseUrl: string,
  session: SessionInfo,
  authToken?: string,
): Promise<boolean> {
  const agentType = resolveRecoverableTerminalAgentType(session);
  if (!agentType || !session.inner_session_id) {
    return false;
  }

  const workdir = resolveTerminalSessionWorkdir(session);
  if (!isAbsolutePathLike(workdir)) {
    return false;
  }

  const historicalSessions = await fetchHistoricalSessions(
    rtBaseUrl,
    agentType,
    authToken,
  );
  const matchedSession = historicalSessions.find(
    (item) => item.session_id === session.inner_session_id,
  );
  if (!matchedSession) {
    return false;
  }

  return normalizeHistoricalProjectPath(agentType, matchedSession.project_path)
    === normalizeExpectedProjectPath(agentType, workdir);
}

export async function detectAndPersistHistoricalSessionId({
  rtBaseUrl,
  authToken,
  sessionRecordId,
  agentType,
  baselineSessionIds,
  expectedWorkdir,
  startedAtMs,
  maxAttempts,
  intervalMs = DEFAULT_DETECTION_INTERVAL_MS,
  candidateWindowMs = DEFAULT_DETECTION_CANDIDATE_WINDOW_MS,
}: DetectAndPersistHistoricalSessionInput): Promise<string | null> {
  const detectionKey = `${rtBaseUrl}|${agentType}|${sessionRecordId}`;
  const inFlight = inFlightHistoricalSessionDetections.get(detectionKey);
  if (inFlight) {
    return inFlight;
  }

  const detectionPromise = (async () => {
    if (!isAbsolutePathLike(expectedWorkdir)) {
      console.warn('[agent-hub][pty] skip inner session detection because workdir is not absolute', {
        sessionRecordId,
        agentType,
        expectedWorkdir: expectedWorkdir ?? null,
      });
      return null;
    }

    const baseline = new Set(baselineSessionIds);
    const normalizedExpectedWorkdir = normalizeExpectedProjectPath(agentType, expectedWorkdir);
    const lowerBoundMs = startedAtMs - DETECTION_CLOCK_SKEW_MS;
    const upperBoundMs = startedAtMs + candidateWindowMs;
    const normalizedIntervalMs = Math.max(1, intervalMs);
    const resolvedMaxAttempts = maxAttempts
      ?? Math.max(1, Math.ceil(candidateWindowMs / normalizedIntervalMs));
    let lastExactMatchIds: string[] = [];
    let lastFreshExactMatchIds: string[] = [];
    let lastBaselineExactMatchIds: string[] = [];
    let sawMismatchedRecentCandidate = false;
    let sawFreshExactMatch = false;
    let fallbackBaselineExactMatch: HistoricalSessionInfo | null = null;

    const matchesExpectedWorkdir = (session: HistoricalSessionInfo): boolean => (
      normalizeHistoricalProjectPath(agentType, session.project_path) === normalizedExpectedWorkdir
    );

    for (let attempt = 0; attempt < resolvedMaxAttempts; attempt += 1) {
      try {
        const sessions = dedupeHistoricalSessionsById(
          await fetchHistoricalSessions(rtBaseUrl, agentType, authToken),
        );
        const recentCandidates = sessions.filter((session) => (
          isHistoricalSessionWithinWindow(session, lowerBoundMs, upperBoundMs)
        ));
        const recentExactMatches = recentCandidates.filter(matchesExpectedWorkdir);
        const freshExactMatches = recentExactMatches.filter((session) => !baseline.has(session.session_id));
        const recentBaselineExactMatches = recentExactMatches.filter((session) => baseline.has(session.session_id));
        const baselineExactMatches = sessions.filter((session) => (
          baseline.has(session.session_id) && matchesExpectedWorkdir(session)
        ));

        lastFreshExactMatchIds = [...new Set(freshExactMatches.map((session) => session.session_id))];
        lastBaselineExactMatchIds = [...new Set(baselineExactMatches.map((session) => session.session_id))];
        sawFreshExactMatch ||= lastFreshExactMatchIds.length > 0;
        sawMismatchedRecentCandidate ||= recentCandidates.length > recentExactMatches.length;
        if (lastBaselineExactMatchIds.length === 1) {
          fallbackBaselineExactMatch = baselineExactMatches[0] ?? fallbackBaselineExactMatch;
        }

        const preferredExactMatches = freshExactMatches.length > 0
          ? freshExactMatches
          : recentBaselineExactMatches;
        lastExactMatchIds = [...new Set(preferredExactMatches.map((session) => session.session_id))];

        if (lastExactMatchIds.length === 1) {
          return persistHistoricalSessionId(
            rtBaseUrl,
            sessionRecordId,
            lastExactMatchIds[0]!,
            authToken,
          );
        }
      } catch (error) {
        if (attempt === resolvedMaxAttempts - 1) {
          throw error;
        }
      }

      if (attempt < resolvedMaxAttempts - 1) {
        await delay(normalizedIntervalMs);
      }
    }

    if (!sawFreshExactMatch && fallbackBaselineExactMatch) {
      console.warn('[agent-hub][pty] reusing existing historical session id for terminal binding', {
        sessionRecordId,
        agentType,
        expectedWorkdir: expectedWorkdir ?? null,
        matchedSessionId: fallbackBaselineExactMatch.session_id,
      });
      return persistHistoricalSessionId(
        rtBaseUrl,
        sessionRecordId,
        fallbackBaselineExactMatch.session_id,
        authToken,
      );
    }

    console.warn('[agent-hub][pty] unable to safely detect historical session id', {
      sessionRecordId,
      agentType,
      expectedWorkdir: expectedWorkdir ?? null,
      candidateWindowMs,
      exactMatchCount: lastExactMatchIds.length,
      exactMatchIds: lastExactMatchIds,
      freshExactMatchCount: lastFreshExactMatchIds.length,
      freshExactMatchIds: lastFreshExactMatchIds,
      baselineExactMatchCount: lastBaselineExactMatchIds.length,
      baselineExactMatchIds: lastBaselineExactMatchIds,
      sawMismatchedRecentCandidate,
    });
    return null;
  })();

  inFlightHistoricalSessionDetections.set(detectionKey, detectionPromise);
  try {
    return await detectionPromise;
  } finally {
    if (inFlightHistoricalSessionDetections.get(detectionKey) === detectionPromise) {
      inFlightHistoricalSessionDetections.delete(detectionKey);
    }
  }
}
