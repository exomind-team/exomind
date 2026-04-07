import { Clock, ExternalLink, Loader2, Square, X } from 'lucide-react';
import type { SessionInfo } from '@/lib/types/session';
import {
  AGENT_KIND_LABELS,
  AGENT_KIND_COLORS,
  SESSION_STATUS_INDICATORS,
  sessionNeedsAttention,
  formatRelativeTime,
} from '@/lib/types/session';

// ── Types ──────────────────────────────────────────────────────

export interface SessionCardProps {
  session: SessionInfo;
  onClick?: (session: SessionInfo) => void;
  onStop?: (session: SessionInfo) => void;
  onArchive?: (session: SessionInfo) => void;
  stopDisabled?: boolean;
}

// ── Component ──────────────────────────────────────────────────

export function SessionCard({
  session,
  onClick,
  onStop,
  onArchive,
  stopDisabled = false,
}: SessionCardProps) {
  const statusIndicator = SESSION_STATUS_INDICATORS[session.status];
  const agentColor = AGENT_KIND_COLORS[session.agent_kind];
  const agentLabel = AGENT_KIND_LABELS[session.agent_kind];
  const needsAttention = sessionNeedsAttention(session.status);
  const isCompleted = session.status === 'completed';
  const isArchived = session.status === 'archived';
  const canResolveSession = !isCompleted && !isArchived;
  const canStopPtyTerminal = canResolveSession && session.interaction_mode === 'terminal' && !!session.pty_id;
  const canForceCompleteTerminal = canResolveSession && session.interaction_mode === 'terminal' && !session.pty_id;
  const canCloseSessionWithoutPty = canResolveSession && session.interaction_mode !== 'terminal' && !session.pty_id;
  const canArchive = isCompleted;
  const hasActionButton = canStopPtyTerminal || canForceCompleteTerminal || canCloseSessionWithoutPty || canArchive;
  const stopLabel = stopDisabled ? '停止中' : '停止';
  const noPtyActionLabel = canForceCompleteTerminal ? '强制完成' : '关闭';
  const noPtyActionTestId = canForceCompleteTerminal
    ? `session-card-force-complete-${session.id}`
    : `session-card-close-${session.id}`;

  return (
    <div className="relative">
      <button
        type="button"
        data-testid={`session-card-${session.id}`}
        onClick={() => onClick?.(session)}
        className={`
        group relative flex w-full flex-col gap-2 rounded-xl border p-4 text-left
        transition-all duration-200 hover:shadow-md
        ${hasActionButton ? 'pr-28' : ''}
        ${isCompleted ? 'opacity-50' : ''}
        ${needsAttention
          ? 'border-yellow-400/60 bg-yellow-50/50 shadow-sm dark:border-yellow-500/40 dark:bg-yellow-950/20'
          : 'border-[#E7E5E4] bg-white hover:border-[#D6D3D1] dark:border-[#292524] dark:bg-[#1C1917] dark:hover:border-[#44403C]'
        }
      `}
      >
        {/* Row 1: Status + Role + Time */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Status indicator (shape for accessibility) */}
            <span
              className="flex-shrink-0 text-sm"
              style={{ color: statusIndicator.color }}
              title={statusIndicator.label}
              aria-label={statusIndicator.label}
            >
              {statusIndicator.shape}
            </span>

            {/* Role name */}
            <span className="truncate text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              {session.role || '未命名'}
            </span>

            {/* Agent kind badge */}
            <span
              className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: agentColor }}
            >
              {agentLabel}
            </span>
          </div>

          {/* Relative time */}
          <div className="flex flex-shrink-0 items-center gap-1 text-xs text-[#A8A29E]">
            <Clock size={12} />
            <span>{formatRelativeTime(session.last_active_at)}</span>
          </div>
        </div>

        {/* Row 2: Context chips (branch / issue / PR) */}
        <div className="flex flex-wrap items-center gap-1.5">
          {session.context.git_branch && (
            <ContextChip icon="branch">
              {session.context.git_branch}
            </ContextChip>
          )}
          {session.context.issue_refs.map((ref) => (
            <ContextChip key={ref} icon="issue">
              {ref}
            </ContextChip>
          ))}
          {session.context.pr_ref && (
            <ContextChip icon="pr">
              PR {session.context.pr_ref}
            </ContextChip>
          )}
          {session.context.worktree_path && (
            <ContextChip icon="worktree">
              worktree
            </ContextChip>
          )}
        </div>

        {/* Row 3: Summary / last output preview */}
        {(session.summary || session.last_output_preview) && (
          <p className="line-clamp-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
            {session.summary || session.last_output_preview}
          </p>
        )}

        {canForceCompleteTerminal && (
          <p
            data-testid={`session-card-missing-pty-note-${session.id}`}
            className="text-xs text-red-600 dark:text-red-400"
          >
            该会话没有关联 PTY，可点击右上角“强制完成”将其收敛；点开会话后若存在可恢复的历史终端，系统会自动尝试恢复。
          </p>
        )}

        {/* Row 4: Status label for attention-needing sessions */}
        {needsAttention && (
          <div className="flex items-center gap-1">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                backgroundColor: `${statusIndicator.color}20`,
                color: statusIndicator.color,
              }}
            >
              {statusIndicator.label}
            </span>
          </div>
        )}

        {/* Hover arrow indicator */}
        <ExternalLink
          size={14}
          className={`absolute top-4 text-[#D6D3D1] opacity-0 transition-opacity group-hover:opacity-100 dark:text-[#44403C] ${hasActionButton ? 'right-11' : 'right-3'}`}
        />
      </button>

      {canArchive && onArchive && (
        <button
          type="button"
          data-testid={`session-card-archive-${session.id}`}
          aria-label="归档"
          title="归档"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onArchive(session);
          }}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] transition-colors hover:bg-[#E7E5E4] hover:text-[#1C1917] dark:bg-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#44403C] dark:hover:text-[#FAFAF9]"
        >
          <X size={12} />
        </button>
      )}

      {canStopPtyTerminal && onStop && (
        <button
          type="button"
          data-testid={`session-card-stop-${session.id}`}
          aria-label={stopLabel}
          title={stopLabel}
          disabled={stopDisabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (stopDisabled) return;
            onStop(session);
          }}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-[#F5F0ED] text-[#78716C] transition-colors hover:bg-[#E7E5E4] hover:text-[#1C1917] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-[#F5F0ED] disabled:hover:text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E] dark:hover:bg-[#44403C] dark:hover:text-[#FAFAF9] dark:disabled:hover:bg-[#292524] dark:disabled:hover:text-[#A8A29E]"
        >
          {stopDisabled ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
        </button>
      )}

      {(canForceCompleteTerminal || canCloseSessionWithoutPty) && onStop && (
        <button
          type="button"
          data-testid={noPtyActionTestId}
          aria-label={stopDisabled ? '处理中' : noPtyActionLabel}
          disabled={stopDisabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (stopDisabled) return;
            onStop(session);
          }}
          className="absolute right-3 top-3 inline-flex h-7 items-center gap-1 rounded-md bg-red-600 px-2 text-[11px] font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-400 dark:bg-red-700 dark:hover:bg-red-600 dark:disabled:bg-red-800/60"
        >
          {stopDisabled ? <Loader2 size={12} className="animate-spin" /> : <Square size={11} />}
          <span>{stopDisabled ? '处理中' : noPtyActionLabel}</span>
        </button>
      )}
    </div>
  );
}

// ── ContextChip ────────────────────────────────────────────────

type ChipIcon = 'branch' | 'issue' | 'pr' | 'worktree';

const CHIP_ICONS: Record<ChipIcon, string> = {
  branch: '⎇',
  issue: '#',
  pr: '⇌',
  worktree: '📂',
};

function ContextChip({
  icon,
  children,
}: {
  icon: ChipIcon;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-[#F5F0ED] px-1.5 py-0.5 text-[10px] font-medium text-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
      <span className="opacity-60">{CHIP_ICONS[icon]}</span>
      {children}
    </span>
  );
}
