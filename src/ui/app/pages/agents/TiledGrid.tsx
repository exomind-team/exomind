import { useState, useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
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
  AGENT_KIND_COLORS,
  AGENT_KIND_LABELS,
  sessionNeedsAttention,
  formatRelativeTime,
} from '@/lib/types/session';
import {
  PtyTerminal,
  type PtyTransportPresentationState,
} from '../../components/PtyTerminal';
import { retryPtyInputTransport } from '../../components/pty-input';
import { QuickActionBar } from './QuickActionBar';
import type { QuickActionResponse } from '@/lib/types/session';
import type { TiledLayout } from './tiled-layout';
import {
  flattenTiledPaneTreeSlotIds,
  type TiledPaneSlotBinding,
  type TiledPaneSplitAxis,
  type TiledPaneTreeNode,
  type TiledPaneTreePath,
} from './tiled-pane-tree';
import { SessionStatusMark } from './SessionStatusMark';

// ── Types ──────────────────────────────────────────────────────

export type { TiledLayout } from './tiled-layout';

export interface TiledGridProps {
  sessions: SessionInfo[];
  layout: TiledLayout;
  tree?: TiledPaneTreeNode;
  slots?: TiledPaneSlotBinding[];
  paneTree?: TiledPaneTreeNode;
  paneSlots?: TiledPaneSlotBinding[];
  resolveSessionConnection: (session: SessionInfo) => {
    rtBaseUrl: string;
    authToken?: string;
  };
  /** Currently focused pane index */
  focusedIndex: number | null;
  onFocusPane: (index: number | null) => void;
  focusedSlotId?: string | null;
  onFocusSlot?: (slotId: string | null) => void;
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
  isSessionAutoResuming?: (session: SessionInfo) => boolean;
  isSessionStopping?: (session: SessionInfo) => boolean;
  onSplitSlot?: (slotId: string, axis: TiledPaneSplitAxis) => void;
  onResizeSplit?: (path: TiledPaneTreePath, ratio: number) => void;
  onClearSlot?: (slotId: string) => void;
  onCloseSlot?: (slotId: string) => void;
  onOpenEmptySlot?: (slotId: string) => void;
  onSpawnInSlot?: (slotId: string) => void;
  onResumeRecoverableSlot?: (slotId: string) => void;
  slotStates?: Record<string, TiledSlotState | undefined>;
  unassignedSessions?: SessionInfo[];
  unassignedPoolCollapsed?: boolean;
  onToggleUnassignedPool?: () => void;
  onAssignSessionToSlot?: (slotId: string, sessionId: string) => void;
  onBindSessionToSlot?: (slotId: string, sessionId: string) => void;
}

export interface TiledSlotState {
  status: 'creating' | 'error';
  message?: string;
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

type TreePaneEntry =
  | {
    id: string;
    slotId: string;
    kind: 'session';
    session: SessionInfo;
  }
  | {
    id: string;
    slotId: string;
    kind: 'disconnected';
    sessionId?: string;
    recoverable?: boolean;
  }
  | {
    id: string;
    slotId: string;
    kind: 'empty';
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
  tree,
  slots,
  paneTree,
  paneSlots,
  resolveSessionConnection,
  focusedIndex,
  onFocusPane,
  focusedSlotId,
  onFocusSlot,
  onSessionClick,
  paneOrder,
  onReorder,
  onQuickAction,
  onMarkWaiting,
  onStopSession,
  onArchiveSession,
  isSessionDisconnected,
  isSessionAutoResuming,
  isSessionStopping,
  onSplitSlot,
  onResizeSplit,
  onClearSlot,
  onCloseSlot,
  onOpenEmptySlot,
  onSpawnInSlot,
  onResumeRecoverableSlot,
  slotStates,
  unassignedSessions,
  unassignedPoolCollapsed,
  onToggleUnassignedPool,
  onAssignSessionToSlot,
  onBindSessionToSlot,
}: TiledGridProps) {
  const resolvedTree = paneTree ?? tree;
  const resolvedSlots = paneSlots ?? slots;
  const handleOpenEmptySlot = onSpawnInSlot ?? onOpenEmptySlot;
  const handleAssignSessionToSlot = onBindSessionToSlot ?? onAssignSessionToSlot;

  if (resolvedTree && resolvedSlots) {
    return (
      <PaneTreeGrid
        sessions={sessions}
        tree={resolvedTree}
        slots={resolvedSlots}
        slotStates={slotStates}
        resolveSessionConnection={resolveSessionConnection}
        focusedIndex={focusedIndex}
        onFocusPane={onFocusPane}
        focusedSlotId={focusedSlotId ?? null}
        onFocusSlot={onFocusSlot}
        onSessionClick={onSessionClick}
        onQuickAction={onQuickAction}
        onMarkWaiting={onMarkWaiting}
        onStopSession={onStopSession}
        onArchiveSession={onArchiveSession}
        isSessionDisconnected={isSessionDisconnected}
        isSessionAutoResuming={isSessionAutoResuming}
        isSessionStopping={isSessionStopping}
        onSplitSlot={onSplitSlot}
        onResizeSplit={onResizeSplit}
        onClearSlot={onClearSlot}
        onCloseSlot={onCloseSlot}
        onOpenEmptySlot={handleOpenEmptySlot}
        onResumeRecoverableSlot={onResumeRecoverableSlot}
        unassignedSessions={unassignedSessions}
        unassignedPoolCollapsed={unassignedPoolCollapsed}
        onToggleUnassignedPool={onToggleUnassignedPool}
        onAssignSessionToSlot={handleAssignSessionToSlot}
      />
    );
  }

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
            isAutoResuming={isSessionAutoResuming?.(pane.session) ?? false}
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
              isSessionAutoResuming={isSessionAutoResuming}
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
              className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-[#E7E5E4] bg-[#FAFAF9] dark:border-[#292524] dark:bg-[#0C0A09]"
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

interface PaneTreeGridProps {
  sessions: SessionInfo[];
  tree: TiledPaneTreeNode;
  slots: TiledPaneSlotBinding[];
  slotStates?: Record<string, TiledSlotState | undefined>;
  resolveSessionConnection: (session: SessionInfo) => {
    rtBaseUrl: string;
    authToken?: string;
  };
  focusedIndex: number | null;
  onFocusPane: (index: number | null) => void;
  focusedSlotId: string | null;
  onFocusSlot?: (slotId: string | null) => void;
  onSessionClick?: (session: SessionInfo) => void;
  onQuickAction?: (session: SessionInfo, response: QuickActionResponse) => void;
  onMarkWaiting?: (session: SessionInfo) => void;
  onStopSession?: (session: SessionInfo) => void;
  onArchiveSession?: (session: SessionInfo) => void;
  isSessionDisconnected?: (session: SessionInfo) => boolean;
  isSessionAutoResuming?: (session: SessionInfo) => boolean;
  isSessionStopping?: (session: SessionInfo) => boolean;
  onSplitSlot?: (slotId: string, axis: TiledPaneSplitAxis) => void;
  onResizeSplit?: (path: TiledPaneTreePath, ratio: number) => void;
  onClearSlot?: (slotId: string) => void;
  onCloseSlot?: (slotId: string) => void;
  onOpenEmptySlot?: (slotId: string) => void;
  onResumeRecoverableSlot?: (slotId: string) => void;
  unassignedSessions?: SessionInfo[];
  unassignedPoolCollapsed?: boolean;
  onToggleUnassignedPool?: () => void;
  onAssignSessionToSlot?: (slotId: string, sessionId: string) => void;
}

function PaneTreeGrid({
  sessions,
  tree,
  slots,
  resolveSessionConnection,
  focusedIndex,
  onFocusPane,
  focusedSlotId,
  onFocusSlot,
  onSessionClick,
  onQuickAction,
  onMarkWaiting,
  onStopSession,
  onArchiveSession,
  isSessionDisconnected,
  isSessionAutoResuming,
  isSessionStopping,
  onSplitSlot,
  onResizeSplit,
  onClearSlot,
  onCloseSlot,
  onOpenEmptySlot,
  onResumeRecoverableSlot,
  slotStates,
  unassignedSessions = [],
  unassignedPoolCollapsed = false,
  onToggleUnassignedPool,
  onAssignSessionToSlot,
}: PaneTreeGridProps) {
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);
  const orderedSlotIds = useMemo(() => flattenTiledPaneTreeSlotIds(tree), [tree]);
  const slotMap = useMemo(
    () => new Map(slots.map((slot) => [slot.slotId, slot])),
    [slots],
  );
  const sessionMap = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const resolvedFocusedSlotId = focusedSlotId ?? (
    focusedIndex != null ? orderedSlotIds[focusedIndex] ?? null : null
  );

  const treeEntries = useMemo(() => {
    const next = new Map<string, TreePaneEntry>();

    orderedSlotIds.forEach((slotId) => {
      const slot = slotMap.get(slotId);
      const sessionId = slot?.sessionId?.trim();
      const session = sessionId ? sessionMap.get(sessionId) : undefined;

      if (session) {
        next.set(slotId, {
          id: slotId,
          slotId,
          kind: 'session',
          session,
        });
        return;
      }

      if (sessionId || slot?.terminalRecovery) {
        next.set(slotId, {
          id: slotId,
          slotId,
          kind: 'disconnected',
          ...(sessionId ? { sessionId } : {}),
          ...(slot?.terminalRecovery ? { recoverable: true } : {}),
        });
        return;
      }

      next.set(slotId, {
        id: slotId,
        slotId,
        kind: 'empty',
      });
    });

    return next;
  }, [orderedSlotIds, sessionMap, slotMap]);

  useEffect(() => {
    if (expandedSlotId && !orderedSlotIds.includes(expandedSlotId)) {
      setExpandedSlotId(null);
    }
  }, [expandedSlotId, orderedSlotIds]);

  const handleFocusSlot = useCallback((slotId: string | null) => {
    onFocusSlot?.(slotId);
    if (slotId == null) {
      onFocusPane(null);
      return;
    }
    const index = orderedSlotIds.indexOf(slotId);
    onFocusPane(index === -1 ? null : index);
  }, [onFocusPane, onFocusSlot, orderedSlotIds]);

  const handleToggleExpanded = useCallback((slotId: string) => {
    setExpandedSlotId((prev) => (prev === slotId ? null : slotId));
  }, []);

  const renderSlotEntry = useCallback((slotId: string) => {
    const entry = treeEntries.get(slotId) ?? {
      id: slotId,
      slotId,
      kind: 'empty' as const,
    };
    const slotState = slotStates?.[slotId] ?? null;
    const isFocused = resolvedFocusedSlotId === slotId;
    const commonSlotActions = {
      onSplitHorizontal: onSplitSlot ? () => onSplitSlot(slotId, 'horizontal') : undefined,
      onSplitVertical: onSplitSlot ? () => onSplitSlot(slotId, 'vertical') : undefined,
      onClear: onClearSlot ? () => onClearSlot(slotId) : undefined,
      onClose: onCloseSlot ? () => onCloseSlot(slotId) : undefined,
    };

    if (entry.kind === 'session') {
      return (
        <SessionPane
          key={slotId}
          slotId={slotId}
          session={entry.session}
          resolveSessionConnection={resolveSessionConnection}
          isDisconnected={isSessionDisconnected?.(entry.session) ?? false}
          isAutoResuming={isSessionAutoResuming?.(entry.session) ?? false}
          isFocused={isFocused}
          isExpanded={expandedSlotId === slotId}
          isDragging={false}
          onDoubleClick={() => handleToggleExpanded(slotId)}
          onFocus={() => handleFocusSlot(slotId)}
          onClick={() => onSessionClick?.(entry.session)}
          onQuickAction={onQuickAction ? (response) => onQuickAction(entry.session, response) : undefined}
          onMarkWaiting={onMarkWaiting ? () => onMarkWaiting(entry.session) : undefined}
          onStop={onStopSession ? () => onStopSession(entry.session) : undefined}
          stopDisabled={isSessionStopping?.(entry.session) ?? false}
          onArchive={onArchiveSession ? () => onArchiveSession(entry.session) : undefined}
          onSplitHorizontal={commonSlotActions.onSplitHorizontal}
          onSplitVertical={commonSlotActions.onSplitVertical}
          onClear={commonSlotActions.onClear}
          onClose={commonSlotActions.onClose}
        />
      );
    }

    if (entry.kind === 'disconnected') {
      return (
        <DisconnectedPane
          key={slotId}
          slotId={slotId}
          sessionId={entry.sessionId ?? slotId}
          isFocused={isFocused}
          isExpanded={expandedSlotId === slotId}
          isDragging={false}
          onDoubleClick={() => handleToggleExpanded(slotId)}
          onFocus={() => handleFocusSlot(slotId)}
          onClose={commonSlotActions.onClose}
          onClear={commonSlotActions.onClear}
          {...(entry.recoverable
            ? {
                title: '可恢复终端',
                description: '当前窗格保留了历史终端身份；可尝试恢复，或清空后重新绑定其他会话。',
                primaryActionLabel: '恢复',
                onPrimaryAction: onResumeRecoverableSlot ? () => onResumeRecoverableSlot(slotId) : undefined,
              }
            : {})}
          onSplitHorizontal={commonSlotActions.onSplitHorizontal}
          onSplitVertical={commonSlotActions.onSplitVertical}
        />
      );
    }

    return (
      <EmptyPane
        key={slotId}
        slotId={slotId}
        isFocused={isFocused}
        onFocus={() => handleFocusSlot(slotId)}
        onOpen={() => onOpenEmptySlot?.(slotId)}
        slotState={slotState}
        unassignedSessions={unassignedSessions}
        onAssignSession={onAssignSessionToSlot}
        onSplitHorizontal={commonSlotActions.onSplitHorizontal}
        onSplitVertical={commonSlotActions.onSplitVertical}
        onClose={commonSlotActions.onClose}
      />
    );
  }, [
    expandedSlotId,
    handleFocusSlot,
    handleToggleExpanded,
    isSessionAutoResuming,
    isSessionDisconnected,
    isSessionStopping,
    onArchiveSession,
    onClearSlot,
    onCloseSlot,
    onMarkWaiting,
    onOpenEmptySlot,
    onAssignSessionToSlot,
    onQuickAction,
    onResumeRecoverableSlot,
    onSessionClick,
    onSplitSlot,
    onStopSession,
    resolveSessionConnection,
    resolvedFocusedSlotId,
    slotStates,
    treeEntries,
    unassignedSessions,
  ]);

  const renderTree = useCallback((node: TiledPaneTreeNode, path: TiledPaneTreePath = []) => {
    if (node.type === 'slot') {
      return (
        <div key={node.slotId} className="h-full min-h-0 min-w-0">
          {renderSlotEntry(node.slotId)}
        </div>
      );
    }

    return (
      <div
        key={path.join('-') || 'root'}
        className={`flex h-full min-h-0 min-w-0 ${node.axis === 'vertical' ? 'flex-row' : 'flex-col'}`}
      >
        <div className="h-full min-h-0 min-w-0" style={{ flex: `0 0 ${node.ratio * 100}%` }}>
          {renderTree(node.children[0], [...path, 0])}
        </div>
        <SplitResizeHandle
          axis={node.axis}
          onResize={onResizeSplit ? (ratio) => onResizeSplit(path, ratio) : undefined}
        />
        <div className="h-full min-h-0 min-w-0 flex-1">
          {renderTree(node.children[1], [...path, 1])}
        </div>
      </div>
    );
  }, [onResizeSplit, renderSlotEntry]);

  const expandedEntry = expandedSlotId ? treeEntries.get(expandedSlotId) : null;
  const canAssignToFocusedSlot = !!resolvedFocusedSlotId && !!onAssignSessionToSlot;

  return (
    <div data-testid="tiled-grid" className="flex h-full min-h-0 flex-col gap-2">
      {unassignedSessions.length > 0 ? (
        <div className="rounded-lg border border-[#E7E5E4] bg-[#FAFAF9] p-2 dark:border-[#292524] dark:bg-[#0C0A09]">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-[#57534E] dark:text-[#D6D3D1]">
              未分配会话池
            </div>
            <button
              type="button"
              className="text-[10px] text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
              onClick={() => onToggleUnassignedPool?.()}
            >
              {unassignedPoolCollapsed ? '展开' : '收起'}
            </button>
          </div>
          {!unassignedPoolCollapsed ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unassignedSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="rounded-full border border-[#E7E5E4] px-2 py-1 text-[10px] text-[#57534E] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#292524] dark:text-[#D6D3D1]"
                  onClick={() => {
                    if (!resolvedFocusedSlotId || !onAssignSessionToSlot) {
                      return;
                    }
                    onAssignSessionToSlot(resolvedFocusedSlotId, session.id);
                  }}
                  disabled={!canAssignToFocusedSlot}
                >
                  {session.role || session.id}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {expandedEntry ? (
          <div className="h-full min-h-0">
            {renderSlotEntry(expandedEntry.slotId)}
          </div>
        ) : (
          renderTree(tree)
        )}
      </div>
    </div>
  );
}

interface SplitResizeHandleProps {
  axis: TiledPaneSplitAxis;
  onResize?: (ratio: number) => void;
}

function SplitResizeHandle({ axis, onResize }: SplitResizeHandleProps) {
  const handleMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!onResize) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const parent = event.currentTarget.parentElement;
    if (!parent) {
      return;
    }

    const rect = parent.getBoundingClientRect();
    const handleMove = (moveEvent: MouseEvent) => {
      const ratio = axis === 'vertical'
        ? (moveEvent.clientX - rect.left) / Math.max(rect.width, 1)
        : (moveEvent.clientY - rect.top) / Math.max(rect.height, 1);
      onResize(ratio);
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [axis, onResize]);

  return (
    <button
      type="button"
      aria-label={axis === 'vertical' ? '调整竖向分隔比例' : '调整横向分隔比例'}
      className={axis === 'vertical'
        ? 'h-full w-2 shrink-0 cursor-col-resize bg-transparent hover:bg-[#E7E5E4] dark:hover:bg-[#292524]'
        : 'h-2 w-full shrink-0 cursor-row-resize bg-transparent hover:bg-[#E7E5E4] dark:hover:bg-[#292524]'}
      onMouseDown={handleMouseDown}
    />
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
  isSessionAutoResuming?: (session: SessionInfo) => boolean;
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
          isAutoResuming={props.isSessionAutoResuming?.(props.pane.session) ?? false}
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
  slotId?: string;
  sessionId: string;
  isFocused: boolean;
  isExpanded: boolean;
  isDragging: boolean;
  onDoubleClick: () => void;
  onFocus: () => void;
  onClose?: () => void;
  dragListeners?: Record<string, Function>;
  title?: string;
  description?: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onClear?: () => void;
}

function PaneWorkbenchActions({
  onSplitHorizontal,
  onSplitVertical,
  onClear,
  onClose,
}: {
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onClear?: () => void;
  onClose?: () => void;
}) {
  if (!onSplitHorizontal && !onSplitVertical && !onClear && !onClose) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      {onSplitHorizontal && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSplitHorizontal();
          }}
          className="rounded px-1 py-0.5 text-[10px] text-[#78716C] hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
          title="水平分割"
        >
          横分
        </button>
      )}
      {onSplitVertical && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSplitVertical();
          }}
          className="rounded px-1 py-0.5 text-[10px] text-[#78716C] hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
          title="垂直分割"
        >
          纵分
        </button>
      )}
      {onClear && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClear();
          }}
          className="rounded px-1 py-0.5 text-[10px] text-[#78716C] hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
          title="清空窗格"
        >
          清空
        </button>
      )}
      {onClose && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="rounded px-1 py-0.5 text-[10px] text-[#78716C] hover:text-[#1C1917] dark:hover:text-[#FAFAF9]"
          title="关闭窗格"
        >
          关闭
        </button>
      )}
    </div>
  );
}

function DisconnectedPane({
  slotId,
  sessionId,
  isFocused,
  isExpanded,
  isDragging,
  onDoubleClick,
  onFocus,
  onClose,
  dragListeners,
  title = '已断开',
  description = 'RT 可能已重启，此窗格保留原位置，关闭后会从布局中移除。',
  primaryActionLabel,
  onPrimaryAction,
  onSplitHorizontal,
  onSplitVertical,
  onClear,
}: DisconnectedPaneProps) {
  return (
    <div
      data-testid={slotId ? `tiled-slot-${slotId}` : `tiled-grid-disconnected-${sessionId}`}
      className={`
        flex h-full min-h-0 flex-col overflow-hidden rounded-lg border transition-all
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
            {title}
          </span>
          {!isExpanded && (
            <span className="truncate text-[9px] text-[#A8A29E]">
              {sessionId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <PaneWorkbenchActions
            onSplitHorizontal={onSplitHorizontal}
            onSplitVertical={onSplitVertical}
            onClear={onClear}
          />
          {onPrimaryAction && primaryActionLabel && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onPrimaryAction();
              }}
              className="rounded px-1 py-0.5 text-[10px] text-[#0F766E] hover:text-[#115E59]"
              title={primaryActionLabel}
            >
              {primaryActionLabel}
            </button>
          )}
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
            {title === '已断开' ? '会话已断开' : title}
          </p>
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}

interface EmptyPaneProps {
  slotId: string;
  isFocused: boolean;
  onFocus: () => void;
  onOpen?: () => void;
  slotState?: TiledSlotState | null;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onClose?: () => void;
  unassignedSessions?: SessionInfo[];
  onAssignSession?: (slotId: string, sessionId: string) => void;
}

function EmptyPane({
  slotId,
  isFocused,
  onFocus,
  onOpen,
  slotState,
  onSplitHorizontal,
  onSplitVertical,
  onClose,
  unassignedSessions = [],
  onAssignSession,
}: EmptyPaneProps) {
  return (
    <div
      data-testid={`tiled-slot-${slotId}`}
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-dashed transition-colors ${
        isFocused
          ? 'border-[#C75B3A]/50 bg-[#FFF7ED] dark:bg-[#1C1917]'
          : 'border-[#D6D3D1] bg-[#FAFAF9] dark:border-[#44403C] dark:bg-[#0C0A09]'
      }`}
      onClick={onFocus}
    >
      <div className="flex items-center justify-between border-b border-dashed border-[#E7E5E4] px-2 py-1 dark:border-[#292524]">
        <span className="truncate text-[10px] font-medium text-[#78716C] dark:text-[#A8A29E]">
          {slotState?.status === 'creating'
            ? '创建中'
            : slotState?.status === 'error'
              ? '创建失败'
              : '空窗格'}
        </span>
        <PaneWorkbenchActions
          onSplitHorizontal={onSplitHorizontal}
          onSplitVertical={onSplitVertical}
          onClose={onClose}
        />
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        {slotState?.status === 'creating' ? (
          <>
            <div className="flex items-center gap-2 text-sm font-medium text-[#57534E] dark:text-[#D6D3D1]">
              <Loader2 size={14} className="animate-spin" />
              <span>正在创建终端</span>
            </div>
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">
              参数已提交到运行时；终端准备完成后会自动绑定回这个窗格。
            </p>
          </>
        ) : slotState?.status === 'error' ? (
          <>
            <p className="text-sm font-medium text-[#9A3412] dark:text-[#FDBA74]">
              创建失败
            </p>
            <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">
              {slotState.message || '终端创建未成功，请重试或改为绑定已有会话。'}
            </p>
          </>
        ) : (
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">
            选择已有会话，或新建终端代理绑定到这个窗格。
          </p>
        )}
        <div className="flex max-h-full w-full flex-wrap items-center justify-center gap-2 overflow-auto">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen?.();
            }}
            className="rounded-md border border-[#D6D3D1] bg-white px-3 py-1 text-xs font-medium text-[#1C1917] hover:border-[#C75B3A]/50 dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#FAFAF9]"
          >
            {slotState?.status === 'error' ? '重新打开创建器' : '新建终端'}
          </button>
          {unassignedSessions.map((session) => (
            <button
              key={session.id}
              type="button"
              data-testid={`tiled-slot-bind-${slotId}-${session.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onAssignSession?.(slotId, session.id);
              }}
              className="rounded-md border border-[#D6D3D1] bg-white px-3 py-1 text-xs text-[#57534E] hover:border-[#C75B3A]/50 dark:border-[#44403C] dark:bg-[#1C1917] dark:text-[#E7E5E4]"
            >
              {`绑定 ${session.role || session.id}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── SessionPane ────────────────────────────────────────────────

interface SessionPaneProps {
  slotId?: string;
  session: SessionInfo;
  resolveSessionConnection: (session: SessionInfo) => {
    rtBaseUrl: string;
    authToken?: string;
  };
  isDisconnected: boolean;
  isAutoResuming: boolean;
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
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onClear?: () => void;
  onClose?: () => void;
}

function SessionPane({
  slotId,
  session,
  resolveSessionConnection,
  isDisconnected,
  isAutoResuming,
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
  onSplitHorizontal,
  onSplitVertical,
  onClear,
  onClose,
}: SessionPaneProps) {
  const statusIndicator = SESSION_STATUS_INDICATORS[session.status];
  const agentColor = AGENT_KIND_COLORS[session.agent_kind];
  const needsAttention = sessionNeedsAttention(session.status);
  const connection = resolveSessionConnection(session);
  const isCompleted = session.status === 'completed';
  const isTerminalCompleted = session.interaction_mode === 'terminal'
    && (session.status === 'completed' || session.status === 'archived');
  const isTerminalMissingPty = session.interaction_mode === 'terminal'
    && !session.pty_id
    && !isTerminalCompleted;
  const shouldRenderLiveTerminal = session.interaction_mode === 'terminal'
    && !!session.pty_id
    && !isTerminalCompleted;
  const [initialConnectionFailed, setInitialConnectionFailed] = useState(false);
  const [terminalNonce, setTerminalNonce] = useState(0);
  const [transportPresentationState, setTransportPresentationState] =
    useState<PtyTransportPresentationState | null>(null);
  const previousRecoveryStateRef = useRef({
    isDisconnected,
    isAutoResuming,
  });
  const showDisconnected = isDisconnected || initialConnectionFailed || isTerminalCompleted;
  const showTerminalUnavailable = showDisconnected || isTerminalMissingPty;
  const showFooterTerminalUnavailable =
    !isTerminalCompleted && showTerminalUnavailable;
  const showQuickActions =
    !showTerminalUnavailable
    && session.status === 'waiting_input'
    && (session.quick_actions?.length ?? 0) > 0;
  const showManualMarkWaiting =
    !showTerminalUnavailable
    &&
    session.interaction_mode === 'terminal'
    && session.status === 'running'
    && (session.quick_actions?.length ?? 0) === 0;
  const canResolveTerminal = !isTerminalCompleted && session.interaction_mode === 'terminal';
  const canArchive = isCompleted;
  const stopLabel = stopDisabled
    ? (session.pty_id ? '停止中' : '处理中')
    : (session.pty_id ? '停止' : '结束');

  useEffect(() => {
    setInitialConnectionFailed(false);
    setTerminalNonce(0);
    setTransportPresentationState(null);
    previousRecoveryStateRef.current = {
      isDisconnected,
      isAutoResuming,
    };
  }, [isAutoResuming, isDisconnected, session.id, session.pty_id]);

  const footerStatus = showFooterTerminalUnavailable
    ? {
        text: isAutoResuming
          ? '终端恢复中'
          : isTerminalMissingPty
            ? '终端会话缺少 PTY'
            : '终端已断开',
        color: isAutoResuming ? '#99F6E4' : '#A8A29E',
      }
    : transportPresentationState
      ? {
          text: transportPresentationState.message,
          color:
            transportPresentationState.kind === 'output-reconnecting'
              ? '#99F6E4'
              : '#FDE68A',
        }
      : session.status === 'waiting_input' ||
          session.status === 'paused' ||
          session.status === 'error'
        ? {
            text: statusIndicator.label,
            color: statusIndicator.color,
          }
        : null;
  const canRetryInputTransport =
    transportPresentationState?.kind === 'input-readonly' &&
    !showFooterTerminalUnavailable &&
    !!session.pty_id;
  const inputRetryActionLabel =
    transportPresentationState?.kind === 'input-readonly'
      ? transportPresentationState.actionLabel
      : null;

  useEffect(() => {
    const previousRecoveryState = previousRecoveryStateRef.current;
    const hasRecoveredFromDisconnectedState = (
      (previousRecoveryState.isDisconnected || previousRecoveryState.isAutoResuming)
      && !isDisconnected
      && !isAutoResuming
    );

    if (hasRecoveredFromDisconnectedState) {
      setInitialConnectionFailed(false);
      setTerminalNonce((prev) => prev + 1);
    }

    previousRecoveryStateRef.current = {
      isDisconnected,
      isAutoResuming,
    };
  }, [isAutoResuming, isDisconnected]);

  return (
    <div
      data-testid={slotId ? `tiled-slot-${slotId}` : undefined}
      data-session-id={session.id}
      data-pty-id={session.pty_id ?? ""}
      className={`
        flex h-full min-h-0 flex-col overflow-hidden rounded-lg border transition-all
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
        {/* Row 1: Drag handle + Status + Role + Agent + Time + Expand button */}
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
            <SessionStatusMark
              status={session.status}
              size={9}
              className="h-4 w-4"
            />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#1C1917] dark:text-[#FAFAF9]">
              {session.role || '未命名'}
            </span>
            <div
              data-testid={`tiled-grid-pane-meta-${session.id}`}
              className="flex shrink-0 items-center gap-1 text-[10px]"
            >
              <span
                className="font-medium"
                style={{ color: agentColor }}
              >
                {AGENT_KIND_LABELS[session.agent_kind]}
              </span>
              <span className="text-[#A8A29E]">·</span>
              <span className="text-[#A8A29E]">
                {formatRelativeTime(session.last_active_at)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <PaneWorkbenchActions
              onSplitHorizontal={onSplitHorizontal}
              onSplitVertical={onSplitVertical}
              onClear={onClear}
              onClose={onClose}
            />
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
      <div className="relative flex-1 min-h-0 overflow-hidden bg-[#1C1917]">
        {shouldRenderLiveTerminal ? (
          <>
            <PtyTerminal
              key={`${session.id}:${session.pty_id}:${terminalNonce}`}
              rtBaseUrl={connection.rtBaseUrl}
              ptyId={session.pty_id!}
              authToken={connection.authToken}
              inputPaused={showDisconnected}
              autoFocus={false}
              onInitialConnectionFailure={() => {
                setInitialConnectionFailed(true);
              }}
              onPtyUnavailable={() => {
                setInitialConnectionFailed(true);
              }}
              onTransportPresentationChange={setTransportPresentationState}
            />
            {showTerminalUnavailable ? (
              <div
                data-testid={`tiled-grid-pty-disconnected-${session.id}`}
                className="absolute inset-0 flex flex-col"
              >
                <div className="space-y-2 border-b border-[#292524] bg-[#1C1917]/92 px-4 py-3 text-left backdrop-blur-sm">
                  <p className="text-sm font-medium text-[#FAFAF9]">
                    {isTerminalMissingPty
                      ? '终端会话缺少 PTY'
                      : isAutoResuming
                        ? '终端恢复中'
                        : '终端已断开'}
                  </p>
                  <p className="text-xs text-[#A8A29E]">
                    {isTerminalCompleted
                      ? '当前会话已结束；保留已加载的 Terminal 内容，后续可直接归档。'
                      : isTerminalMissingPty
                        ? '当前会话记录仍然活跃，但没有关联 PTY。可点击结束将其完成，或点开会话尝试恢复历史终端。'
                      : isAutoResuming
                        ? '正在尝试自动恢复当前终端会话；恢复成功后会自动切回实时 Terminal。'
                        : '当前 PTY 已不存在，RT 可能已经重启。保留已加载的 Terminal 内容，必要时可点击停止收敛后归档。'}
                  </p>
                </div>
                {isAutoResuming ? (
                  <div className="flex flex-1 items-center justify-center px-4 text-center">
                    <div className="inline-flex items-center gap-2 rounded-full bg-[#1C1917]/88 px-3 py-1.5 text-xs text-[#E7E5E4] backdrop-blur-sm">
                      <Loader2 size={12} className="animate-spin" />
                      正在恢复会话…
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : isTerminalCompleted || isTerminalMissingPty ? (
          <div
            data-testid={`tiled-grid-pty-disconnected-${session.id}`}
            className="flex h-full items-center justify-center px-4 text-center"
          >
            <div className="space-y-2">
              <p className="text-sm font-medium text-[#FAFAF9]">
                {isTerminalMissingPty ? '终端会话缺少 PTY' : '终端会话已结束'}
              </p>
              <p className="text-xs text-[#A8A29E]">
                {isTerminalMissingPty
                  ? '该会话仍处于活跃状态，但没有关联 PTY。可点击结束将其完成，或点开会话尝试恢复。'
                  : '当前 PTY 已关闭；保留会话卡片以便直接归档。'}
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-auto p-2">
            <p className="whitespace-pre-wrap text-xs text-[#A8A29E] font-mono">
              {session.last_output_preview || session.summary || '等待输出...'}
            </p>
          </div>
        )}
      </div>

      {/* Quick action bar（动作栏） */}
      {showQuickActions && (
        <QuickActionBar
          actions={session.quick_actions ?? []}
          onSubmit={(response) => onQuickAction?.(response)}
        />
      )}

      {/* Pane action bar (32px) */}
      <div className="flex items-center justify-between border-t border-[#292524] bg-[#1C1917] px-2 py-1">
        {footerStatus ? (
          <span
            data-testid={`tiled-grid-footer-status-${session.id}`}
            className="text-[10px] font-medium"
            style={{ color: footerStatus.color }}
          >
            {footerStatus.text}
          </span>
        ) : showManualMarkWaiting ? (
          <button
            type="button"
            data-testid={`tiled-grid-mark-waiting-${session.id}`}
            onClick={(event) => {
              event.stopPropagation();
              onMarkWaiting?.();
            }}
            disabled={!onMarkWaiting}
            className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium text-amber-300 transition-colors hover:bg-amber-400/10 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-amber-300"
            title="手动标记此会话为等待决策状态"
          >
            等待决策
          </button>
        ) : (
          <span className="text-[10px] text-[#57534E]">
            {session.turn_count > 0 ? `${session.turn_count} turns` : ''}
          </span>
        )}
        <div className="flex items-center gap-1">
          {canRetryInputTransport ? (
            <button
              type="button"
              data-testid={`tiled-grid-retry-input-${session.id}`}
              onClick={(event) => {
                event.stopPropagation();
                retryPtyInputTransport({
                  rtBaseUrl: connection.rtBaseUrl,
                  ptyId: session.pty_id!,
                  authToken: connection.authToken,
                });
              }}
              className="rounded border border-[#A16207] px-1.5 py-0.5 text-[10px] font-medium text-[#FDE68A] transition-colors hover:border-[#CA8A04] hover:text-[#FEF3C7]"
              title={inputRetryActionLabel ?? '重连输入'}
            >
              {inputRetryActionLabel ?? '重连输入'}
            </button>
          ) : null}
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
                if (!canResolveTerminal || stopDisabled) return;
                onStop?.();
              }}
              data-testid={`tiled-grid-stop-${session.id}`}
              aria-label={stopLabel}
              disabled={!canResolveTerminal || !onStop || stopDisabled}
              className="flex h-5 w-5 items-center justify-center rounded text-[#57534E] hover:text-[#A8A29E] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-[#57534E]"
              title={stopLabel}
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
