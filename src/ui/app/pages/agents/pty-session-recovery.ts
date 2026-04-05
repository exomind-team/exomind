import type { SessionInfo } from '@/lib/types/session';

export type RecoverableTerminalAgentType = 'claude' | 'codex';

export interface RecoverableTerminalSessionSnapshot {
  sessionId?: string;
  sourceHostId?: string;
  agentType: RecoverableTerminalAgentType;
  innerSessionId: string;
  role?: string;
  workdir: string;
  projectPathKey: string;
}

interface HistoricalSessionInfo {
  agent_type: RecoverableTerminalAgentType;
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
  agentType: RecoverableTerminalAgentType;
  baselineSessionIds: string[];
  preferredBaselineSessionIds?: string[];
  allowImmediatePreferredBaselineMatch?: boolean;
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
const PTY_RECOVERY_REQUEST_TIMEOUT_MS = 3_500;
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

function resolveRecoverableTerminalAgentType(session: Pick<SessionInfo, 'agent_kind' | 'interaction_mode'>): RecoverableTerminalAgentType | null {
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
  agentType: RecoverableTerminalAgentType,
  projectPath?: string | null,
): string {
  if (agentType === 'claude') {
    return (projectPath ?? '').trim().toLowerCase();
  }

  return normalizeComparablePath(projectPath);
}

function normalizeExpectedProjectPath(
  agentType: RecoverableTerminalAgentType,
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

function isPtyRecoveryTimeoutError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('abort') || message.includes('timeout') || message.includes('超时');
}

async function fetchPtyRecoveryWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = PTY_RECOVERY_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    return await fetch(input, {
      ...init,
      signal: controller?.signal,
    });
  } catch (error) {
    if (isPtyRecoveryTimeoutError(error)) {
      throw new Error('request timeout（请求超时）');
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
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

export function resolveTerminalSessionWorkdir(session: Pick<SessionInfo, 'context'>): string | undefined {
  return session.context.work_dir ?? session.context.worktree_path;
}

export function buildRecoverableTerminalSessionSnapshot(
  session: Pick<
    SessionInfo,
    'id' | 'agent_kind' | 'interaction_mode' | 'inner_session_id' | 'role' | 'context' | 'source_host_id'
  >,
): RecoverableTerminalSessionSnapshot | null {
  const agentType = resolveRecoverableTerminalAgentType(session);
  if (!agentType) {
    return null;
  }

  const innerSessionId = session.inner_session_id?.trim();
  if (!innerSessionId) {
    return null;
  }

  const workdir = resolveTerminalSessionWorkdir(session)?.trim();
  if (!isAbsolutePathLike(workdir)) {
    return null;
  }

  const projectPathKey = normalizeExpectedProjectPath(agentType, workdir);
  if (!projectPathKey) {
    return null;
  }

  return {
    sessionId: session.id,
    ...(session.source_host_id?.trim() ? { sourceHostId: session.source_host_id.trim() } : {}),
    agentType,
    innerSessionId,
    ...(session.role?.trim() ? { role: session.role.trim() } : {}),
    workdir: workdir!,
    projectPathKey,
  };
}

export function getRecoverableTerminalSessionSnapshotKey(
  snapshot: Pick<RecoverableTerminalSessionSnapshot, 'agentType' | 'innerSessionId' | 'projectPathKey'>,
): string {
  const innerSessionId = snapshot.innerSessionId.trim();
  if (innerSessionId.length > 0) {
    return `${snapshot.agentType}:${innerSessionId}`;
  }
  return `${snapshot.agentType}:${snapshot.projectPathKey}`;
}

export function matchesRecoverableTerminalSessionSnapshot(
  session: Pick<
    SessionInfo,
    'id' | 'agent_kind' | 'interaction_mode' | 'inner_session_id' | 'role' | 'context' | 'source_host_id'
  >,
  snapshot: RecoverableTerminalSessionSnapshot,
): boolean {
  const candidate = buildRecoverableTerminalSessionSnapshot(session);
  if (!candidate) {
    return false;
  }
  if (candidate.agentType !== snapshot.agentType) {
    return false;
  }
  return candidate.innerSessionId === snapshot.innerSessionId;
}

export function resolveRecoverableTerminalProjectPathKey(
  session: Pick<SessionInfo, 'agent_kind' | 'interaction_mode' | 'context'>,
): string | null {
  const agentType = resolveRecoverableTerminalAgentType(session);
  if (!agentType) {
    return null;
  }

  const workdir = resolveTerminalSessionWorkdir(session);
  if (!workdir) {
    return null;
  }

  const normalized = normalizeExpectedProjectPath(agentType, workdir);
  return normalized || null;
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
  agentType: RecoverableTerminalAgentType,
  authToken?: string,
): Promise<HistoricalSessionInfo[]> {
  const response = await fetchPtyRecoveryWithTimeout(
    `${rtBaseUrl}/pty/sessions?agent_type=${encodeURIComponent(agentType)}`,
    { headers: buildHeaders(authToken) },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<HistoricalSessionInfo[]>;
}

function buildResumeRequestBody(
  snapshot: RecoverableTerminalSessionSnapshot,
  rows: number,
  cols: number,
): Record<string, string | number> {
  const body: Record<string, string | number> = {
    agent_type: snapshot.agentType,
    session_id: snapshot.innerSessionId,
    rows,
    cols,
  };
  if (snapshot.role?.trim()) {
    body.name = snapshot.role.trim();
  }
  if (snapshot.workdir.trim()) {
    body.workdir = snapshot.workdir.trim();
  }
  return body;
}

export async function resumeHistoricalPtySnapshot({
  rtBaseUrl,
  authToken,
  snapshot,
  rows = 24,
  cols = 80,
}: {
  rtBaseUrl: string;
  authToken?: string;
  snapshot: RecoverableTerminalSessionSnapshot;
  rows?: number;
  cols?: number;
}): Promise<PtyResumeResponse> {
  const response = await fetchPtyRecoveryWithTimeout(`${rtBaseUrl}/pty/resume`, {
    method: 'POST',
    headers: buildHeaders(authToken, true),
    body: JSON.stringify(buildResumeRequestBody(snapshot, rows, cols)),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json() as Promise<PtyResumeResponse>;
}

export async function resumeHistoricalPtySession({
  rtBaseUrl,
  authToken,
  session,
  rows = 24,
  cols = 80,
}: ResumeHistoricalSessionInput): Promise<PtyResumeResponse> {
  const snapshot = buildRecoverableTerminalSessionSnapshot(session);
  if (!snapshot) {
    throw new Error('session is not recoverable');
  }
  return resumeHistoricalPtySnapshot({ rtBaseUrl, authToken, snapshot, rows, cols });
}

export async function hasMatchingHistoricalSessionSnapshotRecord(
  rtBaseUrl: string,
  snapshot: RecoverableTerminalSessionSnapshot,
  authToken?: string,
): Promise<boolean> {
  const historicalSessions = await fetchHistoricalSessions(
    rtBaseUrl,
    snapshot.agentType,
    authToken,
  );
  const matchedSession = historicalSessions.find(
    (item) => item.session_id === snapshot.innerSessionId,
  );
  if (!matchedSession) {
    return false;
  }

  return normalizeHistoricalProjectPath(snapshot.agentType, matchedSession.project_path)
    === snapshot.projectPathKey;
}

export async function hasMatchingHistoricalSessionRecord(
  rtBaseUrl: string,
  session: SessionInfo,
  authToken?: string,
): Promise<boolean> {
  const snapshot = buildRecoverableTerminalSessionSnapshot(session);
  if (!snapshot) {
    return false;
  }
  return hasMatchingHistoricalSessionSnapshotRecord(rtBaseUrl, snapshot, authToken);
}

export async function detectAndPersistHistoricalSessionId({
  rtBaseUrl,
  authToken,
  sessionRecordId,
  agentType,
  baselineSessionIds,
  preferredBaselineSessionIds,
  allowImmediatePreferredBaselineMatch = false,
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
    const normalizedPreferredBaselineSessionIds = [...new Set(
      (preferredBaselineSessionIds ?? [])
        .map((sessionId) => sessionId.trim())
        .filter((sessionId) => sessionId.length > 0),
    )];
    const normalizedExpectedWorkdir = normalizeExpectedProjectPath(agentType, expectedWorkdir);
    const lowerBoundMs = startedAtMs - DETECTION_CLOCK_SKEW_MS;
    const upperBoundMs = startedAtMs + candidateWindowMs;
    const normalizedIntervalMs = Math.max(1, intervalMs);
    const resolvedMaxAttempts = maxAttempts
      ?? Math.max(1, Math.ceil(candidateWindowMs / normalizedIntervalMs));
    let lastExactMatchIds: string[] = [];
    let lastFreshExactMatchIds: string[] = [];
    let lastBaselineExactMatchIds: string[] = [];
    let lastBaselineExactMatches: HistoricalSessionInfo[] = [];
    let sawMismatchedRecentCandidate = false;
    let sawFreshExactMatch = false;
    let fallbackBaselineExactMatch: HistoricalSessionInfo | null = null;

    const matchesExpectedWorkdir = (session: HistoricalSessionInfo): boolean => (
      normalizeHistoricalProjectPath(agentType, session.project_path) === normalizedExpectedWorkdir
    );
    const resolvePreferredBaselineExactMatch = () => normalizedPreferredBaselineSessionIds
      .map((preferredSessionId) => (
        lastBaselineExactMatches.find((session) => session.session_id === preferredSessionId) ?? null
      ))
      .find((session): session is HistoricalSessionInfo => session !== null);

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
        lastBaselineExactMatches = baselineExactMatches;
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

        if (!sawFreshExactMatch && allowImmediatePreferredBaselineMatch) {
          const preferredBaselineExactMatch = resolvePreferredBaselineExactMatch();
          if (preferredBaselineExactMatch) {
            console.warn('[agent-hub][pty] preferring ordered baseline historical session id for ambiguous terminal binding', {
              sessionRecordId,
              agentType,
              expectedWorkdir: expectedWorkdir ?? null,
              matchedSessionId: preferredBaselineExactMatch.session_id,
              preferredBaselineSessionIds: normalizedPreferredBaselineSessionIds,
              baselineExactMatchIds: lastBaselineExactMatchIds,
              immediate: true,
            });
            return persistHistoricalSessionId(
              rtBaseUrl,
              sessionRecordId,
              preferredBaselineExactMatch.session_id,
              authToken,
            );
          }
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

    if (!sawFreshExactMatch && normalizedPreferredBaselineSessionIds.length > 0) {
      const preferredBaselineExactMatch = resolvePreferredBaselineExactMatch();
      if (preferredBaselineExactMatch) {
        console.warn('[agent-hub][pty] preferring ordered baseline historical session id for ambiguous terminal binding', {
          sessionRecordId,
          agentType,
          expectedWorkdir: expectedWorkdir ?? null,
          matchedSessionId: preferredBaselineExactMatch.session_id,
          preferredBaselineSessionIds: normalizedPreferredBaselineSessionIds,
          baselineExactMatchIds: lastBaselineExactMatchIds,
          immediate: false,
        });
        return persistHistoricalSessionId(
          rtBaseUrl,
          sessionRecordId,
          preferredBaselineExactMatch.session_id,
          authToken,
        );
      }
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
