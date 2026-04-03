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
const DEFAULT_DETECTION_MAX_ATTEMPTS = 180;
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
  maxAttempts = DEFAULT_DETECTION_MAX_ATTEMPTS,
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
    let lastExactMatchIds: string[] = [];
    let sawMismatchedRecentCandidate = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const sessions = await fetchHistoricalSessions(rtBaseUrl, agentType, authToken);
        const recentCandidates = sessions.filter((session) => {
          if (baseline.has(session.session_id)) {
            return false;
          }
          const modifiedAtMs = Date.parse(session.last_modified);
          if (Number.isNaN(modifiedAtMs)) {
            return true;
          }
          return modifiedAtMs >= lowerBoundMs && modifiedAtMs <= upperBoundMs;
        });
        const exactWorkdirMatches = recentCandidates.filter((session) => (
          normalizeHistoricalProjectPath(agentType, session.project_path) === normalizedExpectedWorkdir
        ));
        lastExactMatchIds = exactWorkdirMatches.map((session) => session.session_id);
        sawMismatchedRecentCandidate ||= recentCandidates.length > exactWorkdirMatches.length;

        if (exactWorkdirMatches.length === 1) {
          const matchedSession = exactWorkdirMatches[0]!;
          const updateResponse = await fetch(
            `${rtBaseUrl}/sessions/${encodeURIComponent(sessionRecordId)}`,
            {
              method: 'PATCH',
              headers: buildHeaders(authToken, true),
              body: JSON.stringify({ inner_session_id: matchedSession.session_id }),
            },
          );
          if (!updateResponse.ok) {
            const text = await updateResponse.text();
            throw new Error(text || `HTTP ${updateResponse.status}`);
          }
          return matchedSession.session_id;
        }
      } catch (error) {
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }

      await delay(intervalMs);
    }

    console.warn('[agent-hub][pty] unable to safely detect historical session id', {
      sessionRecordId,
      agentType,
      expectedWorkdir: expectedWorkdir ?? null,
      candidateWindowMs,
      exactMatchCount: lastExactMatchIds.length,
      exactMatchIds: lastExactMatchIds,
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
