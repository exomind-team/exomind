export interface RtSessionRecord {
  agent_kind?: string | null;
  context?: {
    work_dir?: string | null;
    worktree_path?: string | null;
  } | null;
  id: string;
  status: string;
  interaction_mode?: string | null;
  inner_session_id?: string | null;
  pty_id?: string | null;
  source_host_id?: string | null;
  created_at?: string | null;
  last_active_at?: string | null;
}

export interface UiSessionSummary {
  active: number;
  completed: number;
  total: number;
  activeSessionIds: string[];
  completedSessionIds: string[];
  visibleSessionIds: string[];
}

export interface RtSessionSummary {
  active: number;
  completed: number;
  total: number;
  activeSessionIds: string[];
  completedSessionIds: string[];
  visibleSessionIds: string[];
}

export interface SessionSummaryMismatch {
  field: 'active' | 'completed' | 'total' | 'activeSessionIds' | 'completedSessionIds' | 'visibleSessionIds';
  ui: number | string[];
  rt: number | string[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function resolveManagedInstanceBridgePort(webPort: number): number {
  return 9223 + Math.max(0, webPort - 1420);
}

const SESSION_CARD_SESSION_ID_PATTERN = /^session-card-(?!archive-|stop-)(.+)$/;

export function parseSessionCardSessionId(testId: string): string | null {
  const match = SESSION_CARD_SESSION_ID_PATTERN.exec(testId.trim());
  return match?.[1] ?? null;
}

export function summarizeRtSessions(records: RtSessionRecord[]): RtSessionSummary {
  const visibleRecords = records.filter((record) => record.status !== 'archived');
  const activeRecords = visibleRecords.filter((record) => record.status !== 'completed');
  const completedRecords = visibleRecords.filter((record) => record.status === 'completed');

  return {
    active: activeRecords.length,
    completed: completedRecords.length,
    total: visibleRecords.length,
    activeSessionIds: uniqueSorted(activeRecords.map((record) => record.id)),
    completedSessionIds: uniqueSorted(completedRecords.map((record) => record.id)),
    visibleSessionIds: uniqueSorted(visibleRecords.map((record) => record.id)),
  };
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function compareSessionSummaries(
  ui: UiSessionSummary,
  rt: RtSessionSummary,
): SessionSummaryMismatch[] {
  const mismatches: SessionSummaryMismatch[] = [];

  if (ui.active !== rt.active) {
    mismatches.push({ field: 'active', ui: ui.active, rt: rt.active });
  }
  if (ui.completed !== rt.completed) {
    mismatches.push({ field: 'completed', ui: ui.completed, rt: rt.completed });
  }
  if (ui.total !== rt.total) {
    mismatches.push({ field: 'total', ui: ui.total, rt: rt.total });
  }
  if (!sameStringArray(uniqueSorted(ui.activeSessionIds), rt.activeSessionIds)) {
    mismatches.push({
      field: 'activeSessionIds',
      ui: uniqueSorted(ui.activeSessionIds),
      rt: rt.activeSessionIds,
    });
  }
  if (!sameStringArray(uniqueSorted(ui.completedSessionIds), rt.completedSessionIds)) {
    mismatches.push({
      field: 'completedSessionIds',
      ui: uniqueSorted(ui.completedSessionIds),
      rt: rt.completedSessionIds,
    });
  }
  if (!sameStringArray(uniqueSorted(ui.visibleSessionIds), rt.visibleSessionIds)) {
    mismatches.push({
      field: 'visibleSessionIds',
      ui: uniqueSorted(ui.visibleSessionIds),
      rt: rt.visibleSessionIds,
    });
  }

  return mismatches;
}
