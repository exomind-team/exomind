import { useState, useCallback, useEffect, useMemo } from 'react';
import { Maximize2, Minimize2, Pause, Square, CheckCircle2, GripVertical, Loader2, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SessionInfo } from '@/lib/types/session';
import {
  SESSION_STATUS_INDICATORS,
  AGENT_KIND_LABELS,
  sessionNeedsAttention,
  formatRelativeTime,
} from '@/lib/types/session';
import { PtyTerminal } from '../../components/PtyTerminal';
import { QuickActionBar } from './QuickActionBar';
import type { QuickActionResponse } from '@/lib/types/session';

// ── Types ──────────────────────────────────────────────────────

export type TiledLayout = '1x1' | '1x2' | '2x2' | '2x4';

export interface TiledGridProps {
  sessions: SessionInfo[];
  layout: TiledLayout;
  resolveSessionConnection: (session: SessionInfo) => {
    rtBaseUrl: string;
    authToken?: string;
  };
  /** Currently focused pane index */
  focusedIndex: number | null;
  onFocusPane: (index: number | null) => void;
  onSessionClick?: (session: SessionInfo) => void;
  /** Controlled pane order (session IDs). If omitted, uses natural order. */
  paneOrder?: string[];
  /** Callback when panes are reordered via drag-and-drop */
  onReorder?: (newOrder: string[]) => void;
  /** Callback when user submits a quick action response */
  onQuickAction?: (session: SessionInfo, response: QuickActionResponse) => void;
  /** Callback when user manually marks a PTY session as waiting */
  onMarkWaiting?: (session: SessionInfo) => void;
  /** Callback when user stops a terminal session */
  onStopSession?: (session: SessionInfo) => void;
  /** Callback when user archives a completed session */
  onArchiveSession?: (session: SessionInfo) => void;
  /** Whether a terminal session currently points to a missing PTY */
  isSessionDisconnected?: (session: SessionInfo) => boolean;
  isSessionStopping?: (session: SessionInfo) => boolean;
}

type TiledPaneEntry =
  | {
    id: string;
    kind: 'session';
    session: SessionInfo;
  }
  | {
    id: string;
    kind: 'disconnected';
  };

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
  resolveSessionConnection,
  focusedIndex,
  onFocusPane,
  onSessionClick,
  paneOrder,
  onReorder,
  onQuickAction,
  onMarkWaiting,
  onStopSession,
  onArchiveSession,
  isSessionDisconnected,
  isSessionStopping,
}: TiledGridProps) {
  const config = LAYOUT_CONFIG[layout];
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Build ordered panes: respect paneOrder if provided, then fill remaining
  const orderedPanes = useMemo<TiledPaneEntry[]>(() => {
    if (!paneOrder || paneOrder.length === 0) {
      return sessions.slice(0, config.maxPanes).map((session) => ({
        id: session.id,
        kind: 'session' as const,
        session,
      }));
    }

    const sessionMap = new Map(sessions.map((s) => [s.id, s]));
    const ordered: TiledPaneEntry[] = [];
    const seenIds = new Set<string>();

    for (const id of paneOrder) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const s = sessionMap.get(id);
      if (s) {
        ordered.push({
          id,
          kind: 'session',
          session: s,
        });
      } else {
        ordered.push({
          id,
          kind: 'disconnected',
        });
      }
    }

    // Append any sessions not in paneOrder
    for (const s of sessions) {
      if (seenIds.has(s.id)) continue;
      seenIds.add(s.id);
      ordered.push({
        id: s.id,
        kind: 'session',
        session: s,
      });
    }

    return ordered.slice(0, config.maxPanes);
  }, [sessions, paneOrder, config.maxPanes]);

  const paneIds = useMemo(() => orderedPanes.map((pane) => pane.id), [orderedPanes]);

  // DnD sensors: require 8px drag distance to avoid conflicting with clicks
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = paneIds.indexOf(active.id as string);
      const newIndex = paneIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(paneIds, oldIndex, newIndex);
      onReorder?.(newOrder);

      // Update focused index to follow the dragged pane
      if (focusedIndex === oldIndex) {
        onFocusPane(newIndex);
      } else if (focusedIndex !== null) {
        // Adjust focused index if it was shifted by the drag
        if (oldIndex < focusedIndex && newIndex >= focusedIndex) {
          onFocusPane(focusedIndex - 1);
        } else if (oldIndex > focusedIndex && newIndex <= focusedIndex) {
          onFocusPane(focusedIndex + 1);
        }
      }
    },
    [paneIds, onReorder, focusedIndex, onFocusPane],
  );

  const handleDoubleClick = useCallback(
    (index: number) => {
      setExpandedIndex((prev) => (prev === index ? null : index));
    },
    [],
  );

  const handleCloseDisconnectedPane = useCallback(
    (sessionId: string) => {
      if (!onReorder) return;

      const paneIndex = paneIds.indexOf(sessionId);
      if (paneIndex === -1) return;

      onReorder(paneIds.filter((id) => id !== sessionId));

      if (focusedIndex === null) return;
      if (focusedIndex === paneIndex) {
        onFocusPane(null);
      } else if (focusedIndex > paneIndex) {
        onFocusPane(focusedIndex - 1);
      }
    },
    [focusedIndex, onFocusPane, onReorder, paneIds],
  );

  // If a pane is expanded (double-click fullscreen), show only that pane
  if (expandedIndex !== null && orderedPanes[expandedIndex]) {
    const pane = orderedPanes[expandedIndex];
    return (
      <div data-testid="tiled-grid" className="flex h-full flex-col">
        {pane.kind === 'session' ? (
          <SessionPane
            session={pane.session}
            resolveSessionConnection={resolveSessionConnection}
            isDisconnected={isSessionDisconnected?.(pane.session) ?? false}
            isFocused={true}
            isExpanded={true}
            isDragging={false}
            onDoubleClick={() => handleDoubleClick(expandedIndex)}
            onFocus={() => onFocusPane(expandedIndex)}
            onClick={() => onSessionClick?.(pane.session)}
            onQuickAction={onQuickAction ? (r) => onQuickAction(pane.session, r) : undefined}
            onMarkWaiting={onMarkWaiting ? () => onMarkWaiting(pane.session) : undefined}
            onStop={() => onStopSession?.(pane.session)}
            stopDisabled={isSessionStopping?.(pane.session) ?? false}
            onArchive={() => onArchiveSession?.(pane.session)}
          />
        ) : (
          <DisconnectedPane
            sessionId={pane.id}
            isFocused={true}
            isExpanded={true}
            isDragging={false}
            onDoubleClick={() => handleDoubleClick(expandedIndex)}
            onFocus={() => onFocusPane(expandedIndex)}
            onClose={() => handleCloseDisconnectedPane(pane.id)}
          />
        )}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={paneIds} strategy={rectSortingStrategy}>
        <div
          data-testid="tiled-grid"
          className="grid h-full gap-1"
          style={{
            gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
            gridTemplateRows: `repeat(${config.rows}, 1fr)`,
          }}
        >
          {orderedPanes.map((pane, index) => (
            <SortablePane
              key={pane.id}
              pane={pane}
              resolveSessionConnection={resolveSessionConnection}
              isSessionDisconnected={isSessionDisconnected}
              isFocused={focusedIndex === index}
              isExpanded={false}
              onDoubleClick={() => handleDoubleClick(index)}
              onFocus={() => onFocusPane(index)}
              onClick={pane.kind === 'session' ? () => onSessionClick?.(pane.session) : undefined}
              onQuickAction={
                pane.kind === 'session' && onQuickAction
                  ? (r) => onQuickAction(pane.session, r)
                  : undefined
              }
              onMarkWaiting={
                pane.kind === 'session' && onMarkWaiting
                  ? () => onMarkWaiting(pane.session)
                  : undefined
              }
              onStop={pane.kind === 'session' ? () => onStopSession?.(pane.session) : undefined}
              stopDisabled={pane.kind === 'session' ? (isSessionStopping?.(pane.session) ?? false) : false}
              onArchive={pane.kind === 'session' ? () => onArchiveSession?.(pane.session) : undefined}
              onCloseDisconnectedPane={
                pane.kind === 'disconnected'
                  ? () => handleCloseDisconnectedPane(pane.id)
                  : undefined
              }
            />
          ))}
          {/* Empty pane placeholders */}
          {Array.from({ length: Math.max(0, config.maxPanes - orderedPanes.length) }).map((_, i) => (
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
      </SortableContext>
    </DndContext>
  );
}

// ── Global Status Indicator ─────────────────────────────────────

export interface GlobalStatusProps {
  sessions: SessionInfo[];
}

export function GlobalStatusIndicator({ sessions }: GlobalStatusProps) {
  const activeSessions = sessions.filter(
    (s) => s.status !== 'completed' && s.status !== 'archived',
  );
  const attentionCount = activeSessions.filter((s) => sessionNeedsAttention(s.status)).length;
  const allNormal = activeSessions.length > 0 && attentionCount === 0;

  if (activeSessions.length === 0) return null;

  return (
    <div
      data-testid="global-status-indicator"
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
        allNormal
          ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
          : 'bg-yellow-50 text-yellow-600 dark:bg-yellow-950/30 dark:text-yellow-400'
      }`}
    >
      {allNormal ? (
        <>
          <CheckCircle2 size={12} />
          <span>全部正常，无需介入</span>
        </>
      ) : (
        <>
          <span className="inline-block h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
          <span>{attentionCount} 个会话需要关注</span>
        </>
      )}
    </div>
  );
}

// ── SortablePane (dnd-kit wrapper) ──────────────────────────────

interface SortablePaneProps {
  pane: TiledPaneEntry;
  resolveSessionConnection: (session: SessionInfo) => {
    rtBaseUrl: string;
    authToken?: string;
  };
  isSessionDisconnected?: (session: SessionInfo) => boolean;
  isFocused: boolean;
  isExpanded: boolean;
  onDoubleClick: () => void;
  onFocus: () => void;
  onClick?: () => void;
  onQuickAction?: (response: QuickActionResponse) => void;
  onMarkWaiting?: () => void;
  onStop?: () => void;
  stopDisabled?: boolean;
  onArchive?: () => void;
  onCloseDisconnectedPane?: () => void;
}

function SortablePane(props: SortablePaneProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.pane.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {props.pane.kind === 'session' ? (
        <SessionPane
          session={props.pane.session}
          resolveSessionConnection={props.resolveSessionConnection}
          isDisconnected={props.isSessionDisconnected?.(props.pane.session) ?? false}
          isFocused={props.isFocused}
          isExpanded={props.isExpanded}
          isDragging={isDragging}
          onDoubleClick={props.onDoubleClick}
          onFocus={props.onFocus}
          onClick={props.onClick}
          dragListeners={listeners}
          onQuickAction={props.onQuickAction}
          onMarkWaiting={props.onMarkWaiting}
          onStop={props.onStop}
          stopDisabled={props.stopDisabled}
          onArchive={props.onArchive}
        />
      ) : (
        <DisconnectedPane
          sessionId={props.pane.id}
          isFocused={props.isFocused}
          isExpanded={props.isExpanded}
          isDragging={isDragging}
          onDoubleClick={props.onDoubleClick}
          onFocus={props.onFocus}
          onClose={props.onCloseDisconnectedPane}
          dragListeners={listeners}
        />
      )}
    </div>
  );
}

interface DisconnectedPaneProps {
  sessionId: string;
  isFocused: boolean;
  isExpanded: boolean;
  isDragging: boolean;
  onDoubleClick: () => void;
  onFocus: () => void;
  onClose?: () => void;
  dragListeners?: Record<string, Function>;
}

function DisconnectedPane({
  sessionId,
  isFocused,
  isExpanded,
  isDragging,
  onDoubleClick,
  onFocus,
  onClose,
  dragListeners,
}: DisconnectedPaneProps) {
  return (
    <div
      data-testid={`tiled-grid-disconnected-${sessionId}`}
      className={`
        flex h-full flex-col overflow-hidden rounded-lg border transition-all
        ${isDragging ? 'opacity-50 shadow-2xl ring-2 ring-[#A8A29E]/40' : ''}
        ${isFocused
          ? 'border-[#78716C]/60 shadow-[0_0_0_1px_rgba(120,113,108,0.2)]'
          : 'border-[#D6D3D1] bg-[#F5F5F4] dark:border-[#44403C] dark:bg-[#1C1917]'
        }
      `}
      onClick={onFocus}
    >
      <div
        className="flex items-center justify-between gap-2 border-b border-[#D6D3D1] bg-[#F5F5F4] px-2 py-1 dark:border-[#44403C] dark:bg-[#1C1917]"
        onDoubleClick={onDoubleClick}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {dragListeners && (
            <button
              type="button"
              className="flex-shrink-0 cursor-grab text-[#A8A29E] hover:text-[#78716C] active:cursor-grabbing dark:hover:text-[#D6D3D1]"
              {...dragListeners}
              onClick={(event) => event.stopPropagation()}
            >
              <GripVertical size={10} />
            </button>
          )}
          <span className="text-xs text-[#78716C]">✕</span>
          <span className="truncate text-xs font-semibold text-[#57534E] dark:text-[#D6D3D1]">
            已断开
          </span>
          {!isExpanded && (
            <span className="truncate text-[9px] text-[#A8A29E]">
              {sessionId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDoubleClick();
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
            title={isExpanded ? '还原' : '全屏'}
          >
            {isExpanded ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
          </button>
          <button
            type="button"
            data-testid={`tiled-grid-disconnected-close-${sessionId}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose?.();
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-[#78716C] hover:text-[#57534E] disabled:opacity-50 dark:hover:text-[#D6D3D1]"
            title="关闭"
            aria-label="关闭断开的会话窗格"
            disabled={!onClose}
          >
            <X size={10} />
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center bg-[#F5F5F4] px-4 text-center dark:bg-[#1C1917]">
        <div className="space-y-2">
          <p className="text-sm font-medium text-[#57534E] dark:text-[#D6D3D1]">
            会话已断开
          </p>
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">
            RT 可能已重启，此窗格保留原位置，关闭后会从布局中移除。
          </p>
        </div>
      </div>
    </div>
  );
}

// ── SessionPane ────────────────────────────────────────────────

interface SessionPaneProps {
  session: SessionInfo;
  resolveSessionConnection: (session: SessionInfo) => {
    rtBaseUrl: string;
    authToken?: string;
  };
  isDisconnected: boolean;
  isFocused: boolean;
  isExpanded: boolean;
  isDragging: boolean;
  onDoubleClick: () => void;
  onFocus: () => void;
  onClick?: () => void;
  dragListeners?: Record<string, Function>;
  onQuickAction?: (response: QuickActionResponse) => void;
  onMarkWaiting?: () => void;
  onStop?: () => void;
  stopDisabled?: boolean;
  onArchive?: () => void;
}

function SessionPane({
  session,
  resolveSessionConnection,
  isDisconnected,
  isFocused,
  isExpanded,
  isDragging,
  onDoubleClick,
  onFocus,
  onClick,
  dragListeners,
  onQuickAction,
  onMarkWaiting,
  onStop,
  stopDisabled = false,
  onArchive,
}: SessionPaneProps) {
  const statusIndicator = SESSION_STATUS_INDICATORS[session.status];
  const needsAttention = sessionNeedsAttention(session.status);
  const connection = resolveSessionConnection(session);
  const isCompleted = session.status === 'completed';
  const isTerminalCompleted = session.interaction_mode === 'terminal'
    && (session.status === 'completed' || session.status === 'archived');
  const [initialConnectionFailed, setInitialConnectionFailed] = useState(false);
  const showDisconnected = isDisconnected || initialConnectionFailed || isTerminalCompleted;
  const showQuickActions =
    !showDisconnected
    && session.status === 'waiting_input'
    && (session.quick_actions?.length ?? 0) > 0;
  const showManualMarkWaiting =
    !showDisconnected
    &&
    session.interaction_mode === 'terminal'
    && session.status === 'running'
    && (session.quick_actions?.length ?? 0) === 0;
  const canStopPty = !isCompleted && session.interaction_mode === 'terminal' && !!session.pty_id;
  const canArchive = isCompleted;

  useEffect(() => {
    setInitialConnectionFailed(false);
  }, [session.id, session.pty_id]);

  return (
    <div
      className={`
        flex h-full flex-col overflow-hidden rounded-lg border transition-all
        ${isDragging ? 'opacity-50 shadow-2xl ring-2 ring-[#C75B3A]/40' : ''}
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
        {/* Row 1: Drag handle + Status + Role + Time + Expand button */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Drag handle */}
            {dragListeners && (
              <button
                type="button"
                className="flex-shrink-0 cursor-grab text-[#A8A29E] hover:text-[#78716C] active:cursor-grabbing dark:hover:text-[#D6D3D1]"
                {...dragListeners}
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical size={10} />
              </button>
            )}
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
          showDisconnected ? (
            <div
              data-testid={`tiled-grid-pty-disconnected-${session.id}`}
              className="flex h-full items-center justify-center px-4 text-center"
            >
              <div className="space-y-2">
                <p className="text-sm font-medium text-[#FAFAF9]">终端已断开</p>
                <p className="text-xs text-[#A8A29E]">
                  当前 PTY 已不存在，RT 可能已经重启。可点击停止，将会话收敛为已完成后再归档。
                </p>
              </div>
            </div>
          ) : (
            <PtyTerminal
              rtBaseUrl={connection.rtBaseUrl}
              ptyId={session.pty_id}
              authToken={connection.authToken}
              autoFocus={false}
              onInitialConnectionFailure={() => {
                setInitialConnectionFailed(true);
              }}
            />
          )
        ) : (
          <div className="h-full overflow-auto p-2">
            <p className="whitespace-pre-wrap text-xs text-[#A8A29E] font-mono">
              {session.last_output_preview || session.summary || '等待输出...'}
            </p>
          </div>
        )}
      </div>

      {/* Quick action bar / manual wait action（动作栏 / 手动等待决策） */}
      {(showQuickActions || showManualMarkWaiting) && (
        <QuickActionBar
          actions={session.quick_actions ?? []}
          onSubmit={(response) => onQuickAction?.(response)}
          showMarkWaiting={showManualMarkWaiting}
          onMarkWaiting={() => onMarkWaiting?.()}
        />
      )}

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
          {canArchive ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onArchive?.();
              }}
              data-testid={`tiled-grid-archive-${session.id}`}
              aria-label="归档"
              disabled={!onArchive}
              className="flex h-5 w-5 items-center justify-center rounded text-[#57534E] hover:text-[#A8A29E] disabled:opacity-50 disabled:hover:text-[#57534E]"
              title="归档"
            >
              <X size={10} />
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!canStopPty || stopDisabled) return;
                onStop?.();
              }}
              data-testid={`tiled-grid-stop-${session.id}`}
              aria-label={stopDisabled ? '停止中' : '停止'}
              disabled={!canStopPty || !onStop || stopDisabled}
              className="flex h-5 w-5 items-center justify-center rounded text-[#57534E] hover:text-[#A8A29E] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-[#57534E]"
              title={stopDisabled ? '停止中' : '停止'}
            >
              {stopDisabled ? <Loader2 size={10} className="animate-spin" /> : <Square size={10} />}
            </button>
          )}
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
