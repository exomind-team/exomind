import { Clock, ExternalLink } from 'lucide-react';
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
}

// ── Component ──────────────────────────────────────────────────

export function SessionCard({ session, onClick }: SessionCardProps) {
  const statusIndicator = SESSION_STATUS_INDICATORS[session.status];
  const agentColor = AGENT_KIND_COLORS[session.agent_kind];
  const agentLabel = AGENT_KIND_LABELS[session.agent_kind];
  const needsAttention = sessionNeedsAttention(session.status);

  return (
    <button
      type="button"
      data-testid={`session-card-${session.id}`}
      onClick={() => onClick?.(session)}
      className={`
        group relative flex w-full flex-col gap-2 rounded-xl border p-4 text-left
        transition-all duration-200 hover:shadow-md
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
        className="absolute right-3 top-4 text-[#D6D3D1] opacity-0 transition-opacity group-hover:opacity-100 dark:text-[#44403C]"
      />
    </button>
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
