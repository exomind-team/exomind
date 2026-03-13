import { useState, useCallback } from 'react';
import { Maximize2, Minimize2, Pause, Square } from 'lucide-react';
import type { SessionInfo } from '@/lib/types/session';
import {
  SESSION_STATUS_INDICATORS,
  AGENT_KIND_LABELS,
  sessionNeedsAttention,
  formatRelativeTime,
} from '@/lib/types/session';
import { PtyTerminal } from '../../components/PtyTerminal';

// ── Types ──────────────────────────────────────────────────────

export type TiledLayout = '1x1' | '1x2' | '2x2' | '2x4';

export interface TiledGridProps {
  sessions: SessionInfo[];
  layout: TiledLayout;
  rtBaseUrl: string;
  authToken?: string;
  /** Currently focused pane index */
  focusedIndex: number | null;
  onFocusPane: (index: number | null) => void;
  onSessionClick?: (session: SessionInfo) => void;
}

// ── Layout config ──────────────────────────────────────────────

const LAYOUT_CONFIG: Record<TiledLayout, { cols: number; rows: number; maxPanes: number }> = {
  '1x1': { cols: 1, rows: 1, maxPanes: 1 },
  '1x2': { cols: 2, rows: 1, maxPanes: 2 },
  '2x2': { cols: 2, rows: 2, maxPanes: 4 },
  '2x4': { cols: 4, rows: 2, maxPanes: 8 },
};

// ── Component ──────────────────────────────────────────────────

export function TiledGrid({
  sessions,
  layout,
  rtBaseUrl,
  authToken,
  focusedIndex,
  onFocusPane,
  onSessionClick,
}: TiledGridProps) {
  const config = LAYOUT_CONFIG[layout];
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Fill panes up to maxPanes
  const panes = sessions.slice(0, config.maxPanes);

  const handleDoubleClick = useCallback(
    (index: number) => {
      setExpandedIndex((prev) => (prev === index ? null : index));
    },
    [],
  );

  // If a pane is expanded (double-click fullscreen), show only that pane
  if (expandedIndex !== null && panes[expandedIndex]) {
    const session = panes[expandedIndex];
    return (
      <div data-testid="tiled-grid" className="flex h-full flex-col">
        <SessionPane
          session={session}
          rtBaseUrl={rtBaseUrl}
          authToken={authToken}
          isFocused={true}
          isExpanded={true}
          onDoubleClick={() => handleDoubleClick(expandedIndex)}
          onFocus={() => onFocusPane(expandedIndex)}
          onClick={() => onSessionClick?.(session)}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="tiled-grid"
      className="grid h-full gap-1"
      style={{
        gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
        gridTemplateRows: `repeat(${config.rows}, 1fr)`,
      }}
    >
      {panes.map((session, index) => (
        <SessionPane
          key={session.id}
          session={session}
          rtBaseUrl={rtBaseUrl}
          authToken={authToken}
          isFocused={focusedIndex === index}
          isExpanded={false}
          onDoubleClick={() => handleDoubleClick(index)}
          onFocus={() => onFocusPane(index)}
          onClick={() => onSessionClick?.(session)}
        />
      ))}
      {/* Empty pane placeholders */}
      {Array.from({ length: Math.max(0, config.maxPanes - panes.length) }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="flex items-center justify-center rounded-lg border border-dashed border-[#E7E5E4] bg-[#FAFAF9] dark:border-[#292524] dark:bg-[#0C0A09]"
        >
          <span className="text-xs text-[#A8A29E] dark:text-[#57534E]">
            空窗格
          </span>
        </div>
      ))}
    </div>
  );
}

// ── SessionPane ────────────────────────────────────────────────

interface SessionPaneProps {
  session: SessionInfo;
  rtBaseUrl: string;
  authToken?: string;
  isFocused: boolean;
  isExpanded: boolean;
  onDoubleClick: () => void;
  onFocus: () => void;
  onClick?: () => void;
}

function SessionPane({
  session,
  rtBaseUrl,
  authToken,
  isFocused,
  isExpanded,
  onDoubleClick,
  onFocus,
  onClick,
}: SessionPaneProps) {
  const statusIndicator = SESSION_STATUS_INDICATORS[session.status];
  const needsAttention = sessionNeedsAttention(session.status);

  return (
    <div
      className={`
        flex flex-col overflow-hidden rounded-lg border transition-all
        ${needsAttention
          ? 'border-yellow-400/60 shadow-[0_0_0_1px_rgba(234,179,8,0.3)] dark:border-yellow-500/40'
          : isFocused
            ? 'border-[#C75B3A]/50 shadow-[0_0_0_1px_rgba(199,91,58,0.2)]'
            : 'border-[#E7E5E4] dark:border-[#292524]'
        }
        ${!isFocused && !needsAttention ? 'opacity-75' : 'opacity-100'}
      `}
      onClick={() => {
        onFocus();
        onClick?.();
      }}
    >
      {/* Pane header (36-40px, double-row as per designer review) */}
      <div
        className="flex flex-col gap-0 border-b border-[#E7E5E4] bg-[#F5F0ED] px-2 py-1 dark:border-[#292524] dark:bg-[#1C1917]"
        onDoubleClick={onDoubleClick}
      >
        {/* Row 1: Status + Role + Time + Expand button */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="flex-shrink-0 text-xs"
              style={{ color: statusIndicator.color }}
              title={statusIndicator.label}
            >
              {statusIndicator.shape}
            </span>
            <span className="truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              {session.role || '未命名'}
            </span>
            <span className="flex-shrink-0 text-[9px] text-[#A8A29E]">
              {AGENT_KIND_LABELS[session.agent_kind]}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[#A8A29E]">
              {formatRelativeTime(session.last_active_at)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDoubleClick();
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
              title={isExpanded ? '还原' : '全屏'}
            >
              {isExpanded ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
            </button>
          </div>
        </div>

        {/* Row 2: Branch + Issue badges */}
        <div className="flex items-center gap-1 overflow-hidden">
          {session.context.git_branch && (
            <span className="truncate rounded bg-[#E7E5E4] px-1 py-0 text-[9px] text-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]">
              {session.context.git_branch}
            </span>
          )}
          {session.context.issue_refs.map((ref) => (
            <span
              key={ref}
              className="flex-shrink-0 rounded bg-[#E7E5E4] px-1 py-0 text-[9px] text-[#57534E] dark:bg-[#292524] dark:text-[#A8A29E]"
            >
              {ref}
            </span>
          ))}
          {session.context.pr_ref && (
            <span className="flex-shrink-0 rounded bg-[#DBEAFE] px-1 py-0 text-[9px] text-[#1E40AF] dark:bg-[#1E3A5F] dark:text-[#93C5FD]">
              PR {session.context.pr_ref}
            </span>
          )}
        </div>
      </div>

      {/* Pane content: Terminal or summary */}
      <div className="flex-1 min-h-0 overflow-hidden bg-[#1C1917]">
        {session.interaction_mode === 'terminal' && session.pty_id ? (
          <PtyTerminal
            rtBaseUrl={rtBaseUrl}
            ptyId={session.pty_id}
            authToken={authToken}
          />
        ) : (
          <div className="h-full overflow-auto p-2">
            <p className="whitespace-pre-wrap text-xs text-[#A8A29E] font-mono">
              {session.last_output_preview || session.summary || '等待输出...'}
            </p>
          </div>
        )}
      </div>

      {/* Pane action bar (32px) */}
      <div className="flex items-center justify-between border-t border-[#292524] bg-[#1C1917] px-2 py-1">
        {needsAttention ? (
          <span className="text-[10px] font-medium" style={{ color: statusIndicator.color }}>
            {statusIndicator.label}
          </span>
        ) : (
          <span className="text-[10px] text-[#57534E]">
            {session.turn_count > 0 ? `${session.turn_count} turns` : ''}
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded text-[#57534E] hover:text-[#A8A29E]"
            title="暂停"
          >
            <Pause size={10} />
          </button>
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded text-[#57534E] hover:text-[#A8A29E]"
            title="停止"
          >
            <Square size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── LayoutSelector ─────────────────────────────────────────────

export interface LayoutSelectorProps {
  value: TiledLayout;
  onChange: (layout: TiledLayout) => void;
}

const LAYOUT_OPTIONS: Array<{ id: TiledLayout; label: string }> = [
  { id: '1x1', label: '1x1' },
  { id: '1x2', label: '1x2' },
  { id: '2x2', label: '2x2' },
  { id: '2x4', label: '2x4' },
];

export function LayoutSelector({ value, onChange }: LayoutSelectorProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-[#F5F0ED] p-0.5 dark:bg-[#292524]">
      {LAYOUT_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
            value === option.id
              ? 'bg-white text-[#1C1917] shadow-sm dark:bg-[#1C1917] dark:text-[#FAFAF9]'
              : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
