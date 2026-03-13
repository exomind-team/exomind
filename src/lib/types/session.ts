// ── AgentSession Types ──────────────────────────────────────────
// Core types for the unified AgentSession abstraction (#515).
// These mirror the Rust data model in the design doc.

/** Agent type identifier — 1:N relationship (one kind can have many sessions) */
export type AgentKind = 'claude' | 'codex' | 'api';

/** Session lifecycle status */
export type SessionStatus =
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'error'
  | 'paused'
  | 'archived';

/** How the user interacts with this session */
export type InteractionMode = 'terminal' | 'structured';

/** Work context — binds a session to a specific development task */
export interface WorkContext {
  git_branch?: string;
  worktree_path?: string;
  issue_refs: string[];
  pr_ref?: string;
  work_dir?: string;
  labels: string[];
}

/** Quick action type */
export type QuickActionType = 'button' | 'text_input' | 'confirm';

/** A quick action offered when session is in WaitingInput state */
export interface QuickAction {
  id: string;
  label: string;
  action_type: QuickActionType;
  payload?: string;
  description?: string;
}

/** Response to a quick action from the user */
export interface QuickActionResponse {
  action_id: string;
  value?: string;
}

/** Participant identity — who sent a message (User or Agent) */
export type Participant =
  | { type: 'user' }
  | { type: 'agent'; session_id: string };

/** A cross-session message */
export interface SessionMessage {
  id: string;
  from: Participant;
  to_session_id: string;
  content: string;
  created_at: string;
  reply_to?: string;
}

/** Input for sending a cross-session message */
export interface SendMessageInput {
  content: string;
  from?: Participant;
  reply_to?: string;
}

/** Full session info returned from the backend or mock */
export interface SessionInfo {
  id: string;
  agent_kind: AgentKind;
  role: string;
  summary: string;
  status: SessionStatus;
  interaction_mode: InteractionMode;
  pty_id?: string;
  inner_session_id?: string;
  context: WorkContext;
  parent_session_id?: string;
  created_at: string;
  last_active_at: string;
  turn_count: number;
  last_output_preview?: string;
  quick_actions?: QuickAction[];
}

/** Request body for creating a new session */
export interface CreateSessionRequest {
  agent_kind: AgentKind;
  role?: string;
  context?: Partial<WorkContext>;
  interaction?: InteractionMode;
  provider_profile_id?: string;
}

/** Request body for updating a session */
export interface UpdateSessionRequest {
  role?: string;
  summary?: string;
  status?: SessionStatus;
  context?: Partial<WorkContext>;
}

/** SSE event types for session stream */
export type SessionStreamEventType =
  | 'session.created'
  | 'session.updated'
  | 'session.completed'
  | 'session.error'
  | 'session.deleted';

export interface SessionStreamEvent {
  type: SessionStreamEventType;
  session_id: string;
  data?: Partial<SessionInfo>;
}

// ── Display helpers ──────────────────────────────────────────────

/** Human-readable label for agent kinds */
export const AGENT_KIND_LABELS: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  api: 'API',
};

/** Color mapping for agent kinds (brand colors) */
export const AGENT_KIND_COLORS: Record<AgentKind, string> = {
  claude: '#C75B3A',   // ExoMind brand orange
  codex: '#10B981',    // Green
  api: '#6366F1',      // Indigo
};

/** Status indicator shape + color for accessibility (color-blind friendly) */
export const SESSION_STATUS_INDICATORS: Record<
  SessionStatus,
  { color: string; shape: string; label: string }
> = {
  running:       { color: '#22C55E', shape: '●', label: '运行中' },
  waiting_input: { color: '#EAB308', shape: '▲', label: '等待输入' },
  completed:     { color: '#6B7280', shape: '✓', label: '已完成' },
  error:         { color: '#EF4444', shape: '✕', label: '出错' },
  paused:        { color: '#A8A29E', shape: '⏸', label: '已暂停' },
  archived:      { color: '#78716C', shape: '◻', label: '已归档' },
};

/** Check if a session needs user attention */
export function sessionNeedsAttention(status: SessionStatus): boolean {
  return status === 'waiting_input' || status === 'error';
}

/** Format relative time from ISO string */
export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return '刚刚';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h`;
  return `${Math.floor(diffMs / 86_400_000)}d`;
}
