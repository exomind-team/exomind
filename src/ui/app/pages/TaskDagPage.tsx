import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { LocateFixed } from "lucide-react";
import { PageShell } from "@/ui/app/components/PageShell";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type NodeChange,
  type HandleType,
  type NodeProps as FlowNodeProps,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "@/components/ui/toast-hook";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getTaskService,
  getTaskTimerService,
  getTimeBlockService,
} from "@/lib/services";
import { buildTaskGraph } from "@/lib/task/task-dag-graph";
import { appendTaskStatusChangeDescription } from "@/lib/task/task-status-change-description";
import {
  calculateTaskDagCollapseScope,
  classifyVisibleTaskGraphTerminalNodesForSmartMode,
  type TaskDagVisibilityState,
  EMPTY_TASK_DAG_VISIBILITY_STATE,
  findVisibleTaskGraphConnectedComponentNodeIds,
  projectVisibleTaskGraph,
  type VisibleTaskGraph,
} from "@/lib/task/task-dag-visibility";
import {
  countCollapsedTaskDagIntervals,
  expandAllTaskDagIntervals,
  listTaskDagIntervalCollapseDefinitions,
  projectVisibleTaskGraphWithIntervalCollapses,
  resolveTaskDagIntervalDefinition,
  setTaskDagIntervalCollapsed as setTaskDagIntervalCollapsedInState,
  setTaskDagIntervalsCollapsedForTerminal,
  validateTaskDagIntervalAgainstExisting,
  type ResolvedTaskDagInterval,
  type TaskDagIntervalCollapseState,
} from "@/lib/task/task-dag-interval-collapse";
import {
  resolveActiveBlockTaskIds,
  type ActiveBlockData,
  type TimerConfig,
} from "@/lib/types/event";
import type { TaskNode, TaskStatus } from "@/lib/types/task";
import { MultiTaskEndDialog } from "@/ui/app/components/MultiTaskEndDialog";
import {
  TaskDagControlPanel,
  type TaskDagBackgroundMode,
  type TaskDagLayoutMode,
  type TaskDagTagOption,
  type TaskDagTerminalFilterMode,
} from "@/ui/app/components/TaskDagControlPanel";
import { TaskDagKeyHints } from "@/ui/app/components/TaskDagKeyHints";
import { TaskQuickCreateDialog } from "@/ui/app/components/TaskQuickCreateDialog";
import {
  TaskDagDetailPanel,
  type TaskDagDependencyItem,
  type TaskDagIntervalDetailItem,
} from "@/ui/app/components/TaskDagDetailPanel";
import { useIsDesktop } from "@/ui/app/hooks/useIsDesktop";
import {
  ensureNodeVisible,
  useTaskDagKeyboard,
} from "@/ui/app/hooks/useTaskDagKeyboard";
import { useEffectAfterMount } from "@/ui/app/hooks/useEffectAfterMount";
import {
  TaskDagModeSelector,
  type TaskDagMode,
} from "@/ui/app/components/TaskDagModeSelector";
import { TaskDomainTabs } from "@/ui/app/components/TaskDomainTabs";
import {
  TaskStatusSelector,
  TASK_STATUS_SELECTOR_END_OPTIONS,
  type TaskStatusChoice,
} from "@/ui/app/components/TaskStatusSelector";
import { useFeedbackSubmitControls } from "@/ui/app/components/useFeedbackSubmitControls";
import {
  getTaskDagPanSpeed,
  getTaskDagZoomSpeed,
  subscribeTaskDagPanSpeedChanges,
  subscribeTaskDagZoomSpeedChanges,
} from "@/config/task-dag-keyboard-preferences";
import {
  getTaskDagBackgroundMode as readStoredBackgroundMode,
  getTaskDagControlsState as readStoredControlsState,
  getTaskDagDirection as readStoredDagDirection,
  getTaskDagFocusMode as readStoredFocusMode,
  getTaskDagImmersive as readStoredImmersive,
  getTaskDagLayoutMode as readStoredDagLayoutMode,
  getTaskDagMode as readStoredDagMode,
  getTaskDagNodeSizing as readStoredDagNodeSizing,
  TASK_DAG_BACKGROUND_STORAGE_KEY,
  TASK_DAG_CONTROLS_STATE_STORAGE_KEY,
  TASK_DAG_DIRECTION_STORAGE_KEY,
  TASK_DAG_FOCUS_MODE_STORAGE_KEY,
  TASK_DAG_HIDE_TERMINAL_STORAGE_KEY,
  TASK_DAG_IMMERSIVE_STORAGE_KEY,
  TASK_DAG_LAYOUT_MODE_STORAGE_KEY,
  TASK_DAG_MODE_STORAGE_KEY,
  TASK_DAG_NODE_SIZING_STORAGE_KEY,
  TASK_DAG_FOCUSED_SERIES_STORAGE_KEY,
  TASK_DAG_INTERVAL_COLLAPSE_STORAGE_KEY,
  TASK_DAG_SEARCH_DRAFT_STORAGE_KEY,
  TASK_DAG_SEARCH_OPTIONS_STORAGE_KEY,
  TASK_DAG_TAG_FILTER_STORAGE_KEY,
  TASK_DAG_VIEWPORT_STORAGE_KEY,
  TASK_DAG_VISIBILITY_STORAGE_KEY,
  getTaskDagFocusedSeriesAnchorIds as readStoredFocusedSeriesAnchorIds,
  getTaskDagIntervalCollapseState as readStoredTaskDagIntervalCollapseState,
  getTaskDagTagFilter as readStoredTagFilter,
  getTaskDagSearchDraft as readStoredSearchDraft,
  getTaskDagSearchOptions as readStoredSearchOptions,
  getTaskDagTerminalFilterMode as readStoredTerminalFilterMode,
  getTaskDagViewport as readStoredDagViewport,
  getTaskDagVisibility as readStoredDagVisibility,
  setTaskDagBackgroundMode as persistTaskDagBackgroundMode,
  setTaskDagControlsState as persistTaskDagControlsState,
  setTaskDagDirection as persistTaskDagDirection,
  setTaskDagFocusMode as persistTaskDagFocusMode,
  setTaskDagFocusedSeriesAnchorIds as persistTaskDagFocusedSeriesAnchorIds,
  setTaskDagIntervalCollapseState as persistTaskDagIntervalCollapseState,
  setTaskDagImmersive as persistTaskDagImmersive,
  setTaskDagLayoutMode as persistTaskDagLayoutMode,
  setTaskDagMode as persistTaskDagMode,
  setTaskDagNodeSizing as persistTaskDagNodeSizing,
  setTaskDagSearchDraft as persistTaskDagSearchDraft,
  setTaskDagSearchOptions as persistTaskDagSearchOptions,
  setTaskDagTagFilter as persistTaskDagTagFilter,
  setTaskDagTerminalFilterMode as persistTaskDagTerminalFilterMode,
  setTaskDagViewport as writeStoredDagViewport,
  setTaskDagVisibility as persistTaskDagVisibility,
  type TaskDagControlsState,
  type TaskDagFocusMode,
  type TaskDagNodeSizing,
  type TaskDagTagFilter,
  type TaskDagViewportSurface,
} from "@/config/task-dag-preferences";
import {
  getTaskDagManualLayoutSnapshot,
  mergeTaskDagManualLayoutPositions,
  pruneTaskDagManualLayoutSnapshot,
  setTaskDagManualLayoutBaselinePositions,
  setTaskDagManualLayoutSnapshot,
  TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY,
  updateTaskDagManualLayoutPosition,
  type TaskDagManualLayoutSnapshot,
} from "./task-dag-layout-store";
import {
  buildVisibleTaskDagFlow,
  TASK_DAG_NODE_HEIGHT,
  TASK_DAG_NODE_WIDTH,
  type TaskDagFlowEdge,
  type TaskDagFlowNode,
  type TaskDagFlowNodeData,
} from "./task-dag-flow";
import { DagreRoutedEdge } from "./DagreRoutedEdge";
import { resolveDagDirection, type DagDirection } from "./task-dag-layout";
import {
  extractTaskTitleSearchQuery,
  filterTasksBySearch,
  type TaskDagSearchOptions,
} from "./task-title-fuzzy-search";
import { TASKS_LAST_PATH_KEY } from "./task-route-memory";

type DagConnectType = "hard" | "soft";
type DagConnectState = { sourceId: string; type: DagConnectType } | null;
type QuickCreateDependencyContext = {
  sourceTaskId: string;
  type: DagConnectType;
  direction: "upstream" | "downstream";
} | null;
type TaskDagDropPosition = { x: number; y: number } | null;
type TaskDagIntervalSummary = {
  startId: string;
  startTitle: string;
  memberCount: number;
  collapsed: boolean;
};
type TaskDagManualTouchDragState = {
  pointerId: number;
  nodeId: string;
  startClientX: number;
  startClientY: number;
  startPosition: { x: number; y: number };
  lastPosition: { x: number; y: number };
  sourceElement: HTMLDivElement | null;
  moved: boolean;
};
type TaskDagFocusHardDragContext = {
  focusMode: TaskDagFocusMode;
  focusedSeriesAnchorIds: string[];
  visibleFocusedSeriesNodeIds: string[];
  currentFlowNodeIds: string[];
  renderedNodeIds: string[];
  edgeCount: number;
};
type TaskDagFocusHardStateAnomalyKind =
  | "flow-node-zero"
  | "rendered-graph-zero"
  | "focus-anchor-render-missing"
  | "focus-anchor-dom-missing"
  | "focus-anchor-hidden"
  | "node-dom-zero"
  | "edge-dom-zero"
  | "edge-path-zero"
  | "all-rendered-hidden";
type TaskDagFocusHardDragSession = {
  pointerId: number;
  nodeId: string;
  startViewport: { x: number; y: number; zoom: number } | null;
  startFlowNodeIds: string[];
  anomalyKinds: Set<string>;
};
type TaskDagRenderedDomSummary = {
  renderedCount: number;
  renderedNodeIds: string[];
  visibleRenderedCount: number;
  visibleRenderedNodeIds: string[];
  visibleStyleRenderedCount: number;
  visibleStyleRenderedNodeIds: string[];
  hiddenRenderedCount: number;
  hiddenRenderedNodeIds: string[];
  zeroRectNodeIds: string[];
  edgesDomCount: number;
  edgePathCount: number;
  viewportTransform: string | null;
  viewportRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
  wrapperRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  } | null;
};
type TaskDagFlowNodeDimensionDiagnostic = {
  id: string;
  controlledHasMeasured: boolean;
  controlledMeasuredWidth: number | null;
  controlledMeasuredHeight: number | null;
  controlledWidth: number | null;
  controlledHeight: number | null;
  controlledInitialWidth: number | null;
  controlledInitialHeight: number | null;
  instancePresent: boolean;
  instanceHasMeasured: boolean;
  instanceMeasuredWidth: number | null;
  instanceMeasuredHeight: number | null;
  instanceWidth: number | null;
  instanceHeight: number | null;
  instanceInitialWidth: number | null;
  instanceInitialHeight: number | null;
  instanceHasHandleBounds: boolean;
  instanceDragging: boolean;
  instanceHidden: boolean;
};
type TaskDagFlowNodeDimensionSummary = {
  controlledMeasuredCount: number;
  controlledSizedCount: number;
  instancePresentCount: number;
  instanceMeasuredCount: number;
  instanceHandleBoundsCount: number;
  nodes: TaskDagFlowNodeDimensionDiagnostic[];
};
type TaskDagCachedFlowNodeDimensions = {
  measured: { width: number; height: number };
  width: number | null;
  height: number | null;
  initialWidth: number | null;
  initialHeight: number | null;
};
type TaskDagDebugSnapshot = {
  route: string | null;
  focusMode: TaskDagFocusMode;
  focusedSeriesAnchorIds: string[];
  visibleFocusedSeriesNodeIds: string[];
  currentFlowNodeIds: string[];
  renderedGraphNodeIds: string[];
  renderedGraphEdgeCount: number;
  flowNodeDimensionSummary: TaskDagFlowNodeDimensionSummary;
  domSummary: TaskDagRenderedDomSummary;
  anomalyKinds: TaskDagFocusHardStateAnomalyKind[];
};
type TaskDagDebugHistoryEntry = {
  timestamp: number;
  snapshot: TaskDagDebugSnapshot;
};
type TaskDagDebugWindow = Window &
  typeof globalThis & {
    __EXOMIND_TASK_DAG_DEBUG__?: {
      getSnapshot: () => TaskDagDebugSnapshot;
      getHistory: () => TaskDagDebugHistoryEntry[];
      clearHistory: () => void;
    };
  };
type TaskDagDebugFlowInstance = ReactFlowInstance<
  TaskDagFlowNode,
  TaskDagFlowEdge
> & {
  getInternalNode?: (id: string) =>
    | {
        id: string;
        measured?: { width?: number; height?: number };
        width?: number;
        height?: number;
        initialWidth?: number;
        initialHeight?: number;
        hidden?: boolean;
        dragging?: boolean;
        internals?: { handleBounds?: unknown };
      }
    | undefined;
};

const TASK_DAG_EXECUTE_DEBUG_TAG = "[TaskDag][ExecuteDebug]";
const TASK_DAG_MODE_ORDER: TaskDagMode[] = ["browse", "connect", "execute"];
const TASK_DAG_BACKGROUND_DOT_COLOR_LIGHT = "rgba(168,162,158,0.42)";
const TASK_DAG_BACKGROUND_LINE_COLOR_LIGHT = "rgba(168,162,158,0.24)";
const TASK_DAG_BACKGROUND_DOT_COLOR_DARK = "rgba(68,64,60,0.8)";
const TASK_DAG_BACKGROUND_LINE_COLOR_DARK = "rgba(68,64,60,0.45)";
const TASK_DAG_MANUAL_TOUCH_CLICK_SUPPRESS_MS = 250;

export function getNextTaskDagMode(
  current: TaskDagMode,
  delta: 1 | -1,
): TaskDagMode {
  const currentIndex = TASK_DAG_MODE_ORDER.indexOf(current);
  const nextIndex =
    (currentIndex + delta + TASK_DAG_MODE_ORDER.length) %
    TASK_DAG_MODE_ORDER.length;
  return TASK_DAG_MODE_ORDER[nextIndex] ?? "browse";
}

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "待办",
  in_progress: "进行中",
  suspended: "已挂起",
  completed: "已完成",
  cancelled: "已取消",
};

const TASK_PRIORITY_LABELS: Record<TaskNode["priority"], string> = {
  low: "低优先级",
  medium: "中优先级",
  high: "高优先级",
};

function isTerminalStatus(status: TaskStatus): boolean {
  return status === "completed" || status === "cancelled";
}

function resolveTaskDagExecutionLabel(
  task: TaskNode,
  isBlocked: boolean,
  isExecutable: boolean,
): string {
  if (task.status === "completed") return "已完成";
  if (task.status === "cancelled") return "已取消";
  if (task.status === "in_progress") return "进行中";
  if (task.status === "suspended") return "已挂起";
  if (isBlocked) return "受阻";
  if (isExecutable) return "可执行";
  return "待处理";
}

function debugTaskDagExecute(
  message: string,
  payload?: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV || typeof console === "undefined") {
    return;
  }

  if (payload) {
    console.log(TASK_DAG_EXECUTE_DEBUG_TAG, message, payload);
    return;
  }

  console.log(TASK_DAG_EXECUTE_DEBUG_TAG, message);
}

function warnTaskDagInteraction(
  message: string,
  payload?: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV || typeof console === "undefined") {
    return;
  }

  if (payload) {
    console.warn("[TaskDag][InteractionDebug]", message, payload);
    return;
  }

  console.warn("[TaskDag][InteractionDebug]", message);
}

function resolveDebugTargetTestId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>("[data-testid]")?.dataset.testid ?? null;
}

function buildPositionMapFromFlowNodes(
  nodes: Array<{ id: string; position: { x: number; y: number } }>,
): Record<string, { x: number; y: number }> {
  return Object.fromEntries(nodes.map((node) => [node.id, node.position]));
}

function isTaskDagPositionChange(
  change: NodeChange<TaskDagFlowNode>,
): change is Extract<NodeChange<TaskDagFlowNode>, { type: "position" }> {
  return change.type === "position";
}

function snapshotViewport(
  flowInstance: ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null,
): { x: number; y: number; zoom: number } | null {
  if (!flowInstance) {
    return null;
  }

  try {
    return flowInstance.getViewport();
  } catch {
    return null;
  }
}

function getTaskDagCanvasShell(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  return document.querySelector<HTMLElement>(
    '[data-testid="task-dag-canvas-shell"]',
  );
}

function summarizeFlowViewport(
  flowInstance: ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null,
  nodes: TaskDagFlowNode[],
): {
  viewport: { x: number; y: number; zoom: number } | null;
  container: { width: number; height: number } | null;
  bounds: { minX: number; maxX: number; minY: number; maxY: number } | null;
  inViewportCount: number;
  inViewportNodeIds: string[];
} {
  const viewport = snapshotViewport(flowInstance);
  const container = getTaskDagCanvasShell();
  if (!viewport || !container || nodes.length === 0) {
    return {
      viewport,
      container: container
        ? { width: container.clientWidth, height: container.clientHeight }
        : null,
      bounds: null,
      inViewportCount: 0,
      inViewportNodeIds: [],
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const inViewportNodeIds: string[] = [];

  for (const node of nodes) {
    const width = node.measured?.width ?? TASK_DAG_NODE_WIDTH;
    const height = node.measured?.height ?? TASK_DAG_NODE_HEIGHT;
    minX = Math.min(minX, node.position.x);
    maxX = Math.max(maxX, node.position.x + width);
    minY = Math.min(minY, node.position.y);
    maxY = Math.max(maxY, node.position.y + height);

    const screenX = node.position.x * viewport.zoom + viewport.x;
    const screenY = node.position.y * viewport.zoom + viewport.y;
    const screenWidth = width * viewport.zoom;
    const screenHeight = height * viewport.zoom;
    const intersectsViewport =
      screenX + screenWidth >= 0 &&
      screenX <= container.clientWidth &&
      screenY + screenHeight >= 0 &&
      screenY <= container.clientHeight;
    if (intersectsViewport) {
      inViewportNodeIds.push(node.id);
    }
  }

  return {
    viewport,
    container: { width: container.clientWidth, height: container.clientHeight },
    bounds: { minX, maxX, minY, maxY },
    inViewportCount: inViewportNodeIds.length,
    inViewportNodeIds,
  };
}

function isRenderedFlowNodeHiddenByStyle(element: HTMLElement): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function"
  ) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity || "1") <= 0.01
  );
}

function summarizeRenderedFlowNodes(): TaskDagRenderedDomSummary {
  const summarizeRect = (element: Element | null) => {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  };

  if (typeof document === "undefined") {
    return {
      renderedCount: 0,
      renderedNodeIds: [],
      visibleRenderedCount: 0,
      visibleRenderedNodeIds: [],
      visibleStyleRenderedCount: 0,
      visibleStyleRenderedNodeIds: [],
      hiddenRenderedCount: 0,
      hiddenRenderedNodeIds: [],
      zeroRectNodeIds: [],
      edgesDomCount: 0,
      edgePathCount: 0,
      viewportTransform: null,
      viewportRect: null,
      wrapperRect: null,
    };
  }

  const container = getTaskDagCanvasShell();
  const containerRect = container?.getBoundingClientRect() ?? null;
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]"),
  );

  const renderedNodeIds: string[] = [];
  const visibleRenderedNodeIds: string[] = [];
  const visibleStyleRenderedNodeIds: string[] = [];
  const hiddenRenderedNodeIds: string[] = [];
  const zeroRectNodeIds: string[] = [];
  const edgeElements = Array.from(
    document.querySelectorAll<SVGGElement>(".react-flow__edge"),
  );
  const edgePathElements = Array.from(
    document.querySelectorAll<SVGPathElement>(
      ".react-flow__edge path, .react-flow__edge-path",
    ),
  );
  const viewportElement = document.querySelector<HTMLElement>(
    ".react-flow__viewport",
  );

  for (const element of elements) {
    const nodeId = element.dataset.id ?? "";
    if (!nodeId) {
      continue;
    }

    renderedNodeIds.push(nodeId);
    if (isRenderedFlowNodeHiddenByStyle(element)) {
      hiddenRenderedNodeIds.push(nodeId);
    } else {
      visibleStyleRenderedNodeIds.push(nodeId);
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      zeroRectNodeIds.push(nodeId);
      continue;
    }

    if (containerRect) {
      const intersectsContainer =
        rect.right >= containerRect.left &&
        rect.left <= containerRect.right &&
        rect.bottom >= containerRect.top &&
        rect.top <= containerRect.bottom;
      if (intersectsContainer) {
        visibleRenderedNodeIds.push(nodeId);
      }
    }
  }

  return {
    renderedCount: renderedNodeIds.length,
    renderedNodeIds,
    visibleRenderedCount: visibleRenderedNodeIds.length,
    visibleRenderedNodeIds,
    visibleStyleRenderedCount: visibleStyleRenderedNodeIds.length,
    visibleStyleRenderedNodeIds,
    hiddenRenderedCount: hiddenRenderedNodeIds.length,
    hiddenRenderedNodeIds,
    zeroRectNodeIds,
    edgesDomCount: edgeElements.length,
    edgePathCount: edgePathElements.length,
    viewportTransform: viewportElement?.style.transform || null,
    viewportRect: summarizeRect(viewportElement),
    wrapperRect: summarizeRect(container),
  };
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summarizeTaskDagFlowNodeDimensions(
  controlledNodes: Array<{
    id: string;
    measured?: { width?: number; height?: number };
    width?: number;
    height?: number;
    initialWidth?: number;
    initialHeight?: number;
  }>,
  instanceNodes:
    | Array<{
        id: string;
        measured?: { width?: number; height?: number };
        width?: number;
        height?: number;
        initialWidth?: number;
        initialHeight?: number;
        hidden?: boolean;
        dragging?: boolean;
        internals?: { handleBounds?: unknown };
      }>
    | null
    | undefined,
): TaskDagFlowNodeDimensionSummary {
  const instanceNodeById = new Map(
    (instanceNodes ?? []).map((node) => [node.id, node]),
  );
  const diagnostics = controlledNodes.map((node) => {
    const instanceNode = instanceNodeById.get(node.id);
    const controlledMeasuredWidth = toNullableNumber(node.measured?.width);
    const controlledMeasuredHeight = toNullableNumber(node.measured?.height);
    const controlledWidth = toNullableNumber(node.width);
    const controlledHeight = toNullableNumber(node.height);
    const controlledInitialWidth = toNullableNumber(node.initialWidth);
    const controlledInitialHeight = toNullableNumber(node.initialHeight);
    const instanceMeasuredWidth = toNullableNumber(
      instanceNode?.measured?.width,
    );
    const instanceMeasuredHeight = toNullableNumber(
      instanceNode?.measured?.height,
    );
    const instanceWidth = toNullableNumber(instanceNode?.width);
    const instanceHeight = toNullableNumber(instanceNode?.height);
    const instanceInitialWidth = toNullableNumber(instanceNode?.initialWidth);
    const instanceInitialHeight = toNullableNumber(instanceNode?.initialHeight);

    return {
      id: node.id,
      controlledHasMeasured:
        controlledMeasuredWidth != null && controlledMeasuredHeight != null,
      controlledMeasuredWidth,
      controlledMeasuredHeight,
      controlledWidth,
      controlledHeight,
      controlledInitialWidth,
      controlledInitialHeight,
      instancePresent: Boolean(instanceNode),
      instanceHasMeasured:
        instanceMeasuredWidth != null && instanceMeasuredHeight != null,
      instanceMeasuredWidth,
      instanceMeasuredHeight,
      instanceWidth,
      instanceHeight,
      instanceInitialWidth,
      instanceInitialHeight,
      instanceHasHandleBounds: instanceNode?.internals?.handleBounds != null,
      instanceDragging: Boolean(instanceNode?.dragging),
      instanceHidden: Boolean(instanceNode?.hidden),
    } satisfies TaskDagFlowNodeDimensionDiagnostic;
  });

  return {
    controlledMeasuredCount: diagnostics.filter(
      (node) => node.controlledHasMeasured,
    ).length,
    controlledSizedCount: diagnostics.filter(
      (node) =>
        node.controlledWidth != null ||
        node.controlledHeight != null ||
        node.controlledInitialWidth != null ||
        node.controlledInitialHeight != null,
    ).length,
    instancePresentCount: diagnostics.filter((node) => node.instancePresent)
      .length,
    instanceMeasuredCount: diagnostics.filter(
      (node) => node.instanceHasMeasured,
    ).length,
    instanceHandleBoundsCount: diagnostics.filter(
      (node) => node.instanceHasHandleBounds,
    ).length,
    nodes: diagnostics,
  };
}

function resolveTaskDagFlowNodeDimensions(
  nodeId: string,
  cachedDimensions: Map<string, TaskDagCachedFlowNodeDimensions>,
): Pick<
  TaskDagFlowNode,
  "measured" | "width" | "height" | "initialWidth" | "initialHeight"
> {
  const cached = cachedDimensions.get(nodeId);
  if (cached) {
    return {
      measured: cached.measured,
      width: cached.width ?? undefined,
      height: cached.height ?? undefined,
      initialWidth: cached.initialWidth ?? undefined,
      initialHeight: cached.initialHeight ?? undefined,
    };
  }

  return {
    measured: {
      width: TASK_DAG_NODE_WIDTH,
      height: TASK_DAG_NODE_HEIGHT,
    },
    initialWidth: TASK_DAG_NODE_WIDTH,
    initialHeight: TASK_DAG_NODE_HEIGHT,
  };
}

export function detectTaskDagFocusHardStateAnomalies(
  context: TaskDagFocusHardDragContext,
  domSummary: TaskDagRenderedDomSummary,
): TaskDagFocusHardStateAnomalyKind[] {
  if (context.focusMode !== "hard") {
    return [];
  }
  if (context.focusedSeriesAnchorIds.length === 0) {
    return [];
  }
  if (context.visibleFocusedSeriesNodeIds.length === 0) {
    return [];
  }

  const anomalies: TaskDagFocusHardStateAnomalyKind[] = [];

  if (context.currentFlowNodeIds.length === 0) {
    anomalies.push("flow-node-zero");
  }
  if (context.renderedNodeIds.length === 0) {
    anomalies.push("rendered-graph-zero");
  }
  if (
    !context.focusedSeriesAnchorIds.some((nodeId) =>
      context.renderedNodeIds.includes(nodeId),
    )
  ) {
    anomalies.push("focus-anchor-render-missing");
  }
  if (domSummary.renderedCount === 0) {
    anomalies.push("node-dom-zero");
  }
  if (
    !context.focusedSeriesAnchorIds.some((nodeId) =>
      domSummary.renderedNodeIds.includes(nodeId),
    )
  ) {
    anomalies.push("focus-anchor-dom-missing");
  }
  if (
    context.focusedSeriesAnchorIds.some((nodeId) =>
      domSummary.hiddenRenderedNodeIds.includes(nodeId),
    )
  ) {
    anomalies.push("focus-anchor-hidden");
  }
  if (
    domSummary.renderedCount > 0 &&
    domSummary.hiddenRenderedCount === domSummary.renderedCount
  ) {
    anomalies.push("all-rendered-hidden");
  }
  if (context.edgeCount > 0 && domSummary.edgesDomCount === 0) {
    anomalies.push("edge-dom-zero");
  }
  if (context.edgeCount > 0 && domSummary.edgePathCount === 0) {
    anomalies.push("edge-path-zero");
  }

  return anomalies;
}

function resolveFocusHardDragAnomalyKind(
  context: TaskDagFocusHardDragContext,
  domSummary: ReturnType<typeof summarizeRenderedFlowNodes>,
): "edge-path-zero" | "node-dom-zero" | "visible-node-zero" | null {
  if (context.currentFlowNodeIds.length === 0) {
    return null;
  }

  if (context.edgeCount > 0 && domSummary.edgePathCount === 0) {
    return "edge-path-zero";
  }

  if (domSummary.renderedCount === 0) {
    return "node-dom-zero";
  }

  if (domSummary.visibleRenderedCount === 0) {
    return "visible-node-zero";
  }

  return null;
}

function focusNodeInViewport(
  nodeId: string,
  flowInstance: ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null,
  nodes: TaskDagFlowNode[],
): void {
  if (!flowInstance) {
    return;
  }

  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return;
  }

  const nodeWidth = node.measured?.width ?? TASK_DAG_NODE_WIDTH;
  const nodeHeight = node.measured?.height ?? TASK_DAG_NODE_HEIGHT;
  flowInstance.setCenter(
    node.position.x + nodeWidth / 2,
    node.position.y + nodeHeight / 2,
    { duration: 180 },
  );
}

function decodeDagSearchParam(rawValue: string | null): string | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      return parsed.trim() || null;
    }
    if (typeof parsed === "number" || typeof parsed === "boolean") {
      return String(parsed);
    }
  } catch {
    // Fall back to the raw query string when it isn't JSON-encoded.
  }

  return trimmed;
}

function parseDagLocateSearchParam(rawValue: string | null): boolean {
  const normalized = decodeDagSearchParam(rawValue)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function buildExecutionHint(
  task: TaskNode,
  isBlocked: boolean,
  isExecutable: boolean,
): string {
  if (task.status === "completed") {
    return "该任务已经完成，可双击进入详情页回顾依赖关系与时间记录。";
  }
  if (task.status === "cancelled") {
    return "该任务已经取消，如需继续推进，请先在任务详情页中调整任务状态。";
  }
  if (task.status === "in_progress") {
    return "该任务正在推进中，可在详情页继续查看时间块、依赖与执行记录。";
  }
  if (task.status === "suspended") {
    return isExecutable
      ? "该任务已挂起，但当前依赖已满足，可恢复执行。"
      : "该任务已挂起，且仍受前置依赖限制，暂不适合恢复执行。";
  }
  if (isBlocked) {
    return "该任务目前仍被前置任务阻塞，需先完成对应依赖后才能启动。";
  }
  if (isExecutable) {
    return "该任务当前可执行，可继续在后续执行模式中直接发起时间块。";
  }
  return "该任务暂未开始，建议先确认依赖、估时与执行策略。";
}

function buildUpstreamDependencies(
  task: TaskNode,
  taskById: ReadonlyMap<string, TaskNode>,
): TaskDagDependencyItem[] {
  return task.dependsOn.map((dependency) => ({
    taskId: dependency.taskId,
    title: taskById.get(dependency.taskId)?.title ?? dependency.taskId,
    type: dependency.type,
  }));
}

function buildDownstreamDependencies(
  taskId: string,
  tasks: TaskNode[],
): TaskDagDependencyItem[] {
  return tasks.flatMap((task) =>
    task.dependsOn
      .filter((dependency) => dependency.taskId === taskId)
      .map((dependency) => ({
        taskId: task.id,
        title: task.title,
        type: dependency.type,
      })),
  );
}

function resolveConnectTypeFromEvent(event: unknown): DagConnectType {
  if (
    event &&
    typeof event === "object" &&
    "shiftKey" in event &&
    Boolean((event as { shiftKey?: boolean }).shiftKey)
  ) {
    return "soft";
  }

  return "hard";
}

function shouldCreateUpstreamFromPaneEvent(event: unknown): boolean {
  if (
    event &&
    typeof event === "object" &&
    "shiftKey" in event &&
    Boolean((event as { shiftKey?: boolean }).shiftKey)
  ) {
    return true;
  }

  return false;
}

function resolveQuickCreateDirectionFromHandleType(
  handleType: HandleType | null | undefined,
): "upstream" | "downstream" | null {
  if (handleType === "target") {
    return "upstream";
  }
  if (handleType === "source") {
    return "downstream";
  }
  return null;
}

function extractClientPositionFromPointerEvent(
  event: unknown,
): TaskDagDropPosition {
  if (
    event &&
    typeof event === "object" &&
    "clientX" in event &&
    "clientY" in event &&
    typeof (event as { clientX?: unknown }).clientX === "number" &&
    typeof (event as { clientY?: unknown }).clientY === "number"
  ) {
    return {
      x: (event as { clientX: number }).clientX,
      y: (event as { clientY: number }).clientY,
    };
  }

  return null;
}

function isPaneInteractionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target.closest(".react-flow__node") ||
    target.closest('[data-testid^="mock-react-flow-node-"]')
  ) {
    return false;
  }

  return Boolean(
    target.closest(".react-flow__pane") ||
    target.closest('[data-testid="mock-react-flow-pane"]') ||
    target.closest('[data-testid="mock-react-flow-pane-double"]') ||
    target.closest('[data-testid="mock-react-flow-pane-context"]'),
  );
}

function buildBlockedReason(
  task: TaskNode,
  taskById: ReadonlyMap<string, TaskNode>,
): string | null {
  const incompleteHardDependencies = task.dependsOn
    .filter((dependency) => dependency.type === "hard")
    .map((dependency) => {
      const predecessor = taskById.get(dependency.taskId);
      if (!predecessor || predecessor.status === "completed") {
        return null;
      }
      return predecessor.title;
    })
    .filter((title): title is string => title !== null);

  const pendingSoftDependencies = task.dependsOn
    .filter((dependency) => dependency.type === "soft")
    .map((dependency) => {
      const predecessor = taskById.get(dependency.taskId);
      if (!predecessor || predecessor.status !== "pending") {
        return null;
      }
      return predecessor.title;
    })
    .filter((title): title is string => title !== null);

  const reasons: string[] = [];
  if (incompleteHardDependencies.length > 0) {
    reasons.push(`硬依赖未完成：${incompleteHardDependencies.join("、")}`);
  }
  if (pendingSoftDependencies.length > 0) {
    reasons.push(`软依赖尚未开始：${pendingSoftDependencies.join("、")}`);
  }

  return reasons.length > 0 ? reasons.join("；") : null;
}

function formatDependencyMutationError(error: unknown): string {
  const message =
    error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  const normalized = message.toLowerCase();

  if (normalized.includes("cycle")) {
    return "不允许循环依赖";
  }
  if (normalized.includes("not found")) {
    return "依赖任务不存在，请刷新后重试";
  }

  return message || "依赖关系更新失败";
}

function formatExecuteActionError(error: unknown): string {
  const message =
    error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  if (message.includes("hard dependencies not met")) {
    return "所选任务存在未完成的硬依赖，当前不能执行或关联。";
  }

  return message || "执行模式操作失败，请稍后重试。";
}

function resolveExecuteState(
  task: TaskNode,
  isBlocked: boolean,
  isExecutable: boolean,
  activeTaskIdSet: ReadonlySet<string>,
): TaskDagFlowNodeData["executeState"] {
  if (activeTaskIdSet.has(task.id)) {
    return "active";
  }
  if (isTerminalStatus(task.status)) {
    return "terminal";
  }
  if (isExecutable) {
    return "executable";
  }
  if (isBlocked) {
    return "blocked";
  }

  return "blocked";
}

function buildExecuteTimerConfig(
  task: TaskNode,
  spentMinutes: number,
): TimerConfig {
  if (task.estimatedMinutes == null) {
    return { mode: "countup" };
  }

  return {
    mode: "countdown",
    minutes: Math.max(1, Math.round(task.estimatedMinutes - spentMinutes)),
  };
}

function filterVisibleGraphByNodeIds(
  visibleGraph: VisibleTaskGraph,
  visibleNodeIdSet: ReadonlySet<string>,
): VisibleTaskGraph {
  const nodes = visibleGraph.nodes.filter((node) =>
    visibleNodeIdSet.has(node.id),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = visibleGraph.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const visibleRootNodeIds = nodes
    .map((node) => node.id)
    .filter((nodeId) => (incomingCount.get(nodeId) ?? 0) === 0);
  const visibleRootNodeIdSet = new Set(visibleRootNodeIds);
  const visibleCurrentRootNodeId =
    nodes.find((node) => visibleRootNodeIdSet.has(node.id))?.id ?? null;
  const hiddenNodeIds = visibleGraph.nodes
    .filter((node) => !nodeIds.has(node.id))
    .map((node) => node.id);

  return {
    ...visibleGraph,
    nodes,
    edges,
    hiddenNodeIds: Array.from(
      new Set([...visibleGraph.hiddenNodeIds, ...hiddenNodeIds]),
    ),
    visibleRootNodeIds,
    visibleCurrentRootNodeId,
  };
}

function matchesTaskDagTextSearch(
  task: TaskNode,
  query: string,
  options: Pick<TaskDagSearchOptions, "includeDescription" | "fuzzy">,
): boolean {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return true;
  }

  return filterTasksBySearch([task], trimmedQuery, options).length > 0;
}

function matchesTaskDagTagSearch(
  task: TaskNode,
  tagFilter: TaskDagTagFilter,
): boolean {
  if (tagFilter.selectedTags.length === 0) {
    return true;
  }

  const selectedTagSet = new Set(tagFilter.selectedTags);
  const taskTagSet = new Set(
    task.tags.map((tag) => tag.trim()).filter(Boolean),
  );

  if (tagFilter.matchMode === "or") {
    return [...selectedTagSet].some((tag) => taskTagSet.has(tag));
  }

  return [...selectedTagSet].every((tag) => taskTagSet.has(tag));
}

function projectVisibleGraphForSmartTerminalMode(
  visibleGraph: VisibleTaskGraph,
): {
  visibleGraph: VisibleTaskGraph;
  secondaryNodeIds: Set<string>;
} {
  const smartModeResult =
    classifyVisibleTaskGraphTerminalNodesForSmartMode(visibleGraph);
  return {
    visibleGraph:
      smartModeResult.hiddenNodeIds.size === 0
        ? visibleGraph
        : filterVisibleGraphByNodeIds(
            {
              ...visibleGraph,
              hiddenNodeIds: Array.from(
                new Set([
                  ...visibleGraph.hiddenNodeIds,
                  ...smartModeResult.hiddenNodeIds,
                ]),
              ),
            },
            new Set(
              visibleGraph.nodes
                .filter((node) => !smartModeResult.hiddenNodeIds.has(node.id))
                .map((node) => node.id),
            ),
          ),
    secondaryNodeIds: smartModeResult.secondaryNodeIds,
  };
}

function filterStrictTerminalNodesFromVisibleGraph(
  visibleGraph: VisibleTaskGraph,
): VisibleTaskGraph {
  const visibleNodeIds = new Set(
    visibleGraph.nodes
      .filter((node) => !isTerminalStatus(node.status))
      .map((node) => node.id),
  );

  if (visibleNodeIds.size === visibleGraph.nodes.length) {
    return visibleGraph;
  }

  const hiddenNodeIds = visibleGraph.nodes
    .filter((node) => !visibleNodeIds.has(node.id))
    .map((node) => node.id);

  return filterVisibleGraphByNodeIds(
    {
      ...visibleGraph,
      hiddenNodeIds: Array.from(
        new Set([...visibleGraph.hiddenNodeIds, ...hiddenNodeIds]),
      ),
    },
    visibleNodeIds,
  );
}

function collectVisibleTaskGraphConnectedComponentNodeIds(
  visibleGraph: VisibleTaskGraph,
  anchorIds: readonly string[],
): Set<string> {
  const union = new Set<string>();
  for (const anchorId of anchorIds) {
    for (const nodeId of findVisibleTaskGraphConnectedComponentNodeIds(
      visibleGraph,
      anchorId,
    )) {
      union.add(nodeId);
    }
  }
  return union;
}

function TaskDagNode({
  id,
  data,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
}: FlowNodeProps<TaskDagFlowNode>) {
  const nodeData = data as TaskDagFlowNodeData;
  const isManualLayout = nodeData.layoutMode === "manual";
  const isExpanded = nodeData.isSelected;
  const hasDenseTitle = nodeData.title.trim().length >= 28;
  const lowPriorityBadgeCount =
    Number(nodeData.isFocusAnchor) +
    Number(nodeData.isCollapsedUpstreamTarget) +
    Number(nodeData.isCollapsedDownstreamTarget);
  const hideLowPriorityBadges =
    !isExpanded && (hasDenseTitle || lowPriorityBadgeCount >= 3);
  const widthClass = nodeData.fixedWidth
    ? "w-40"
    : isManualLayout
      ? "w-fit max-w-[18rem]"
      : "max-w-40";
  const heightClass = nodeData.fixedHeight
    ? "h-40"
    : isManualLayout
      ? ""
      : "max-h-40";
  const expansionClass = isExpanded
    ? "z-20 max-w-[24rem] max-h-[24rem]"
    : "hover:z-20 hover:max-w-[24rem] hover:max-h-[24rem]";
  const handleStyle = {
    width: 10,
    height: 10,
    border: nodeData.showConnectHandles ? "2px solid #C75B3A" : 0,
    background: nodeData.showConnectHandles ? "#FAF7F5" : "transparent",
    opacity: nodeData.showConnectHandles ? 1 : 0,
    pointerEvents: nodeData.showConnectHandles
      ? ("auto" as const)
      : ("none" as const),
  };

  return (
    <div
      data-testid={`task-dag-node-slot-${id}`}
      className="relative flex h-40 w-40 items-center justify-center"
    >
      <div
        title={nodeData.blockedReason ?? undefined}
        data-testid={`task-dag-node-${id}`}
        onPointerDownCapture={(event) =>
          nodeData.onManualTouchPointerDown?.(id, event)
        }
        className={[
          "group/task-dag-node relative inline-flex flex-col justify-center overflow-hidden rounded-2xl border bg-white px-3 py-3 text-left shadow-sm transition-all duration-200 ease-out dark:bg-[#1C1917]",
          isManualLayout ? "nopan" : "",
          widthClass,
          heightClass,
          expansionClass,
          nodeData.connectPreviewType === "hard"
            ? "border-[#2563EB] ring-2 ring-[#2563EB]/30 bg-[#EFF6FF] shadow-[0_14px_32px_-18px_rgba(37,99,235,0.7)] dark:border-[#60A5FA] dark:bg-[#172554]"
            : nodeData.connectPreviewType === "soft"
              ? "border-dashed border-[#0F766E] ring-2 ring-[#14B8A6]/25 bg-[#F0FDFA] shadow-[0_14px_32px_-18px_rgba(20,184,166,0.7)] dark:border-[#2DD4BF] dark:bg-[#042F2E]"
              : nodeData.executeState === "active"
                ? "border-[2.5px] border-[#C75B3A] ring-[3px] ring-[#C75B3A]/35 shadow-[0_12px_36px_-12px_rgba(199,91,58,0.55)] animate-pulse"
                : nodeData.isSecondaryNode
                  ? "border-[2.5px] border-[#D6D3D1] ring-[3px] ring-[#D6D3D1]/15 opacity-35 grayscale dark:border-[#44403C] dark:ring-[#57534E]/15"
                  : nodeData.isSelected
                    ? "border-[#C75B3A] ring-2 ring-[#C75B3A]/35 shadow-[0_12px_36px_-12px_rgba(199,91,58,0.55)]"
                    : nodeData.executeState === "executable"
                      ? "border-[2.5px] border-[#16A34A]/60 ring-[3px] ring-[#22C55E]/20 bg-[#F0FDF4] shadow-[0_12px_28px_-18px_rgba(34,197,94,0.7)] dark:border-[#22C55E]/60 dark:bg-[#052E16]"
                      : nodeData.executeState === "blocked"
                        ? "border-[2.5px] border-[#EAB308]/60 ring-[3px] ring-[#EAB308]/15 opacity-60"
                        : nodeData.isCurrentRoot
                          ? "border-[#C75B3A] ring-2 ring-[#FDE7DC] dark:ring-[#4A2317]"
                          : nodeData.isCollapsedTarget
                            ? "border-[#C75B3A] ring-2 ring-[#FDE7DC] dark:border-[#FDBA74] dark:ring-[#4A2317]"
                            : nodeData.isSearchMatch
                              ? "border-[#2563EB] bg-[#EFF6FF] shadow-[0_10px_25px_-15px_rgba(37,99,235,0.65)] dark:border-[#60A5FA] dark:bg-[#172554]"
                              : nodeData.isBlocked
                                ? "border-[#EAB308]/60"
                                : "border-[#E7E5E4] dark:border-[#292524]",
          (nodeData.isSearchDimmed || nodeData.isFocusDimmed) &&
          !nodeData.isSelected &&
          nodeData.executeState !== "active"
            ? "opacity-35 saturate-[0.7]"
            : "",
        ].join(" ")}
      >
        <Handle type="target" position={targetPosition} style={handleStyle} />
        <Handle type="source" position={sourcePosition} style={handleStyle} />

        {nodeData.isFocusAnchor && !hideLowPriorityBadges ? (
          <span
            data-testid={`task-dag-focus-anchor-badge-${id}`}
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[#F3E8FF] px-2 py-0.5 text-[10px] font-medium text-[#7C3AED] dark:bg-[#3B1D63] dark:text-[#D8B4FE]"
          >
            <LocateFixed size={10} />
            聚焦锚点
          </span>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {nodeData.connectPreviewType === "hard" ? (
            <span className="rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-medium text-[#1D4ED8] dark:bg-[#1E3A5F] dark:text-[#93C5FD]">
              准备硬依赖
            </span>
          ) : null}
          {nodeData.connectPreviewType === "soft" ? (
            <span className="rounded-full bg-[#CCFBF1] px-2 py-0.5 text-[10px] font-medium text-[#0F766E] dark:bg-[#134E4A] dark:text-[#99F6E4]">
              准备软依赖
            </span>
          ) : null}
          {nodeData.executeState === "active" ? (
            <span className="rounded-full bg-[#FDE7DC] px-2 py-0.5 text-[10px] font-semibold text-[#C75B3A]">
              专注中
            </span>
          ) : null}
          {nodeData.isCollapsedUpstreamTarget && !hideLowPriorityBadges ? (
            <span className="rounded-full bg-[#FFF7ED] px-2 py-0.5 text-[10px] font-medium text-[#C75B3A]">
              已折叠上游
            </span>
          ) : null}
          {nodeData.isCollapsedDownstreamTarget && !hideLowPriorityBadges ? (
            <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-medium text-[#047857]">
              已折叠下游
            </span>
          ) : null}
          {nodeData.intervalCollapseSummaries?.map((summary, index) => (
            <span
              key={`interval-start-${summary.startId}-${index}`}
              data-testid={
                index === 0 ? `task-dag-interval-start-badge-${id}` : undefined
              }
              className="rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[10px] font-medium text-[#6D28D9] dark:bg-[#2E1065] dark:text-[#DDD6FE]"
            >
              {`起点 ${summary.startTitle}`}
            </span>
          ))}
          {nodeData.intervalCollapseSummaries?.map((summary, index) => (
            <span
              key={`interval-count-${summary.startId}-${summary.memberCount}-${index}`}
              data-testid={
                index === 0 ? `task-dag-interval-count-badge-${id}` : undefined
              }
              className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-medium text-[#4B5563] dark:bg-[#292524] dark:text-[#D6D3D1]"
            >
              {`${summary.memberCount} 个节点`}
            </span>
          ))}
          <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
            {nodeData.statusLabel}
          </span>
          {nodeData.hiddenUpstreamCount > 0 ? (
            <span
              data-testid={`task-dag-hidden-upstream-badge-${id}`}
              className="rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-medium text-[#1D4ED8] dark:bg-[#1E3A5F] dark:text-[#93C5FD]"
            >
              {`+${nodeData.hiddenUpstreamCount} 已折叠`}
            </span>
          ) : null}
          {nodeData.hiddenDownstreamCount > 0 ? (
            <span
              data-testid={`task-dag-hidden-downstream-badge-${id}`}
              className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-medium text-[#15803D] dark:bg-[#14532D] dark:text-[#BBF7D0]"
            >
              {`+${nodeData.hiddenDownstreamCount} 下游已折叠`}
            </span>
          ) : null}
        </div>

        <p
          className={[
            "mt-3 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]",
            isExpanded
              ? "line-clamp-none"
              : "line-clamp-3 group-hover/task-dag-node:line-clamp-none",
          ].join(" ")}
        >
          {nodeData.title}
        </p>
        <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
          {nodeData.priorityLabel}
        </p>
        <p className="mt-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">
          {nodeData.executionLabel}
        </p>
      </div>
    </div>
  );
}

const TASK_DAG_NODE_TYPES = {
  taskDag: TaskDagNode,
} satisfies NodeTypes;

const TASK_DAG_EDGE_TYPES = {
  dagreRouted: DagreRoutedEdge,
} satisfies EdgeTypes;

const TASK_DAG_MIN_ZOOM = 0.01;
const TASK_DAG_FIT_VIEW_OPTIONS = {
  padding: 0.2,
  minZoom: TASK_DAG_MIN_ZOOM,
} as const;

export function TaskDagPage() {
  const isDarkMode =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");
  const backgroundDotColor = isDarkMode
    ? TASK_DAG_BACKGROUND_DOT_COLOR_DARK
    : TASK_DAG_BACKGROUND_DOT_COLOR_LIGHT;
  const backgroundLineColor = isDarkMode
    ? TASK_DAG_BACKGROUND_LINE_COLOR_DARK
    : TASK_DAG_BACKGROUND_LINE_COLOR_LIGHT;
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [hasLoadedTasksOnce, setHasLoadedTasksOnce] = useState(false);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dagVisibility, setDagVisibility] = useState<TaskDagVisibilityState>(
    () => readStoredDagVisibility(),
  );
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  const [paneContextMenu, setPaneContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [terminalFilterMode, setTerminalFilterMode] =
    useState<TaskDagTerminalFilterMode>(() => readStoredTerminalFilterMode());
  const [focusMode, setFocusMode] = useState<TaskDagFocusMode>(() =>
    readStoredFocusMode(),
  );
  const [backgroundMode, setBackgroundMode] = useState<TaskDagBackgroundMode>(
    () => readStoredBackgroundMode(),
  );
  const [nodeSizing, setNodeSizing] = useState<TaskDagNodeSizing>(() =>
    readStoredDagNodeSizing(),
  );
  const [immersive, setImmersive] = useState(() => readStoredImmersive());
  const [controlsState, setControlsState] = useState<TaskDagControlsState>(() =>
    readStoredControlsState(),
  );
  const [mobileHintsOpen, setMobileHintsOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(() => readStoredSearchDraft());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOptions, setSearchOptions] = useState<TaskDagSearchOptions>(() =>
    readStoredSearchOptions(),
  );
  const [tagFilter, setTagFilter] = useState<TaskDagTagFilter>(() =>
    readStoredTagFilter(),
  );
  const [focusedSeriesAnchorIds, setFocusedSeriesAnchorIds] = useState<
    string[]
  >(() => readStoredFocusedSeriesAnchorIds());
  const [intervalCollapseState, setIntervalCollapseState] =
    useState<TaskDagIntervalCollapseState>(() =>
      readStoredTaskDagIntervalCollapseState(),
    );
  const [pendingIntervalStartId, setPendingIntervalStartId] = useState<
    string | null
  >(null);
  const [dagDirection, setDagDirection] = useState<DagDirection>(() =>
    readStoredDagDirection(),
  );
  const [layoutMode, setLayoutMode] = useState<TaskDagLayoutMode>(() =>
    readStoredDagLayoutMode(),
  );
  const [mode, setMode] = useState<TaskDagMode>(() => readStoredDagMode());
  const [manualLayoutSnapshot, setManualLayoutSnapshotState] =
    useState<TaskDagManualLayoutSnapshot | null>(() =>
      getTaskDagManualLayoutSnapshot(),
    );
  const manualLayoutSnapshotRef = useRef<TaskDagManualLayoutSnapshot | null>(
    manualLayoutSnapshot,
  );
  const [connectState, setConnectState] = useState<DagConnectState>(null);
  const [endingDialogOpen, setEndingDialogOpen] = useState(false);
  const [endingTaskIds, setEndingTaskIds] = useState<string[]>([]);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateDependency, setQuickCreateDependency] =
    useState<QuickCreateDependencyContext>(null);
  const [quickCreateDirection, setQuickCreateDirection] = useState<
    "upstream" | "downstream" | null
  >(null);
  const [quickCreateFromNodeId, setQuickCreateFromNodeId] = useState<
    string | null
  >(null);
  const [quickCreateDropPosition, setQuickCreateDropPosition] =
    useState<TaskDagDropPosition>(null);
  const [pendingFocusTaskId, setPendingFocusTaskId] = useState<string | null>(
    null,
  );
  const [disassociateDialogOpen, setDisassociateDialogOpen] = useState(false);
  const [disassociateTargetTaskId, setDisassociateTargetTaskId] = useState<
    string | null
  >(null);
  const [disassociateChoice, setDisassociateChoice] =
    useState<TaskStatusChoice>("suspended");
  const [disassociateDescription, setDisassociateDescription] = useState("");
  const [panSpeed, setPanSpeed] = useState(() => getTaskDagPanSpeed());
  const [zoomSpeed, setZoomSpeed] = useState(() => getTaskDagZoomSpeed());
  const [manualTouchNodeDragActive, setManualTouchNodeDragActive] =
    useState(false);
  const { handleFeedbackKeyDown } = useFeedbackSubmitControls({
    submitMode: "ctrl-enter-only",
  });
  const flowInstanceRef = useRef<ReactFlowInstance<
    TaskDagFlowNode,
    TaskDagFlowEdge
  > | null>(null);
  const wheelListenerRef = useRef<HTMLDivElement | null>(null);
  const connectDragTypeRef = useRef<DagConnectType>("hard");
  const connectDragQuickCreateRef = useRef<QuickCreateDependencyContext>(null);
  const quickCreateDropPositionRef = useRef<TaskDagDropPosition>(null);
  const flowNodePositionByIdRef = useRef(
    new Map<string, { x: number; y: number }>(),
  );
  const flowNodeDimensionCacheRef = useRef(
    new Map<string, TaskDagCachedFlowNodeDimensions>(),
  );
  const manualTouchDragRef = useRef<TaskDagManualTouchDragState | null>(null);
  const focusHardDragDebugRef = useRef<TaskDagFocusHardDragSession | null>(
    null,
  );
  const focusHardStateAnomalySignatureRef = useRef<string | null>(null);
  const taskDagDebugHistoryRef = useRef<TaskDagDebugHistoryEntry[]>([]);
  const taskDagDebugHistorySignatureRef = useRef<string | null>(null);
  const focusHardDragContextRef = useRef<TaskDagFocusHardDragContext>({
    focusMode,
    focusedSeriesAnchorIds: [],
    visibleFocusedSeriesNodeIds: [],
    currentFlowNodeIds: [],
    renderedNodeIds: [],
    edgeCount: 0,
  });
  const suppressNodeClickRef = useRef<{ nodeId: string; until: number } | null>(
    null,
  );
  const pendingManualLayoutNodeIdsRef = useRef(new Set<string>());
  const hasMountedDirectionRef = useRef(false);
  const hasAppliedInitialViewportRef = useRef(false);
  const lastHandledFocusSearchRef = useRef<string | null>(null);
  const taskLoadRequestIdRef = useRef(0);
  const focusTaskIdFromSearch = useMemo(() => {
    const params = new URLSearchParams(location.searchStr ?? "");
    return decodeDagSearchParam(params.get("focus"));
  }, [location.searchStr]);
  const locateTaskFromSearch = useMemo(() => {
    const params = new URLSearchParams(location.searchStr ?? "");
    return parseDagLocateSearchParam(params.get("locate"));
  }, [location.searchStr]);

  useEffect(() => {
    const fullPath = location.pathname + (location.searchStr || "");
    if (fullPath.startsWith("/tasks/")) {
      sessionStorage.setItem(TASKS_LAST_PATH_KEY, fullPath);
    }
  }, [location.pathname, location.searchStr]);

  useEffectAfterMount(() => {
    persistTaskDagMode(mode);
  }, [mode]);

  useEffectAfterMount(() => {
    persistTaskDagDirection(dagDirection);
  }, [dagDirection]);

  useEffectAfterMount(() => {
    persistTaskDagLayoutMode(layoutMode);
  }, [layoutMode]);

  useEffectAfterMount(() => {
    persistTaskDagTerminalFilterMode(terminalFilterMode);
  }, [terminalFilterMode]);

  useEffectAfterMount(() => {
    persistTaskDagFocusMode(focusMode);
  }, [focusMode]);

  useEffectAfterMount(() => {
    persistTaskDagBackgroundMode(backgroundMode);
  }, [backgroundMode]);

  useEffectAfterMount(() => {
    persistTaskDagNodeSizing(nodeSizing);
  }, [nodeSizing]);

  useEffectAfterMount(() => {
    persistTaskDagImmersive(immersive);
  }, [immersive]);

  useEffectAfterMount(() => {
    persistTaskDagSearchOptions(searchOptions);
  }, [searchOptions]);

  useEffectAfterMount(() => {
    persistTaskDagSearchDraft(searchDraft);
  }, [searchDraft]);

  useEffectAfterMount(() => {
    persistTaskDagTagFilter(tagFilter);
  }, [tagFilter]);

  useEffectAfterMount(() => {
    persistTaskDagFocusedSeriesAnchorIds(focusedSeriesAnchorIds);
  }, [focusedSeriesAnchorIds]);

  useEffectAfterMount(() => {
    persistTaskDagIntervalCollapseState(intervalCollapseState);
  }, [intervalCollapseState]);

  useEffectAfterMount(() => {
    persistTaskDagControlsState(controlsState);
  }, [controlsState]);

  useEffectAfterMount(() => {
    persistTaskDagVisibility(dagVisibility);
  }, [dagVisibility]);

  useEffect(() => {
    if (isDesktop) {
      setMobileHintsOpen(false);
    }
  }, [isDesktop]);

  useEffect(() => {
    let disposed = false;
    const taskService = getTaskService();

    const load = async (reason: "mount" | "task-change") => {
      const requestId = ++taskLoadRequestIdRef.current;
      debugTaskDagExecute("loadTasks:start", {
        reason,
        requestId,
      });
      const list = await taskService.listTasks(true);
      if (disposed) {
        debugTaskDagExecute("loadTasks:skip-disposed", {
          reason,
          requestId,
        });
        return;
      }
      if (requestId !== taskLoadRequestIdRef.current) {
        debugTaskDagExecute("loadTasks:skip-stale", {
          reason,
          requestId,
          latestRequestId: taskLoadRequestIdRef.current,
          taskIds: list.map((task) => task.id),
        });
        return;
      }

      debugTaskDagExecute("loadTasks:apply", {
        reason,
        requestId,
        taskIds: list.map((task) => task.id),
      });
      for (const task of list) {
        pendingManualLayoutNodeIdsRef.current.delete(task.id);
      }
      setTasks(list);
      setHasLoadedTasksOnce((current) => current || list.length > 0);
    };

    void load("mount");
    const unsubscribe = taskService.onTaskChange(() => {
      debugTaskDagExecute("taskChange:event");
      void load("task-change");
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const timeBlockService = getTimeBlockService();

    const load = async () => {
      const block = await timeBlockService.loadActiveBlock();
      if (!disposed) {
        debugTaskDagExecute("activeBlock:load", {
          blockStartId: block?.startId ?? null,
          taskIds: block ? resolveActiveBlockTaskIds(block) : [],
          phase: block?.phase ?? null,
          paused: block?.paused ?? null,
        });
        setActiveBlock(block);
      }
    };

    void load();
    const unsubscribe = timeBlockService.onBlockChange((block) => {
      if (!disposed) {
        debugTaskDagExecute("activeBlock:onBlockChange", {
          blockStartId: block?.startId ?? null,
          taskIds: block ? resolveActiveBlockTaskIds(block) : [],
          phase: block?.phase ?? null,
          paused: block?.paused ?? null,
        });
        setActiveBlock(block);
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(extractTaskTitleSearchQuery(searchDraft));
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchDraft]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

  useEffect(() => {
    if (!paneContextMenu) return;
    const handler = () => setPaneContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [paneContextMenu]);

  useEffect(() => {
    if (mode !== "connect") {
      setConnectState(null);
      setPaneContextMenu(null);
      connectDragQuickCreateRef.current = null;
    }
  }, [mode]);

  useEffect(() => {
    if (!quickCreateOpen) {
      quickCreateDropPositionRef.current = null;
      setQuickCreateDropPosition(null);
    }
  }, [quickCreateOpen]);

  useEffect(() => {
    if (activeBlock) return;
    setEndingDialogOpen(false);
    setEndingTaskIds([]);
  }, [activeBlock]);

  useEffect(() => subscribeTaskDagPanSpeedChanges(setPanSpeed), []);
  useEffect(() => subscribeTaskDagZoomSpeedChanges(setZoomSpeed), []);

  const viewportSurface: TaskDagViewportSurface = isDesktop
    ? "desktop"
    : "mobile";
  const updateControlsState = useCallback(
    (patch: Partial<TaskDagControlsState>) => {
      setControlsState((current) => ({
        ...current,
        ...patch,
      }));
    },
    [],
  );
  const handleDebugControlInteraction = useCallback(
    (payload: Record<string, unknown>) => {
      warnTaskDagInteraction("control-panel:event", payload);
    },
    [],
  );
  const setTransientManualLayoutSnapshot = useCallback(
    (snapshot: TaskDagManualLayoutSnapshot | null) => {
      manualLayoutSnapshotRef.current = snapshot;
      setManualLayoutSnapshotState(snapshot);
    },
    [],
  );
  const setManualLayoutSnapshot = useCallback(
    (snapshot: TaskDagManualLayoutSnapshot | null) => {
      const persistedSnapshot = setTaskDagManualLayoutSnapshot(snapshot);
      manualLayoutSnapshotRef.current = persistedSnapshot;
      setManualLayoutSnapshotState(persistedSnapshot);
    },
    [],
  );

  useEffect(() => {
    manualLayoutSnapshotRef.current = manualLayoutSnapshot;
  }, [manualLayoutSnapshot]);

  useEffect(() => {
    warnTaskDagInteraction("surface:update", {
      isDesktop,
      layoutMode,
      mode,
      viewportSurface,
      width: typeof window !== "undefined" ? window.innerWidth : null,
      height: typeof window !== "undefined" ? window.innerHeight : null,
      maxTouchPoints:
        typeof navigator !== "undefined" ? navigator.maxTouchPoints : null,
      controlsState,
    });
  }, [controlsState, isDesktop, layoutMode, mode, viewportSurface]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const handleStorage = (event: StorageEvent) => {
      switch (event.key) {
        case TASK_DAG_MODE_STORAGE_KEY:
          setMode(readStoredDagMode());
          return;
        case TASK_DAG_DIRECTION_STORAGE_KEY:
          setDagDirection(readStoredDagDirection());
          return;
        case TASK_DAG_LAYOUT_MODE_STORAGE_KEY:
          setLayoutMode(readStoredDagLayoutMode());
          return;
        case TASK_DAG_HIDE_TERMINAL_STORAGE_KEY:
          setTerminalFilterMode(readStoredTerminalFilterMode());
          return;
        case TASK_DAG_FOCUS_MODE_STORAGE_KEY:
          setFocusMode(readStoredFocusMode());
          return;
        case TASK_DAG_BACKGROUND_STORAGE_KEY:
          setBackgroundMode(readStoredBackgroundMode());
          return;
        case TASK_DAG_IMMERSIVE_STORAGE_KEY:
          setImmersive(readStoredImmersive());
          return;
        case TASK_DAG_NODE_SIZING_STORAGE_KEY:
          setNodeSizing(readStoredDagNodeSizing());
          return;
        case TASK_DAG_SEARCH_DRAFT_STORAGE_KEY:
          setSearchDraft(readStoredSearchDraft());
          return;
        case TASK_DAG_SEARCH_OPTIONS_STORAGE_KEY:
          setSearchOptions(readStoredSearchOptions());
          return;
        case TASK_DAG_TAG_FILTER_STORAGE_KEY:
          setTagFilter(readStoredTagFilter());
          return;
        case TASK_DAG_FOCUSED_SERIES_STORAGE_KEY:
          setFocusedSeriesAnchorIds(readStoredFocusedSeriesAnchorIds());
          return;
        case TASK_DAG_INTERVAL_COLLAPSE_STORAGE_KEY:
          setIntervalCollapseState(readStoredTaskDagIntervalCollapseState());
          return;
        case TASK_DAG_CONTROLS_STATE_STORAGE_KEY:
          setControlsState(readStoredControlsState());
          return;
        case TASK_DAG_VISIBILITY_STORAGE_KEY:
          setDagVisibility(readStoredDagVisibility());
          return;
        case TASK_DAG_VIEWPORT_STORAGE_KEY: {
          const nextViewport = readStoredDagViewport(
            dagDirection,
            viewportSurface,
          );
          if (!nextViewport) {
            return;
          }
          hasAppliedInitialViewportRef.current = true;
          flowInstanceRef.current?.setViewport(nextViewport);
          return;
        }
        case TASK_DAG_MANUAL_LAYOUT_STORAGE_KEY:
          setTransientManualLayoutSnapshot(getTaskDagManualLayoutSnapshot());
          return;
        default:
          return;
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [dagDirection, viewportSurface]);

  const resolvedDirection = useMemo(
    () => resolveDagDirection(dagDirection, isDesktop),
    [dagDirection, isDesktop],
  );

  useEffect(() => {
    if (!hasMountedDirectionRef.current) {
      hasMountedDirectionRef.current = true;
      return;
    }

    if (tasks.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      debugTaskDagExecute("viewport:fitView:direction-change", {
        direction: resolvedDirection,
        viewportBefore: snapshotViewport(flowInstanceRef.current),
      });
      void flowInstanceRef.current?.fitView(TASK_DAG_FIT_VIEW_OPTIONS);
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [resolvedDirection]);

  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const graph = useMemo(() => buildTaskGraph(tasks), [tasks]);
  const graphNodeById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const activeTaskIds = useMemo(
    () => resolveActiveBlockTaskIds(activeBlock),
    [activeBlock],
  );
  const activeTaskIdSet = useMemo(
    () => new Set(activeTaskIds),
    [activeTaskIds],
  );

  useEffect(() => {
    if (!hasLoadedTasksOnce) {
      return;
    }
    const prunedSnapshot = pruneTaskDagManualLayoutSnapshot(
      manualLayoutSnapshot,
      [
        ...graph.nodes.map((node) => node.id),
        ...pendingManualLayoutNodeIdsRef.current,
      ],
    );
    if (
      JSON.stringify(prunedSnapshot) === JSON.stringify(manualLayoutSnapshot)
    ) {
      return;
    }
    setManualLayoutSnapshot(prunedSnapshot);
  }, [
    graph.nodes,
    hasLoadedTasksOnce,
    manualLayoutSnapshot,
    setManualLayoutSnapshot,
  ]);

  const interactionGraph = useMemo(
    () =>
      terminalFilterMode === "hide"
        ? buildTaskGraph(tasks.filter((task) => !isTerminalStatus(task.status)))
        : graph,
    [graph, terminalFilterMode, tasks],
  );
  const visibleGraph = useMemo(
    () => projectVisibleTaskGraph(graph, dagVisibility),
    [graph, dagVisibility],
  );
  const normalizedVisibilityState = visibleGraph.state;
  const visibilityStateSignature = JSON.stringify(dagVisibility);
  const normalizedVisibilityStateSignature = JSON.stringify(
    normalizedVisibilityState,
  );
  const resolvedExistingIntervals = useMemo<ResolvedTaskDagInterval[]>(
    () =>
      listTaskDagIntervalCollapseDefinitions(intervalCollapseState).flatMap(
        (interval) => {
          const resolved = resolveTaskDagIntervalDefinition(
            graph,
            interval.startId,
            interval.endId,
          );
          return resolved.ok ? [resolved] : [];
        },
      ),
    [graph, intervalCollapseState],
  );
  const intervalCollapseProjection = useMemo(
    () =>
      projectVisibleTaskGraphWithIntervalCollapses(
        graph,
        visibleGraph,
        intervalCollapseState,
      ),
    [graph, intervalCollapseState, visibleGraph],
  );
  const intervalVisibleGraph = intervalCollapseProjection.visibleGraph;
  const intervalStateSignature = JSON.stringify(intervalCollapseState);
  const normalizedIntervalStateSignature = JSON.stringify(
    intervalCollapseProjection.normalizedState,
  );
  const availableTags = useMemo<TaskDagTagOption[]>(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      for (const rawTag of task.tags) {
        const tag = rawTag.trim();
        if (!tag) {
          continue;
        }
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.tag.localeCompare(right.tag, "zh-CN"),
      );
  }, [tasks]);
  const hasActiveUnifiedSearch =
    searchQuery.trim().length > 0 || tagFilter.selectedTags.length > 0;
  const unifiedSearchMatchedTaskIds = useMemo(
    () =>
      new Set(
        intervalVisibleGraph.nodes
          .filter((node) => {
            const task = taskById.get(node.id);
            return task
              ? matchesTaskDagTextSearch(task, searchQuery, searchOptions) &&
                  matchesTaskDagTagSearch(task, tagFilter)
              : false;
          })
          .map((node) => node.id),
      ),
    [
      intervalVisibleGraph.nodes,
      searchOptions,
      searchQuery,
      tagFilter,
      taskById,
    ],
  );
  const unifiedSearchFilteredVisibleGraph = useMemo(
    () =>
      hasActiveUnifiedSearch && searchOptions.filterMode
        ? filterVisibleGraphByNodeIds(
            intervalVisibleGraph,
            unifiedSearchMatchedTaskIds,
          )
        : intervalVisibleGraph,
    [
      hasActiveUnifiedSearch,
      intervalVisibleGraph,
      searchOptions.filterMode,
      unifiedSearchMatchedTaskIds,
    ],
  );
  const searchSecondaryNodeIds = useMemo(() => {
    if (!hasActiveUnifiedSearch || searchOptions.filterMode) {
      return new Set<string>();
    }
    return new Set(
      intervalVisibleGraph.nodes
        .filter((node) => !unifiedSearchMatchedTaskIds.has(node.id))
        .map((node) => node.id),
    );
  }, [
    hasActiveUnifiedSearch,
    intervalVisibleGraph.nodes,
    searchOptions.filterMode,
    unifiedSearchMatchedTaskIds,
  ]);
  const smartTerminalProjection = useMemo(
    () =>
      projectVisibleGraphForSmartTerminalMode(
        unifiedSearchFilteredVisibleGraph,
      ),
    [unifiedSearchFilteredVisibleGraph],
  );
  const terminalFilteredVisibleGraph = useMemo(
    () =>
      terminalFilterMode === "smart"
        ? smartTerminalProjection.visibleGraph
        : terminalFilterMode === "hide"
          ? filterStrictTerminalNodesFromVisibleGraph(
              unifiedSearchFilteredVisibleGraph,
            )
          : unifiedSearchFilteredVisibleGraph,
    [
      smartTerminalProjection.visibleGraph,
      terminalFilterMode,
      unifiedSearchFilteredVisibleGraph,
    ],
  );
  const terminalSecondaryNodeIds = useMemo(
    () =>
      terminalFilterMode === "smart"
        ? smartTerminalProjection.secondaryNodeIds
        : new Set<string>(),
    [smartTerminalProjection.secondaryNodeIds, terminalFilterMode],
  );
  const visibleFocusedSeriesNodeIds = useMemo(
    () =>
      collectVisibleTaskGraphConnectedComponentNodeIds(
        terminalFilteredVisibleGraph,
        focusedSeriesAnchorIds,
      ),
    [focusedSeriesAnchorIds, terminalFilteredVisibleGraph],
  );
  const visibleFocusedSeriesAnchorIds = useMemo(
    () =>
      focusedSeriesAnchorIds.filter((anchorId) =>
        visibleFocusedSeriesNodeIds.has(anchorId),
      ),
    [focusedSeriesAnchorIds, visibleFocusedSeriesNodeIds],
  );
  const hasVisibleFocusedSeries = visibleFocusedSeriesNodeIds.size > 0;
  const renderedVisibleGraph = useMemo(
    () =>
      focusMode === "hard" && hasVisibleFocusedSeries
        ? filterVisibleGraphByNodeIds(
            terminalFilteredVisibleGraph,
            visibleFocusedSeriesNodeIds,
          )
        : terminalFilteredVisibleGraph,
    [
      focusMode,
      hasVisibleFocusedSeries,
      terminalFilteredVisibleGraph,
      visibleFocusedSeriesNodeIds,
    ],
  );
  const focusSecondaryNodeIds = useMemo(() => {
    if (focusMode !== "soft" || !hasVisibleFocusedSeries) {
      return new Set<string>();
    }
    return new Set(
      terminalFilteredVisibleGraph.nodes
        .filter((node) => !visibleFocusedSeriesNodeIds.has(node.id))
        .map((node) => node.id),
    );
  }, [
    focusMode,
    hasVisibleFocusedSeries,
    terminalFilteredVisibleGraph.nodes,
    visibleFocusedSeriesNodeIds,
  ]);
  const renderedVisibleNodeById = useMemo(
    () => new Map(renderedVisibleGraph.nodes.map((node) => [node.id, node])),
    [renderedVisibleGraph.nodes],
  );
  const visibleNodeIdSet = useMemo(
    () => new Set(renderedVisibleGraph.nodes.map((node) => node.id)),
    [renderedVisibleGraph.nodes],
  );
  const secondaryNodeIds = useMemo(
    () =>
      new Set(
        [
          ...searchSecondaryNodeIds,
          ...terminalSecondaryNodeIds,
          ...focusSecondaryNodeIds,
        ].filter((nodeId) => visibleNodeIdSet.has(nodeId)),
      ),
    [
      focusSecondaryNodeIds,
      searchSecondaryNodeIds,
      terminalSecondaryNodeIds,
      visibleNodeIdSet,
    ],
  );
  const searchMatchCount = useMemo(() => {
    if (!hasActiveUnifiedSearch) return 0;
    return terminalFilteredVisibleGraph.nodes.reduce(
      (count, node) =>
        unifiedSearchMatchedTaskIds.has(node.id) ? count + 1 : count,
      0,
    );
  }, [
    hasActiveUnifiedSearch,
    terminalFilteredVisibleGraph.nodes,
    unifiedSearchMatchedTaskIds,
  ]);
  const hiddenRunningNodeCount = useMemo(() => {
    const hiddenRunningNodeIds = intervalVisibleGraph.nodes
      .filter(
        (node) =>
          !visibleNodeIdSet.has(node.id) &&
          (taskById.get(node.id)?.status === "in_progress" ||
            activeTaskIdSet.has(node.id)),
      )
      .map((node) => node.id);

    return new Set(hiddenRunningNodeIds).size;
  }, [activeTaskIdSet, intervalVisibleGraph.nodes, taskById, visibleNodeIdSet]);
  const collapsedUpstreamAnchorCount =
    normalizedVisibilityState.collapsedUpstreamOf.length;
  const collapsedDownstreamAnchorCount =
    normalizedVisibilityState.collapsedDownstreamOf.length;
  const collapsedIntervalCount = useMemo(
    () =>
      countCollapsedTaskDagIntervals(
        intervalCollapseProjection.normalizedState,
      ),
    [intervalCollapseProjection.normalizedState],
  );
  const hasFoldSummary =
    collapsedUpstreamAnchorCount > 0 ||
    collapsedDownstreamAnchorCount > 0 ||
    collapsedIntervalCount > 0;

  useEffect(() => {
    if (!hasLoadedTasksOnce) {
      return;
    }
    if (normalizedVisibilityStateSignature === visibilityStateSignature) {
      return;
    }
    setDagVisibility(normalizedVisibilityState);
  }, [
    hasLoadedTasksOnce,
    normalizedVisibilityState,
    normalizedVisibilityStateSignature,
    visibilityStateSignature,
  ]);

  useEffect(() => {
    if (!hasLoadedTasksOnce) {
      return;
    }
    if (normalizedIntervalStateSignature === intervalStateSignature) {
      return;
    }
    setIntervalCollapseState(intervalCollapseProjection.normalizedState);
  }, [
    hasLoadedTasksOnce,
    intervalCollapseProjection.normalizedState,
    intervalStateSignature,
    normalizedIntervalStateSignature,
  ]);

  useEffect(() => {
    debugTaskDagExecute("visibleGraph:update", {
      mode,
      taskIds: tasks.map((task) => task.id),
      activeTaskIds,
      visibleNodeIds: renderedVisibleGraph.nodes.map((node) => node.id),
      hiddenNodeIds: renderedVisibleGraph.hiddenNodeIds,
      collapsedUpstreamOf: normalizedVisibilityState.collapsedUpstreamOf,
      collapsedDownstreamOf: normalizedVisibilityState.collapsedDownstreamOf,
      intervalCollapseState,
      viewport: snapshotViewport(flowInstanceRef.current),
    });
  }, [
    activeTaskIds,
    intervalCollapseState,
    mode,
    normalizedVisibilityState.collapsedDownstreamOf,
    normalizedVisibilityState.collapsedUpstreamOf,
    renderedVisibleGraph.hiddenNodeIds,
    renderedVisibleGraph.nodes,
    tasks,
  ]);

  useEffect(() => {
    if (selectedTaskId && !visibleNodeIdSet.has(selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [selectedTaskId, visibleNodeIdSet]);

  useEffect(() => {
    if (connectState && !visibleNodeIdSet.has(connectState.sourceId)) {
      setConnectState(null);
    }
  }, [connectState, visibleNodeIdSet]);

  useEffect(() => {
    if (
      pendingIntervalStartId &&
      !visibleNodeIdSet.has(pendingIntervalStartId)
    ) {
      setPendingIntervalStartId(null);
    }
  }, [pendingIntervalStartId, visibleNodeIdSet]);

  const layoutSignature = useMemo(
    () =>
      JSON.stringify({
        direction: resolvedDirection,
        nodeIds: renderedVisibleGraph.nodes.map((node) => node.id),
        edges: renderedVisibleGraph.edges.map((edge) => [
          edge.id,
          edge.source,
          edge.target,
          edge.type,
        ]),
      }),
    [renderedVisibleGraph.edges, renderedVisibleGraph.nodes, resolvedDirection],
  );

  const manualPositionSource =
    layoutMode === "manual"
      ? {
          ...(manualLayoutSnapshot?.manualBaselinePositions ?? {}),
          ...(manualLayoutSnapshot?.manualPositions ?? {}),
        }
      : undefined;
  const renderedAutoLayoutFlowGraph = useMemo(
    () =>
      buildVisibleTaskDagFlow(renderedVisibleGraph, {
        direction: resolvedDirection,
      }),
    [layoutSignature, renderedVisibleGraph, resolvedDirection],
  );
  const renderedAutoLayoutPositionMap = useMemo(
    () => buildPositionMapFromFlowNodes(renderedAutoLayoutFlowGraph.nodes),
    [renderedAutoLayoutFlowGraph.nodes],
  );
  const manualBaselineFlowGraph = useMemo(
    () =>
      buildVisibleTaskDagFlow(intervalVisibleGraph, {
        direction: resolvedDirection,
      }),
    [intervalVisibleGraph.edges, intervalVisibleGraph.nodes, resolvedDirection],
  );
  const manualBaselinePositionMap = useMemo(
    () => buildPositionMapFromFlowNodes(manualBaselineFlowGraph.nodes),
    [manualBaselineFlowGraph.nodes],
  );

  const layoutFlowGraph = useMemo(
    () =>
      buildVisibleTaskDagFlow(renderedVisibleGraph, {
        direction: resolvedDirection,
        focusedSeriesNodeIds: visibleFocusedSeriesNodeIds,
        manualPositions: manualPositionSource,
        secondaryNodeIds,
      }),
    [
      layoutSignature,
      manualPositionSource,
      renderedVisibleGraph,
      resolvedDirection,
      secondaryNodeIds,
      visibleFocusedSeriesNodeIds,
    ],
  );

  const handleManualLayoutNodesChange = useCallback(
    (changes: NodeChange<TaskDagFlowNode>[]) => {
      if (layoutMode !== "manual") {
        return;
      }

      let nextSnapshot = manualLayoutSnapshotRef.current;
      let hasPositionChange = false;

      for (const change of changes) {
        if (change.type !== "position" || !change.position) {
          continue;
        }

        nextSnapshot = updateTaskDagManualLayoutPosition(
          nextSnapshot,
          change.id,
          change.position,
        );
        hasPositionChange = true;
      }

      if (!hasPositionChange) {
        return;
      }

      warnTaskDagInteraction("manual-layout:nodes-change", {
        changeCount: changes.length,
        positions: changes.flatMap((change) => {
          if (!isTaskDagPositionChange(change) || !change.position) {
            return [];
          }

          return [
            {
              id: change.id,
              position: change.position,
              dragging: change.dragging ?? null,
            },
          ];
        }),
      });
      setTransientManualLayoutSnapshot(nextSnapshot);
    },
    [layoutMode, setTransientManualLayoutSnapshot],
  );

  const handleManualTouchNodePointerDown = useCallback(
    (nodeId: string, event: ReactPointerEvent<HTMLDivElement>) => {
      if (layoutMode !== "manual" || event.pointerType !== "touch") {
        return;
      }

      const startPosition =
        flowNodePositionByIdRef.current.get(nodeId) ??
        manualLayoutSnapshotRef.current?.manualPositions[nodeId];

      if (!startPosition) {
        warnTaskDagInteraction("manual-layout:touch-pointerdown-miss", {
          nodeId,
        });
        return;
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore browsers that cannot capture this pointer on the node element.
      }
      event.preventDefault();
      event.stopPropagation();

      manualTouchDragRef.current = {
        pointerId: event.pointerId,
        nodeId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPosition,
        lastPosition: startPosition,
        sourceElement: event.currentTarget,
        moved: false,
      };
      const focusHardContext = focusHardDragContextRef.current;
      focusHardDragDebugRef.current =
        focusHardContext.focusMode === "hard" &&
        focusHardContext.visibleFocusedSeriesNodeIds.length > 0
          ? {
              pointerId: event.pointerId,
              nodeId,
              startViewport: snapshotViewport(flowInstanceRef.current),
              startFlowNodeIds: [...focusHardContext.currentFlowNodeIds],
              anomalyKinds: new Set<string>(),
            }
          : null;
      suppressNodeClickRef.current = null;
      setManualTouchNodeDragActive(true);
      warnTaskDagInteraction("manual-layout:touch-pointerdown", {
        nodeId,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startPosition,
      });
      if (focusHardDragDebugRef.current) {
        warnTaskDagInteraction("focus-hard:drag-session-start", {
          nodeId,
          pointerId: event.pointerId,
          focusedSeriesAnchorIds: focusHardContext.focusedSeriesAnchorIds,
          visibleFocusedSeriesNodeIds:
            focusHardContext.visibleFocusedSeriesNodeIds,
          renderedNodeIds: focusHardContext.renderedNodeIds,
          currentFlowNodeIds: focusHardContext.currentFlowNodeIds,
          startViewport: focusHardDragDebugRef.current.startViewport,
        });
      }
    },
    [layoutMode],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const releasePointerCapture = (
      dragState: TaskDagManualTouchDragState | null,
    ) => {
      if (!dragState?.sourceElement) {
        return;
      }

      try {
        if (dragState.sourceElement.hasPointerCapture(dragState.pointerId)) {
          dragState.sourceElement.releasePointerCapture(dragState.pointerId);
        }
      } catch {
        // Ignore browsers that do not support pointer capture inspection on this element.
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = manualTouchDragRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const zoom = Math.max(
        flowInstanceRef.current?.getViewport().zoom ?? 1,
        TASK_DAG_MIN_ZOOM,
      );
      const nextPosition = {
        x:
          dragState.startPosition.x +
          (event.clientX - dragState.startClientX) / zoom,
        y:
          dragState.startPosition.y +
          (event.clientY - dragState.startClientY) / zoom,
      };
      const moved =
        dragState.moved ||
        nextPosition.x !== dragState.startPosition.x ||
        nextPosition.y !== dragState.startPosition.y;

      manualTouchDragRef.current = {
        ...dragState,
        moved,
        lastPosition: nextPosition,
      };

      if (moved && !dragState.moved) {
        warnTaskDagInteraction("manual-layout:touch-drag-start", {
          nodeId: dragState.nodeId,
          pointerId: dragState.pointerId,
          nextPosition,
        });
      }

      setTransientManualLayoutSnapshot(
        updateTaskDagManualLayoutPosition(
          manualLayoutSnapshotRef.current,
          dragState.nodeId,
          nextPosition,
        ),
      );

      const focusHardSession = focusHardDragDebugRef.current;
      if (focusHardSession && focusHardSession.pointerId === event.pointerId) {
        const focusHardContext = focusHardDragContextRef.current;
        const domSummary = summarizeRenderedFlowNodes();
        const anomalyKind = resolveFocusHardDragAnomalyKind(
          focusHardContext,
          domSummary,
        );
        if (anomalyKind && !focusHardSession.anomalyKinds.has(anomalyKind)) {
          focusHardSession.anomalyKinds.add(anomalyKind);
          warnTaskDagInteraction("focus-hard:drag-session-anomaly", {
            nodeId: dragState.nodeId,
            pointerId: dragState.pointerId,
            anomalyKind,
            focusedSeriesAnchorIds: focusHardContext.focusedSeriesAnchorIds,
            visibleFocusedSeriesNodeIds:
              focusHardContext.visibleFocusedSeriesNodeIds,
            startViewport: focusHardSession.startViewport,
            currentViewport: snapshotViewport(flowInstanceRef.current),
            startFlowNodeIds: focusHardSession.startFlowNodeIds,
            currentFlowNodeIds: focusHardContext.currentFlowNodeIds,
            renderedNodeIds: focusHardContext.renderedNodeIds,
            visibleRenderedNodeIds: domSummary.visibleRenderedNodeIds,
            nodesDomCount: domSummary.renderedCount,
            edgesDomCount: domSummary.edgesDomCount,
            edgePathCount: domSummary.edgePathCount,
            viewportTransform: domSummary.viewportTransform,
            viewportRect: domSummary.viewportRect,
            wrapperRect: domSummary.wrapperRect,
            zeroRectNodeIds: domSummary.zeroRectNodeIds,
          });
        }
      }
    };

    const finishPointerDrag = (
      event: PointerEvent,
      reason: "pointerup" | "pointercancel",
    ) => {
      const dragState = manualTouchDragRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      manualTouchDragRef.current = null;
      setManualTouchNodeDragActive(false);
      releasePointerCapture(dragState);
      const focusHardSession = focusHardDragDebugRef.current;
      focusHardDragDebugRef.current = null;

      if (!dragState.moved) {
        warnTaskDagInteraction("manual-layout:touch-drag-end", {
          nodeId: dragState.nodeId,
          reason,
          moved: false,
        });
        if (
          focusHardSession &&
          focusHardSession.pointerId === event.pointerId
        ) {
          warnTaskDagInteraction("focus-hard:drag-session-end", {
            nodeId: dragState.nodeId,
            pointerId: dragState.pointerId,
            reason,
            moved: false,
            anomalyKinds: [...focusHardSession.anomalyKinds],
            endViewport: snapshotViewport(flowInstanceRef.current),
          });
        }
        return;
      }

      suppressNodeClickRef.current = {
        nodeId: dragState.nodeId,
        until: Date.now() + TASK_DAG_MANUAL_TOUCH_CLICK_SUPPRESS_MS,
      };
      warnTaskDagInteraction("manual-layout:touch-drag-end", {
        nodeId: dragState.nodeId,
        reason,
        moved: true,
        finalPosition: dragState.lastPosition,
      });
      if (focusHardSession && focusHardSession.pointerId === event.pointerId) {
        const focusHardContext = focusHardDragContextRef.current;
        const domSummary = summarizeRenderedFlowNodes();
        warnTaskDagInteraction("focus-hard:drag-session-end", {
          nodeId: dragState.nodeId,
          pointerId: dragState.pointerId,
          reason,
          moved: true,
          finalPosition: dragState.lastPosition,
          anomalyKinds: [...focusHardSession.anomalyKinds],
          focusedSeriesAnchorIds: focusHardContext.focusedSeriesAnchorIds,
          visibleFocusedSeriesNodeIds:
            focusHardContext.visibleFocusedSeriesNodeIds,
          endViewport: snapshotViewport(flowInstanceRef.current),
          currentFlowNodeIds: focusHardContext.currentFlowNodeIds,
          renderedNodeIds: focusHardContext.renderedNodeIds,
          visibleRenderedNodeIds: domSummary.visibleRenderedNodeIds,
          nodesDomCount: domSummary.renderedCount,
          edgesDomCount: domSummary.edgesDomCount,
          edgePathCount: domSummary.edgePathCount,
          viewportTransform: domSummary.viewportTransform,
          viewportRect: domSummary.viewportRect,
          wrapperRect: domSummary.wrapperRect,
          zeroRectNodeIds: domSummary.zeroRectNodeIds,
        });
      }
      setManualLayoutSnapshot(
        updateTaskDagManualLayoutPosition(
          manualLayoutSnapshotRef.current,
          dragState.nodeId,
          dragState.lastPosition,
        ),
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      finishPointerDrag(event, "pointerup");
    };
    const handlePointerCancel = (event: PointerEvent) => {
      finishPointerDrag(event, "pointercancel");
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel, {
      passive: false,
    });

    return () => {
      const activeDrag = manualTouchDragRef.current;
      if (activeDrag) {
        releasePointerCapture(activeDrag);
        manualTouchDragRef.current = null;
      }
      focusHardDragDebugRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [setManualLayoutSnapshot, setTransientManualLayoutSnapshot]);

  useEffect(() => {
    if (layoutMode === "manual") {
      return;
    }

    manualTouchDragRef.current = null;
    focusHardDragDebugRef.current = null;
    setManualTouchNodeDragActive(false);
  }, [layoutMode]);

  const flowGraph = useMemo(() => {
    const cachedNodeDimensions = flowNodeDimensionCacheRef.current;
    return {
      nodes: layoutFlowGraph.nodes.map((node) => {
        const task = taskById.get(node.id);
        const graphNode = graphNodeById.get(node.id);
        const visibleNode = renderedVisibleNodeById.get(node.id);
        const blockedReason = task ? buildBlockedReason(task, taskById) : null;
        const intervalCollapseSummaries: TaskDagIntervalSummary[] = (
          intervalCollapseProjection.collapsedIntervalsByTerminalId.get(
            node.id,
          ) ?? []
        ).map((interval) => ({
          startId: interval.startId,
          startTitle: taskById.get(interval.startId)?.title ?? interval.startId,
          memberCount: interval.memberCount,
          collapsed: interval.collapsed,
        }));

        return {
          ...node,
          ...resolveTaskDagFlowNodeDimensions(node.id, cachedNodeDimensions),
          draggable: layoutMode === "manual" && !manualTouchNodeDragActive,
          data: {
            ...node.data,
            title: task?.title ?? visibleNode?.title ?? node.data.title,
            statusLabel: task
              ? TASK_STATUS_LABELS[task.status]
              : node.data.statusLabel,
            priorityLabel: task
              ? TASK_PRIORITY_LABELS[task.priority]
              : node.data.priorityLabel,
            executionLabel:
              task && graphNode
                ? resolveTaskDagExecutionLabel(
                    task,
                    graphNode.isBlocked,
                    graphNode.isExecutable,
                  )
                : node.data.executionLabel,
            layoutMode,
            fixedWidth: nodeSizing.fixedWidth,
            fixedHeight: nodeSizing.fixedHeight,
            isSelected: node.id === selectedTaskId,
            isSearchMatch:
              hasActiveUnifiedSearch &&
              unifiedSearchMatchedTaskIds.has(node.id),
            isSearchDimmed:
              hasActiveUnifiedSearch &&
              !unifiedSearchMatchedTaskIds.has(node.id),
            isFocusDimmed:
              hasVisibleFocusedSeries &&
              !visibleFocusedSeriesNodeIds.has(node.id),
            isFocusAnchor: focusedSeriesAnchorIds.includes(node.id),
            isSecondaryNode: secondaryNodeIds.has(node.id),
            isCurrentRoot:
              node.id === renderedVisibleGraph.visibleCurrentRootNodeId,
            isCollapsedTarget:
              visibleNode?.isCollapsedTarget ?? node.data.isCollapsedTarget,
            isCollapsedUpstreamTarget:
              visibleNode?.isCollapsedUpstreamTarget ??
              node.data.isCollapsedUpstreamTarget,
            isCollapsedDownstreamTarget:
              visibleNode?.isCollapsedDownstreamTarget ??
              node.data.isCollapsedDownstreamTarget,
            isBlocked:
              graphNode?.isBlocked ??
              visibleNode?.isBlocked ??
              node.data.isBlocked,
            isExecutable:
              graphNode?.isExecutable ??
              visibleNode?.isExecutable ??
              node.data.isExecutable,
            hiddenUpstreamCount:
              visibleNode?.hiddenUpstreamCount ?? node.data.hiddenUpstreamCount,
            hiddenDownstreamCount:
              visibleNode?.hiddenDownstreamCount ??
              node.data.hiddenDownstreamCount,
            intervalCollapseSummaries,
            blockedReason,
            showConnectHandles: mode === "connect",
            connectPreviewType:
              connectState?.sourceId === node.id ? connectState.type : null,
            onManualTouchPointerDown: handleManualTouchNodePointerDown,
            executeState:
              task && graphNode
                ? resolveExecuteState(
                    task,
                    graphNode.isBlocked,
                    graphNode.isExecutable,
                    activeTaskIdSet,
                  )
                : undefined,
          },
        } satisfies TaskDagFlowNode;
      }),
      edges: layoutFlowGraph.edges,
    };
  }, [
    activeTaskIdSet,
    connectState,
    graphNodeById,
    intervalCollapseProjection.collapsedIntervalsByTerminalId,
    layoutFlowGraph.edges,
    layoutFlowGraph.nodes,
    renderedVisibleGraph,
    renderedVisibleNodeById,
    hasVisibleFocusedSeries,
    hasActiveUnifiedSearch,
    layoutMode,
    manualTouchNodeDragActive,
    focusedSeriesAnchorIds,
    nodeSizing.fixedHeight,
    nodeSizing.fixedWidth,
    secondaryNodeIds,
    selectedTaskId,
    taskById,
    unifiedSearchMatchedTaskIds,
    visibleFocusedSeriesNodeIds,
    handleManualTouchNodePointerDown,
    mode,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return () => {};
    }

    const rafId = window.requestAnimationFrame(() => {
      const debugFlowInstance =
        flowInstanceRef.current as TaskDagDebugFlowInstance | null;
      if (!debugFlowInstance?.getInternalNode) {
        return;
      }

      const nextCache = new Map<string, TaskDagCachedFlowNodeDimensions>();
      for (const node of flowGraph.nodes) {
        const internalNode = debugFlowInstance.getInternalNode(node.id);
        const measuredWidth = toNullableNumber(internalNode?.measured?.width);
        const measuredHeight = toNullableNumber(internalNode?.measured?.height);
        if (measuredWidth == null || measuredHeight == null) {
          const cached = flowNodeDimensionCacheRef.current.get(node.id);
          if (cached) {
            nextCache.set(node.id, cached);
          }
          continue;
        }

        nextCache.set(node.id, {
          measured: {
            width: measuredWidth,
            height: measuredHeight,
          },
          width: toNullableNumber(internalNode?.width),
          height: toNullableNumber(internalNode?.height),
          initialWidth: toNullableNumber(internalNode?.initialWidth),
          initialHeight: toNullableNumber(internalNode?.initialHeight),
        });
      }

      flowNodeDimensionCacheRef.current = nextCache;
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [flowGraph.nodes]);

  useEffect(() => {
    flowNodePositionByIdRef.current = new Map(
      flowGraph.nodes.map((node) => [node.id, node.position]),
    );
  }, [flowGraph.nodes]);

  useEffect(() => {
    focusHardDragContextRef.current = {
      focusMode,
      focusedSeriesAnchorIds: [...focusedSeriesAnchorIds],
      visibleFocusedSeriesNodeIds: [...visibleFocusedSeriesNodeIds],
      currentFlowNodeIds: flowGraph.nodes.map((node) => node.id),
      renderedNodeIds: renderedVisibleGraph.nodes.map((node) => node.id),
      edgeCount: renderedVisibleGraph.edges.length,
    };
  }, [
    focusMode,
    focusedSeriesAnchorIds,
    flowGraph.nodes,
    renderedVisibleGraph.edges.length,
    renderedVisibleGraph.nodes,
    visibleFocusedSeriesNodeIds,
  ]);

  const getTaskDagDebugSnapshot = useCallback((): TaskDagDebugSnapshot => {
    const context: TaskDagFocusHardDragContext = {
      focusMode,
      focusedSeriesAnchorIds: [...focusedSeriesAnchorIds],
      visibleFocusedSeriesNodeIds: [...visibleFocusedSeriesNodeIds],
      currentFlowNodeIds: flowGraph.nodes.map((node) => node.id),
      renderedNodeIds: renderedVisibleGraph.nodes.map((node) => node.id),
      edgeCount: renderedVisibleGraph.edges.length,
    };
    const debugFlowInstance =
      flowInstanceRef.current as TaskDagDebugFlowInstance | null;
    const internalNodes = flowGraph.nodes.flatMap((node) => {
      const internalNode = debugFlowInstance?.getInternalNode?.(node.id);
      return internalNode ? [internalNode] : [];
    });
    const flowNodeDimensionSummary = summarizeTaskDagFlowNodeDimensions(
      flowGraph.nodes,
      internalNodes,
    );
    const domSummary = summarizeRenderedFlowNodes();
    return {
      route:
        typeof window !== "undefined"
          ? (window.location?.pathname ?? null)
          : null,
      focusMode,
      focusedSeriesAnchorIds: context.focusedSeriesAnchorIds,
      visibleFocusedSeriesNodeIds: context.visibleFocusedSeriesNodeIds,
      currentFlowNodeIds: context.currentFlowNodeIds,
      renderedGraphNodeIds: context.renderedNodeIds,
      renderedGraphEdgeCount: context.edgeCount,
      flowNodeDimensionSummary,
      domSummary,
      anomalyKinds: detectTaskDagFocusHardStateAnomalies(context, domSummary),
    };
  }, [
    focusMode,
    focusedSeriesAnchorIds,
    flowGraph.nodes,
    renderedVisibleGraph.edges.length,
    renderedVisibleGraph.nodes,
    visibleFocusedSeriesNodeIds,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const targetWindow = window as TaskDagDebugWindow;
    targetWindow.__EXOMIND_TASK_DAG_DEBUG__ = {
      getSnapshot: getTaskDagDebugSnapshot,
      getHistory: () => [...taskDagDebugHistoryRef.current],
      clearHistory: () => {
        taskDagDebugHistoryRef.current = [];
        taskDagDebugHistorySignatureRef.current = null;
      },
    };

    return () => {
      if (
        targetWindow.__EXOMIND_TASK_DAG_DEBUG__?.getSnapshot ===
        getTaskDagDebugSnapshot
      ) {
        delete targetWindow.__EXOMIND_TASK_DAG_DEBUG__;
      }
    };
  }, [getTaskDagDebugSnapshot]);

  useEffect(() => {
    const snapshot = getTaskDagDebugSnapshot();
    const historySignature = JSON.stringify({
      anomalyKinds: snapshot.anomalyKinds,
      hiddenRenderedNodeIds: snapshot.domSummary.hiddenRenderedNodeIds,
      edgesDomCount: snapshot.domSummary.edgesDomCount,
      edgePathCount: snapshot.domSummary.edgePathCount,
      viewportTransform: snapshot.domSummary.viewportTransform,
      controlledMeasuredCount:
        snapshot.flowNodeDimensionSummary.controlledMeasuredCount,
      controlledSizedCount:
        snapshot.flowNodeDimensionSummary.controlledSizedCount,
      instancePresentCount:
        snapshot.flowNodeDimensionSummary.instancePresentCount,
      instanceMeasuredCount:
        snapshot.flowNodeDimensionSummary.instanceMeasuredCount,
      instanceHandleBoundsCount:
        snapshot.flowNodeDimensionSummary.instanceHandleBoundsCount,
      instanceHiddenNodeIds: snapshot.flowNodeDimensionSummary.nodes
        .filter((node) => node.instanceHidden)
        .map((node) => node.id),
      instanceMissingMeasuredNodeIds: snapshot.flowNodeDimensionSummary.nodes
        .filter((node) => node.instancePresent && !node.instanceHasMeasured)
        .map((node) => node.id),
      instanceMissingHandleBoundsNodeIds:
        snapshot.flowNodeDimensionSummary.nodes
          .filter(
            (node) => node.instancePresent && !node.instanceHasHandleBounds,
          )
          .map((node) => node.id),
    });
    if (taskDagDebugHistorySignatureRef.current !== historySignature) {
      taskDagDebugHistorySignatureRef.current = historySignature;
      taskDagDebugHistoryRef.current = [
        ...taskDagDebugHistoryRef.current.slice(-39),
        {
          timestamp: Date.now(),
          snapshot,
        },
      ];
    }

    if (snapshot.anomalyKinds.length === 0) {
      focusHardStateAnomalySignatureRef.current = null;
      return;
    }

    const signature = JSON.stringify({
      anomalyKinds: snapshot.anomalyKinds,
      focusedSeriesAnchorIds: snapshot.focusedSeriesAnchorIds,
      renderedGraphNodeIds: snapshot.renderedGraphNodeIds,
      hiddenRenderedNodeIds: snapshot.domSummary.hiddenRenderedNodeIds,
      edgesDomCount: snapshot.domSummary.edgesDomCount,
      edgePathCount: snapshot.domSummary.edgePathCount,
    });
    if (focusHardStateAnomalySignatureRef.current === signature) {
      return;
    }
    focusHardStateAnomalySignatureRef.current = signature;
    warnTaskDagInteraction("focus-hard:state-anomaly", snapshot);
  }, [getTaskDagDebugSnapshot]);

  const handleLayoutModeChange = useCallback(
    (nextMode: TaskDagLayoutMode) => {
      if (nextMode === layoutMode) {
        return;
      }

      if (nextMode === "manual") {
        const visiblePositions = buildPositionMapFromFlowNodes(flowGraph.nodes);
        let nextSnapshot = mergeTaskDagManualLayoutPositions(
          manualLayoutSnapshotRef.current,
          visiblePositions,
        );
        nextSnapshot = setTaskDagManualLayoutBaselinePositions(
          nextSnapshot,
          manualBaselinePositionMap,
        );
        setManualLayoutSnapshot(nextSnapshot);
      }

      setLayoutMode(nextMode);
    },
    [
      flowGraph.nodes,
      layoutMode,
      manualBaselinePositionMap,
      setManualLayoutSnapshot,
    ],
  );

  const handleSyncManualLayoutToAuto = useCallback(() => {
    if (layoutMode !== "manual") {
      return;
    }

    setManualLayoutSnapshot(
      mergeTaskDagManualLayoutPositions(
        manualLayoutSnapshotRef.current,
        renderedAutoLayoutPositionMap,
      ),
    );
  }, [layoutMode, renderedAutoLayoutPositionMap, setManualLayoutSnapshot]);

  useEffect(() => {
    const layoutSummary = summarizeFlowViewport(
      flowInstanceRef.current,
      flowGraph.nodes,
    );
    debugTaskDagExecute("flowGraph:update", {
      resolvedDirection,
      nodeCount: flowGraph.nodes.length,
      edgeCount: flowGraph.edges.length,
      layoutSummary,
    });

    const rafId = window.requestAnimationFrame(() => {
      debugTaskDagExecute("flowGraph:dom-update", {
        resolvedDirection,
        nodeCount: flowGraph.nodes.length,
        domSummary: summarizeRenderedFlowNodes(),
      });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [flowGraph.edges, flowGraph.nodes, resolvedDirection]);

  const cycleTaskDagMode = useCallback((delta: 1 | -1) => {
    setMode((current) => getNextTaskDagMode(current, delta));
  }, []);

  const handleCanvasModeWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const wheelRegion = wheelListenerRef.current;
      if (!wheelRegion) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node) || !wheelRegion.contains(target)) {
        return;
      }
      if (!event.ctrlKey || !event.altKey || event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      cycleTaskDagMode(event.deltaY > 0 ? 1 : -1);
    },
    [cycleTaskDagMode],
  );

  useEffect(() => {
    if (
      !pendingFocusTaskId ||
      !visibleNodeIdSet.has(pendingFocusTaskId) ||
      !flowInstanceRef.current
    ) {
      return;
    }

    const focusTaskId = pendingFocusTaskId;
    setSelectedTaskId(focusTaskId);

    const timeoutId = window.setTimeout(() => {
      focusNodeInViewport(
        focusTaskId,
        flowInstanceRef.current,
        flowGraph.nodes,
      );
      ensureNodeVisible(focusTaskId, flowInstanceRef.current, flowGraph.nodes);
      setPendingFocusTaskId((current) =>
        current === focusTaskId ? null : current,
      );
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [flowGraph.nodes, pendingFocusTaskId, visibleNodeIdSet]);

  useEffect(() => {
    if (!focusTaskIdFromSearch) {
      lastHandledFocusSearchRef.current = null;
      return;
    }
    if (lastHandledFocusSearchRef.current === focusTaskIdFromSearch) {
      return;
    }
    if (locateTaskFromSearch) {
      setMode("browse");
      setTerminalFilterMode("show");
      setDagVisibility(EMPTY_TASK_DAG_VISIBILITY_STATE);
      setSearchDraft("");
      setSearchQuery("");
    }
    lastHandledFocusSearchRef.current = focusTaskIdFromSearch;
    setPendingFocusTaskId(focusTaskIdFromSearch);
  }, [focusTaskIdFromSearch, locateTaskFromSearch]);

  useEffect(() => {
    if (flowGraph.nodes.length === 0) {
      hasAppliedInitialViewportRef.current = false;
      return;
    }

    if (!flowInstanceRef.current || hasAppliedInitialViewportRef.current) {
      return;
    }

    hasAppliedInitialViewportRef.current = true;
    const storedViewport = readStoredDagViewport(dagDirection, viewportSurface);
    if (!storedViewport) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      debugTaskDagExecute("viewport:setViewport:restore-effect", {
        direction: dagDirection,
        viewport: storedViewport,
      });
      flowInstanceRef.current?.setViewport(storedViewport);
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [dagDirection, flowGraph.nodes.length, viewportSurface]);

  useEffect(
    () => () => {
      const viewport = flowInstanceRef.current?.getViewport();
      if (viewport) {
        writeStoredDagViewport(dagDirection, viewport, viewportSurface);
      }
    },
    [dagDirection, viewportSurface],
  );

  const toggleCollapse = (
    direction: "upstream" | "downstream",
    nodeId: string,
  ) => {
    setDagVisibility((prev) => {
      if (direction === "upstream") {
        return {
          ...prev,
          collapsedUpstreamOf: prev.collapsedUpstreamOf.includes(nodeId)
            ? prev.collapsedUpstreamOf.filter((id) => id !== nodeId)
            : [...prev.collapsedUpstreamOf, nodeId],
        };
      }

      return {
        ...prev,
        collapsedDownstreamOf: prev.collapsedDownstreamOf.includes(nodeId)
          ? prev.collapsedDownstreamOf.filter((id) => id !== nodeId)
          : [...prev.collapsedDownstreamOf, nodeId],
      };
    });
  };

  const resolveCollapseActionState = useCallback(
    (direction: "upstream" | "downstream", nodeId: string) => {
      const collapsed =
        direction === "upstream"
          ? dagVisibility.collapsedUpstreamOf.includes(nodeId)
          : dagVisibility.collapsedDownstreamOf.includes(nodeId);
      const scope = calculateTaskDagCollapseScope(
        interactionGraph,
        dagVisibility,
        direction,
        nodeId,
      );
      return {
        collapsed,
        visible: collapsed || scope.size > 1,
      };
    },
    [dagVisibility, interactionGraph],
  );

  const handleSetIntervalCollapsed = useCallback(
    (startId: string, endId: string, nextCollapsed: boolean) => {
      setIntervalCollapseState((current) =>
        setTaskDagIntervalCollapsedInState(
          current,
          startId,
          endId,
          nextCollapsed,
        ),
      );
    },
    [],
  );

  const handleToggleIntervalsForTerminal = useCallback(
    (terminalId: string, nextCollapsed: boolean) => {
      const intervals =
        intervalCollapseProjection.intervalsByTerminalId.get(terminalId) ?? [];
      if (intervals.length === 0) {
        return;
      }

      setIntervalCollapseState((current) =>
        setTaskDagIntervalsCollapsedForTerminal(
          current,
          terminalId,
          nextCollapsed,
        ),
      );
    },
    [intervalCollapseProjection.intervalsByTerminalId],
  );

  const handleClearAllFoldedState = useCallback(() => {
    if (
      collapsedUpstreamAnchorCount > 0 ||
      collapsedDownstreamAnchorCount > 0
    ) {
      setDagVisibility((current) => ({
        ...current,
        collapsedUpstreamOf: [],
        collapsedDownstreamOf: [],
      }));
    }

    if (collapsedIntervalCount > 0) {
      setIntervalCollapseState((current) => expandAllTaskDagIntervals(current));
    }

    setPendingIntervalStartId(null);
    setContextMenu(null);
    setPaneContextMenu(null);
  }, [
    collapsedDownstreamAnchorCount,
    collapsedIntervalCount,
    collapsedUpstreamAnchorCount,
  ]);

  const handleCreateIntervalCollapse = useCallback(
    (leftId: string, rightId: string) => {
      const resolved = resolveTaskDagIntervalDefinition(graph, leftId, rightId);
      if (!resolved.ok) {
        toast({
          title: "区间收缩不可用",
          description: resolved.message,
          variant: "destructive",
        });
        return;
      }

      const overlapValidation = validateTaskDagIntervalAgainstExisting(
        resolved,
        resolvedExistingIntervals,
      );
      if (!overlapValidation.ok) {
        toast({
          title: "区间收缩不可用",
          description: overlapValidation.message,
          variant: "destructive",
        });
        return;
      }

      handleSetIntervalCollapsed(resolved.startId, resolved.endId, true);
      setPendingIntervalStartId(null);
      setSelectedTaskId(resolved.endId);
    },
    [graph, handleSetIntervalCollapsed, resolvedExistingIntervals],
  );

  const resolveContextMenuState = useCallback(
    (nodeId: string) => {
      const upstream = resolveCollapseActionState("upstream", nodeId);
      const downstream = resolveCollapseActionState("downstream", nodeId);
      const intervalDefinitions =
        intervalCollapseProjection.intervalsByTerminalId.get(nodeId) ?? [];
      const hasCollapsedIntervals = intervalDefinitions.some(
        (interval) => interval.collapsed,
      );
      const hasExpandedIntervals = intervalDefinitions.some(
        (interval) => !interval.collapsed,
      );
      return {
        showEndBlock: mode === "execute" && activeTaskIds.length > 0,
        interval: {
          canSetStart: mode === "browse" && pendingIntervalStartId !== nodeId,
          canClearStart: mode === "browse" && pendingIntervalStartId === nodeId,
          canCollapseToEnd:
            mode === "browse" &&
            pendingIntervalStartId !== null &&
            pendingIntervalStartId !== nodeId,
          hasCollapsedIntervals,
          hasExpandedIntervals,
        },
        focusSeries: {
          visible: mode === "browse",
          active:
            hasVisibleFocusedSeries && visibleFocusedSeriesNodeIds.has(nodeId),
        },
        upstream,
        downstream,
      };
    },
    [
      activeTaskIds.length,
      hasVisibleFocusedSeries,
      intervalCollapseProjection.intervalsByTerminalId,
      mode,
      pendingIntervalStartId,
      resolveCollapseActionState,
      visibleFocusedSeriesNodeIds,
    ],
  );

  const addFocusedSeriesAnchor = useCallback(
    (nodeId: string) => {
      const seriesNodeIds = findVisibleTaskGraphConnectedComponentNodeIds(
        terminalFilteredVisibleGraph,
        nodeId,
      );
      setFocusedSeriesAnchorIds((current) => {
        const next = current.filter((anchorId) => !seriesNodeIds.has(anchorId));
        next.push(nodeId);
        return next;
      });
    },
    [terminalFilteredVisibleGraph],
  );

  const removeFocusedSeriesAnchorsForNode = useCallback(
    (nodeId: string) => {
      const seriesNodeIds = findVisibleTaskGraphConnectedComponentNodeIds(
        terminalFilteredVisibleGraph,
        nodeId,
      );
      setFocusedSeriesAnchorIds((current) =>
        current.filter((anchorId) => !seriesNodeIds.has(anchorId)),
      );
    },
    [terminalFilteredVisibleGraph],
  );

  const contextMenuState = useMemo(
    () => (contextMenu ? resolveContextMenuState(contextMenu.nodeId) : null),
    [contextMenu, resolveContextMenuState],
  );

  const handleJumpToCurrentRoot = () => {
    const targetNodeIds =
      activeTaskIds.length > 0
        ? activeTaskIds.filter((nodeId) => visibleNodeIdSet.has(nodeId))
        : graph.nodes
            .filter(
              (node) =>
                node.isExecutable &&
                !node.isBlocked &&
                visibleNodeIdSet.has(node.id),
            )
            .map((node) => node.id);

    if (targetNodeIds.length === 0) {
      return;
    }

    setSelectedTaskId(targetNodeIds[0]);
    debugTaskDagExecute("viewport:fitView:focus-actionable", {
      activeTaskIds,
      targetNodeIds,
      viewportBefore: snapshotViewport(flowInstanceRef.current),
    });
    void flowInstanceRef.current?.fitView({
      nodes: targetNodeIds.map((id) => ({ id })),
      duration: 300,
      padding: 0.3,
    });
  };

  const selectedTaskTitle =
    mode === "browse" && selectedTaskId
      ? (taskById.get(selectedTaskId)?.title ?? selectedTaskId)
      : null;
  const selectedTask =
    mode === "browse" && selectedTaskId
      ? (taskById.get(selectedTaskId) ?? null)
      : null;
  const selectedGraphNode =
    mode === "browse" && selectedTaskId
      ? (graphNodeById.get(selectedTaskId) ?? null)
      : null;
  const selectedTaskExecutionHint =
    selectedTask && selectedGraphNode
      ? buildExecutionHint(
          selectedTask,
          selectedGraphNode.isBlocked,
          selectedGraphNode.isExecutable,
        )
      : "";
  const selectedTaskUpstreamDependencies = selectedTask
    ? buildUpstreamDependencies(selectedTask, taskById)
    : [];
  const selectedTaskDownstreamDependencies = selectedTask
    ? buildDownstreamDependencies(selectedTask.id, tasks)
    : [];
  const selectedTaskIntervalDetails = useMemo<
    TaskDagIntervalDetailItem[]
  >(() => {
    if (!selectedTaskId) {
      return [];
    }

    return (
      intervalCollapseProjection.intervalsByTerminalId.get(selectedTaskId) ?? []
    ).map((interval) => ({
      startId: interval.startId,
      startTitle: taskById.get(interval.startId)?.title ?? interval.startId,
      endId: interval.endId,
      endTitle: taskById.get(interval.endId)?.title ?? interval.endId,
      memberCount: interval.memberCount,
      collapsed: interval.collapsed,
      memberTitles: interval.nodeIds.map(
        (nodeId) => taskById.get(nodeId)?.title ?? nodeId,
      ),
    }));
  }, [
    intervalCollapseProjection.intervalsByTerminalId,
    selectedTaskId,
    taskById,
  ]);
  const disassociateTargetTask = disassociateTargetTaskId
    ? (taskById.get(disassociateTargetTaskId) ?? null)
    : null;

  const handleNavigateToTaskDetail = (taskId: string) => {
    void navigate({
      to: "/tasks/$taskId",
      params: { taskId },
      search: { from: "dag" } as never,
    });
  };

  const handleQuickCreateUpstream = (fromNodeId: string) => {
    const dependencyType =
      connectState?.sourceId === fromNodeId ? connectState.type : null;
    setQuickCreateDependency(
      dependencyType
        ? {
            sourceTaskId: fromNodeId,
            type: dependencyType,
            direction: "upstream",
          }
        : null,
    );
    setQuickCreateDirection(dependencyType ? null : "upstream");
    setQuickCreateFromNodeId(dependencyType ? null : fromNodeId);
    quickCreateDropPositionRef.current = null;
    setQuickCreateDropPosition(null);
    setConnectState(null);
    setQuickCreateOpen(true);
  };

  const handleQuickCreateDownstream = (fromNodeId: string) => {
    const dependencyType =
      connectState?.sourceId === fromNodeId ? connectState.type : null;
    setQuickCreateDependency(
      dependencyType
        ? {
            sourceTaskId: fromNodeId,
            type: dependencyType,
            direction: "downstream",
          }
        : null,
    );
    setQuickCreateDirection(dependencyType ? null : "downstream");
    setQuickCreateFromNodeId(dependencyType ? null : fromNodeId);
    quickCreateDropPositionRef.current = null;
    setQuickCreateDropPosition(null);
    setConnectState(null);
    setQuickCreateOpen(true);
  };

  const handleQuickCreateTask = async (title: string, description: string) => {
    try {
      const created = await getTaskService().createTask({
        title,
        description: description || undefined,
      });
      const createdTaskId = created?.id;
      const persistedDropPosition =
        quickCreateDropPositionRef.current ?? quickCreateDropPosition;

      if (quickCreateDirection && quickCreateFromNodeId) {
        if (quickCreateDirection === "downstream") {
          await getTaskService().addDependency(
            created.id,
            quickCreateFromNodeId,
            "hard",
          );
        } else {
          await getTaskService().addDependency(
            quickCreateFromNodeId,
            created.id,
            "hard",
          );
        }
        setPendingFocusTaskId(created.id);
        setQuickCreateDirection(null);
        setQuickCreateFromNodeId(null);
      }

      if (quickCreateDependency) {
        if (quickCreateDependency.direction === "downstream") {
          await getTaskService().addDependency(
            created.id,
            quickCreateDependency.sourceTaskId,
            quickCreateDependency.type,
          );
        } else {
          await getTaskService().addDependency(
            quickCreateDependency.sourceTaskId,
            created.id,
            quickCreateDependency.type,
          );
        }
        setPendingFocusTaskId(created.id);
        setConnectState(null);
        setQuickCreateDependency(null);
      }

      if (
        persistedDropPosition &&
        createdTaskId &&
        (layoutMode === "manual" || readStoredDagLayoutMode() === "manual")
      ) {
        pendingManualLayoutNodeIdsRef.current.add(createdTaskId);
        setManualLayoutSnapshot(
          updateTaskDagManualLayoutPosition(
            manualLayoutSnapshotRef.current,
            createdTaskId,
            persistedDropPosition,
          ),
        );
        setPendingFocusTaskId(createdTaskId);
      }

      setQuickCreateDirection(null);
      setQuickCreateFromNodeId(null);
      quickCreateDropPositionRef.current = null;
      setQuickCreateDropPosition(null);

      toast({
        title: "任务已创建",
        description: title,
      });
    } catch (error) {
      toast({
        title: "创建任务失败",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleDisassociateSubmit = async () => {
    if (!disassociateTargetTask) {
      return;
    }

    try {
      await getTaskTimerService().removeTaskFromBlock(
        disassociateTargetTask.id,
      );
      if (disassociateChoice !== "continue") {
        await getTaskService().transitionTask(
          disassociateTargetTask.id,
          disassociateChoice as TaskStatus,
        );
        await appendTaskStatusChangeDescription({
          taskId: disassociateTargetTask.id,
          taskTitle: disassociateTargetTask.title,
          fromStatus: disassociateTargetTask.status,
          toStatus: disassociateChoice as TaskStatus,
          description: disassociateDescription,
        });
      }
      setDisassociateDialogOpen(false);
      setDisassociateTargetTaskId(null);
      setDisassociateChoice("suspended");
      setDisassociateDescription("");
    } catch (error) {
      toast({
        title: "取消任务关联失败",
        description: formatExecuteActionError(error),
        variant: "destructive",
      });
    }
  };

  const applyDependencyMutation = async (
    sourceId: string,
    targetId: string,
    dependencyType: DagConnectType,
  ) => {
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }

    const targetTask = taskById.get(targetId);
    if (!targetTask) {
      return;
    }

    const existingDependency = targetTask.dependsOn.find(
      (dependency) => dependency.taskId === sourceId,
    );
    try {
      if (existingDependency?.type === dependencyType) {
        await getTaskService().removeDependency(targetId, sourceId);
        return;
      }

      await getTaskService().addDependency(targetId, sourceId, dependencyType);
    } catch (error) {
      toast({
        title: "依赖更新失败",
        description: formatDependencyMutationError(error),
        variant: "destructive",
      });
    }
  };

  const handleConnectNodeClick = (nodeId: string) => {
    setContextMenu(null);
    setSelectedTaskId(nodeId);

    if (!connectState) {
      setConnectState({ sourceId: nodeId, type: "hard" });
      return;
    }

    if (connectState.sourceId === nodeId) {
      setConnectState(
        connectState.type === "hard"
          ? { sourceId: nodeId, type: "soft" }
          : null,
      );
      return;
    }

    const pendingConnectState = connectState;
    setConnectState(null);
    void applyDependencyMutation(
      pendingConnectState.sourceId,
      nodeId,
      pendingConnectState.type,
    );
  };

  const handleOpenEndDialog = async (taskIds: string[] = activeTaskIds) => {
    const normalizedTaskIds = Array.from(
      new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)),
    );
    if (normalizedTaskIds.length === 0) return;

    try {
      const timeBlockService = getTimeBlockService();
      const block = await timeBlockService.loadActiveBlock();
      if (block && block.phase !== "feedback_in_progress") {
        await timeBlockService.markEnding();
      }
      setEndingTaskIds(normalizedTaskIds);
      setEndingDialogOpen(true);
    } catch (error) {
      toast({
        title: "无法结束时间块",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleExecuteNodeClick = async (nodeId: string) => {
    setContextMenu(null);
    setSelectedTaskId(nodeId);
    debugTaskDagExecute("handleExecuteNodeClick", {
      nodeId,
      activeTaskIds,
      activeBlockStartId: activeBlock?.startId ?? null,
      activeBlockPhase: activeBlock?.phase ?? null,
      taskIds: tasks.map((task) => task.id),
      visibleNodeIds: renderedVisibleGraph.nodes.map((node) => node.id),
    });

    const task = taskById.get(nodeId);
    const graphNode = graphNodeById.get(nodeId);
    if (!task || !graphNode) {
      return;
    }

    if (activeBlock?.phase === "feedback_in_progress") {
      setEndingTaskIds((current) =>
        current.length > 0 ? current : activeTaskIds,
      );
      setEndingDialogOpen(true);
      return;
    }

    if (isTerminalStatus(task.status)) {
      return;
    }

    if (graphNode.isBlocked && !activeTaskIdSet.has(nodeId)) {
      return;
    }

    try {
      const taskTimerService = getTaskTimerService();

      if (activeTaskIdSet.has(nodeId)) {
        if (activeTaskIds.length <= 1) {
          await handleOpenEndDialog(activeTaskIds);
          return;
        }

        setDisassociateTargetTaskId(nodeId);
        setDisassociateChoice("suspended");
        setDisassociateDialogOpen(true);
        return;
      }

      if (activeBlock) {
        await taskTimerService.addTaskToBlock(nodeId);
        return;
      }

      const spentMinutes = task.estimatedMinutes
        ? await taskTimerService.calculateSpentMinutes(nodeId)
        : 0;
      await taskTimerService.startBlockForTask(
        nodeId,
        buildExecuteTimerConfig(task, spentMinutes),
      );
    } catch (error) {
      toast({
        title: "执行模式操作失败",
        description: formatExecuteActionError(error),
        variant: "destructive",
      });
    }
  };

  const handleNodeClick = (_event: unknown, node: { id: string }) => {
    const suppressed = suppressNodeClickRef.current;
    if (suppressed) {
      if (suppressed.until <= Date.now()) {
        suppressNodeClickRef.current = null;
      } else if (suppressed.nodeId === node.id) {
        warnTaskDagInteraction("manual-layout:click-suppressed", {
          nodeId: node.id,
        });
        suppressNodeClickRef.current = null;
        return;
      }
    }

    if (mode === "browse") {
      setSelectedTaskId(node.id);
      setContextMenu(null);
      return;
    }

    if (mode === "connect") {
      handleConnectNodeClick(node.id);
      return;
    }

    void handleExecuteNodeClick(node.id);
  };

  useTaskDagKeyboard({
    mode,
    immersive,
    selectedTaskId,
    focusedSeriesAnchorTaskId: focusedSeriesAnchorIds[0] ?? null,
    connectState,
    flowNodes: flowGraph.nodes,
    flowInstance: flowInstanceRef.current,
    panSpeed,
    zoomSpeed,
    onModeChange: setMode,
    onImmersiveChange: setImmersive,
    onSelectedTaskIdChange: setSelectedTaskId,
    onClearFocusedSeries: () => {
      setFocusedSeriesAnchorIds([]);
      setContextMenu(null);
      setPaneContextMenu(null);
    },
    onBrowseActivate: (nodeId) => {
      setSelectedTaskId(nodeId);
      setContextMenu(null);
      setPaneContextMenu(null);
    },
    onConnectStateChange: setConnectState,
    onConnectExecute: (sourceId, targetId, type) => {
      void applyDependencyMutation(sourceId, targetId, type);
    },
    onQuickCreateUpstream: handleQuickCreateUpstream,
    onQuickCreateDownstream: handleQuickCreateDownstream,
    onToggleCollapse: toggleCollapse,
    canToggleCollapse: (direction, nodeId) =>
      resolveCollapseActionState(direction, nodeId).visible,
  });

  const endingDialogTaskIds =
    endingTaskIds.length > 0 ? endingTaskIds : activeTaskIds;
  const endingDialogTasks = endingDialogTaskIds
    .map((taskId) => taskById.get(taskId))
    .filter((task): task is TaskNode => Boolean(task));
  const subtitle = useMemo(() => {
    if (mode === "connect") {
      if (connectState) {
        const sourceTitle =
          taskById.get(connectState.sourceId)?.title ?? connectState.sourceId;
        return `编辑模式：已选“${sourceTitle}”作为${connectState.type === "hard" ? "硬依赖" : "软依赖"}起点，再点目标节点即可。`;
      }
      return "编辑模式：拖拽节点两端句柄，或依次点击两个节点建立依赖；再次点击同一节点可切换硬/软依赖。";
    }

    if (mode === "execute") {
      if (activeTaskIds.length > 0) {
        return `执行模式：当前时间块关联 ${activeTaskIds.length} 个任务。单击节点可追加或移除关联，右键可结束时间块。`;
      }
      return "执行模式：单击可执行节点即可开始时间块，双击仍可进入任务详情页。";
    }

    if (selectedTaskTitle) {
      return `当前聚焦：${selectedTaskTitle}。双击节点可进入任务详情页。`;
    }

    return "单击节点可查看详情，双击节点可进入任务详情页，右键节点可折叠上下游。";
  }, [activeTaskIds.length, connectState, mode, selectedTaskTitle, taskById]);
  const hideControlPanel = mode === "browse" && selectedTaskId !== null;

  const handleEndDialogSubmit = async (payload: {
    feedback: string;
    outcomes: Record<string, TaskStatusChoice>;
  }) => {
    const taskIdsSnapshot = endingDialogTaskIds;
    const blockId = activeBlock?.startId;
    const taskStatusOutcomes = Object.entries(payload.outcomes).reduce<
      Record<string, string>
    >((next, [taskId, status]) => {
      if (status !== "continue") {
        next[taskId] = status;
      }
      return next;
    }, {});
    const taskTitles = taskIdsSnapshot.reduce<Record<string, string>>(
      (next, taskId) => {
        const title = taskById.get(taskId)?.title;
        if (title) {
          next[taskId] = title;
        }
        return next;
      },
      {},
    );

    try {
      await getTimeBlockService().endBlock(payload.feedback || undefined, {
        taskStatusOutcomes:
          Object.keys(taskStatusOutcomes).length > 0
            ? taskStatusOutcomes
            : undefined,
        taskTitles: Object.keys(taskTitles).length > 0 ? taskTitles : undefined,
      });

      if (blockId && taskIdsSnapshot.length > 0) {
        await getTaskTimerService().onBlockEndForTasks(
          taskIdsSnapshot,
          blockId,
        );
      }

      for (const [taskId, status] of Object.entries(taskStatusOutcomes)) {
        const task = taskById.get(taskId);
        if (task) {
          await appendTaskStatusChangeDescription({
            taskId,
            taskTitle: task.title,
            fromStatus: task.status,
            toStatus: status as TaskStatus,
            description: payload.feedback,
          });
        }
      }

      setEndingTaskIds([]);
      setEndingDialogOpen(false);
    } catch (error) {
      toast({
        title: "结束时间块失败",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
      throw error;
    }
  };

  return (
    <PageShell
      title="任务"
      subtitle={subtitle}
      headerBottom={<TaskDomainTabs active="dag" />}
      headerTestId="task-dag-page-header"
      headerClassName={immersive ? "hidden" : undefined}
      className="min-h-full"
      contentClassName="min-h-0 flex-1 overflow-hidden"
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="task-dag-page">
        <div
          data-testid="task-dag-canvas-shell"
          className="relative flex-1 min-h-0 overflow-hidden bg-[#FAF7F5] dark:bg-[#0C0A09]"
        >
          <TaskDagModeSelector
            mode={mode}
            enabledModes={["browse", "connect", "execute"]}
            onChange={setMode}
            immersive={immersive}
          />
          {hideControlPanel ? null : (
            <TaskDagControlPanel
              isDesktop={isDesktop}
              direction={dagDirection}
              layoutMode={layoutMode}
              searchValue={searchDraft}
              searchMatchCount={searchMatchCount}
              hasActiveUnifiedSearch={hasActiveUnifiedSearch}
              searchOptions={searchOptions}
              availableTags={availableTags}
              tagFilter={tagFilter}
              hiddenRunningNodeCount={hiddenRunningNodeCount}
              collapsedUpstreamAnchorCount={collapsedUpstreamAnchorCount}
              collapsedDownstreamAnchorCount={collapsedDownstreamAnchorCount}
              collapsedIntervalCount={collapsedIntervalCount}
              terminalFilterMode={terminalFilterMode}
              focusMode={focusMode}
              focusedSeriesCount={focusedSeriesAnchorIds.length}
              hiddenFocusedSeriesCount={
                focusedSeriesAnchorIds.length -
                visibleFocusedSeriesAnchorIds.length
              }
              backgroundMode={backgroundMode}
              nodeSizing={nodeSizing}
              hasActiveBlock={activeTaskIds.length > 0}
              immersive={immersive}
              controlsState={controlsState}
              onDirectionChange={setDagDirection}
              onLayoutModeChange={handleLayoutModeChange}
              onSyncManualLayout={handleSyncManualLayoutToAuto}
              onSearchValueChange={setSearchDraft}
              onSearchOptionToggle={(key) => {
                setSearchOptions((current) => ({
                  ...current,
                  [key]: !current[key],
                }));
              }}
              onTagToggle={(tag) => {
                setTagFilter((current) => {
                  const selectedTagSet = new Set(current.selectedTags);
                  if (selectedTagSet.has(tag)) {
                    selectedTagSet.delete(tag);
                  } else {
                    selectedTagSet.add(tag);
                  }
                  return {
                    ...current,
                    selectedTags: Array.from(selectedTagSet).sort(
                      (left, right) => left.localeCompare(right, "zh-CN"),
                    ),
                  };
                });
              }}
              onTagFilterModeChange={(matchMode) => {
                setTagFilter((current) => ({
                  ...current,
                  matchMode,
                }));
              }}
              onClearTagFilter={() => {
                setTagFilter({ selectedTags: [], matchMode: "and" });
              }}
              onCycleTerminalFilterMode={() => {
                setTerminalFilterMode((current) => {
                  if (current === "show") return "smart";
                  if (current === "smart") return "hide";
                  return "show";
                });
              }}
              onClearAllFoldedState={handleClearAllFoldedState}
              onCycleFocusMode={() => {
                setFocusMode((current) =>
                  current === "soft" ? "hard" : "soft",
                );
              }}
              onClearFocusedSeries={() => {
                setFocusedSeriesAnchorIds([]);
                setContextMenu(null);
                setPaneContextMenu(null);
              }}
              onBackgroundModeChange={setBackgroundMode}
              onNodeSizingChange={setNodeSizing}
              onToggleImmersive={() => setImmersive((value) => !value)}
              onFitView={() => {
                debugTaskDagExecute("viewport:fitView:manual", {
                  viewportBefore: snapshotViewport(flowInstanceRef.current),
                });
                void flowInstanceRef.current?.fitView(
                  TASK_DAG_FIT_VIEW_OPTIONS,
                );
              }}
              onJumpToCurrentRoot={handleJumpToCurrentRoot}
              onControlsStateChange={updateControlsState}
              onDebugInteraction={handleDebugControlInteraction}
            />
          )}

          <div
            data-testid="task-dag-wheel-listener"
            ref={wheelListenerRef}
            className="h-full w-full"
            onPointerDownCapture={(
              event: ReactPointerEvent<HTMLDivElement>,
            ) => {
              if (event.pointerType === "mouse") {
                return;
              }
              warnTaskDagInteraction("canvas:pointerdown-capture", {
                pointerType: event.pointerType,
                targetTestId: resolveDebugTargetTestId(event.target),
              });
            }}
            onWheelCapture={handleCanvasModeWheel}
            onDoubleClick={(event) => {
              if (
                mode !== "connect" ||
                !isPaneInteractionTarget(event.target)
              ) {
                return;
              }
              setContextMenu(null);
              setPaneContextMenu(null);
              setQuickCreateDependency(null);
              setQuickCreateDirection(null);
              setQuickCreateFromNodeId(null);
              setQuickCreateOpen(true);
            }}
            onContextMenu={(event) => {
              if (
                mode !== "connect" ||
                !isPaneInteractionTarget(event.target)
              ) {
                return;
              }
              event.preventDefault();
              setContextMenu(null);
              setPaneContextMenu({ x: event.clientX, y: event.clientY });
            }}
          >
            <ReactFlow<TaskDagFlowNode, TaskDagFlowEdge>
              nodes={flowGraph.nodes}
              edges={flowGraph.edges}
              nodeTypes={TASK_DAG_NODE_TYPES}
              edgeTypes={TASK_DAG_EDGE_TYPES}
              proOptions={{ hideAttribution: true }}
              minZoom={TASK_DAG_MIN_ZOOM}
              fitViewOptions={TASK_DAG_FIT_VIEW_OPTIONS}
              nodesDraggable={
                layoutMode === "manual" && !manualTouchNodeDragActive
              }
              nodesConnectable={mode === "connect"}
              elementsSelectable
              zoomOnDoubleClick={false}
              panOnDrag={manualTouchNodeDragActive ? false : true}
              onNodesChange={handleManualLayoutNodesChange}
              onInit={(instance) => {
                flowInstanceRef.current = instance;
                debugTaskDagExecute("viewport:onInit", {
                  viewport: snapshotViewport(instance),
                });
                if (
                  flowGraph.nodes.length > 0 &&
                  !hasAppliedInitialViewportRef.current
                ) {
                  hasAppliedInitialViewportRef.current = true;
                  const storedViewport = readStoredDagViewport(
                    dagDirection,
                    viewportSurface,
                  );
                  if (storedViewport) {
                    debugTaskDagExecute(
                      "viewport:setViewport:on-init-restore",
                      {
                        direction: dagDirection,
                        viewport: storedViewport,
                      },
                    );
                    instance.setViewport(storedViewport);
                  }
                }
              }}
              onMoveEnd={() => {
                const viewport = flowInstanceRef.current?.getViewport();
                if (viewport) {
                  const layoutSummary = summarizeFlowViewport(
                    flowInstanceRef.current,
                    flowGraph.nodes,
                  );
                  debugTaskDagExecute("viewport:onMoveEnd", {
                    direction: dagDirection,
                    viewport,
                    layoutSummary,
                  });
                  writeStoredDagViewport(
                    dagDirection,
                    viewport,
                    viewportSurface,
                  );
                }
              }}
              onPaneClick={(event) => {
                if (mode === "browse") {
                  setSelectedTaskId(null);
                }
                if (mode === "execute") {
                  setSelectedTaskId(null);
                }
                if (mode === "connect") {
                  if (connectState) {
                    setQuickCreateDirection(null);
                    setQuickCreateFromNodeId(null);
                    setQuickCreateDependency({
                      sourceTaskId: connectState.sourceId,
                      type: connectState.type,
                      direction: shouldCreateUpstreamFromPaneEvent(event)
                        ? "upstream"
                        : "downstream",
                    });
                    setQuickCreateOpen(true);
                  }
                }
                setContextMenu(null);
                setPaneContextMenu(null);
                setControlsState((current) => ({
                  ...current,
                  mobileViewOpen: false,
                  mobileToolsOpen: false,
                }));
              }}
              onNodeClick={handleNodeClick}
              onNodeDragStart={(event, node) => {
                warnTaskDagInteraction("manual-layout:drag-start", {
                  layoutMode,
                  nodeId: node.id,
                  eventType: event.type,
                  pointerType:
                    "pointerType" in event ? event.pointerType : null,
                });
              }}
              onNodeDragStop={(_event, node) => {
                if (layoutMode !== "manual") {
                  return;
                }
                warnTaskDagInteraction("manual-layout:drag-stop", {
                  nodeId: node.id,
                  position: node.position,
                });
                setManualLayoutSnapshot(
                  updateTaskDagManualLayoutPosition(
                    manualLayoutSnapshotRef.current,
                    node.id,
                    node.position,
                  ),
                );
              }}
              onNodeDoubleClick={(_event, node) => {
                setContextMenu(null);
                if (mode === "connect") {
                  return;
                }
                handleNavigateToTaskDetail(node.id);
              }}
              onConnectStart={(event, params) => {
                connectDragTypeRef.current = resolveConnectTypeFromEvent(event);
                const direction = resolveQuickCreateDirectionFromHandleType(
                  params.handleType,
                );
                connectDragQuickCreateRef.current =
                  params.nodeId && direction
                    ? {
                        sourceTaskId: params.nodeId,
                        type: connectDragTypeRef.current,
                        direction,
                      }
                    : null;
              }}
              onConnect={(connection) => {
                connectDragQuickCreateRef.current = null;
                setConnectState(null);
                void applyDependencyMutation(
                  connection.source?.trim() ?? "",
                  connection.target?.trim() ?? "",
                  connectDragTypeRef.current,
                );
              }}
              onConnectEnd={(event, connectionState) => {
                const blankDropQuickCreate = connectDragQuickCreateRef.current;
                connectDragQuickCreateRef.current = null;
                if (
                  mode !== "connect" ||
                  !blankDropQuickCreate ||
                  connectionState.toNode ||
                  connectionState.isValid ||
                  !isPaneInteractionTarget(
                    (event as { target?: EventTarget | null }).target ?? null,
                  )
                ) {
                  return;
                }

                const clientPosition =
                  extractClientPositionFromPointerEvent(event);
                const dropPosition = clientPosition
                  ? (flowInstanceRef.current?.screenToFlowPosition(
                      clientPosition,
                    ) ?? clientPosition)
                  : null;

                setConnectState(null);
                setPaneContextMenu(null);
                setQuickCreateDirection(null);
                setQuickCreateFromNodeId(null);
                setQuickCreateDependency(blankDropQuickCreate);
                quickCreateDropPositionRef.current = dropPosition;
                setQuickCreateDropPosition(dropPosition);
                setQuickCreateOpen(true);
              }}
              onNodeContextMenu={(event, node) => {
                event.preventDefault();
                setPaneContextMenu(null);
                if (mode === "browse") {
                  setContextMenu({
                    nodeId: node.id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                  return;
                }
                const menuState = resolveContextMenuState(node.id);
                if (
                  !menuState.showEndBlock &&
                  !menuState.focusSeries.visible &&
                  !menuState.upstream.visible &&
                  !menuState.downstream.visible
                ) {
                  setContextMenu(null);
                  return;
                }
                setContextMenu({
                  nodeId: node.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              {backgroundMode === "dots" ? (
                <Background
                  gap={20}
                  color={backgroundDotColor}
                  variant={BackgroundVariant.Dots}
                />
              ) : backgroundMode === "lines" ? (
                <Background
                  gap={20}
                  color={backgroundLineColor}
                  variant={BackgroundVariant.Lines}
                />
              ) : null}
              {immersive ? null : (
                <Controls className="!rounded-lg !border-[#E7E3E0] !bg-white/90 !shadow-sm dark:!border-[#3C3836] dark:!bg-[#1C1917]/90 [&>button]:!border-[#E7E3E0] [&>button]:!bg-transparent [&>button]:!fill-[#57534E] dark:[&>button]:!border-[#3C3836] dark:[&>button]:!fill-[#A8A29E] [&>button:hover]:!bg-[#F5F0ED] dark:[&>button:hover]:!bg-[#292524]" />
              )}
            </ReactFlow>
          </div>

          <TaskDagKeyHints
            isDesktop={isDesktop}
            mode={mode}
            hasSelectedNode={Boolean(selectedTaskId)}
            hasFocusedSeries={focusedSeriesAnchorIds.length > 0}
            hasConnectSource={Boolean(connectState)}
            immersive={immersive}
            mobileOpen={mobileHintsOpen}
            onMobileOpenChange={setMobileHintsOpen}
          />

          {contextMenu ? (
            <div
              data-testid="task-dag-context-menu"
              className="fixed z-50 rounded-lg border border-[#E7E5E4] bg-white py-1 shadow-lg dark:border-[#292524] dark:bg-[#1C1917]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              {contextMenuState?.interval.canSetStart ? (
                <button
                  type="button"
                  data-testid="task-dag-context-interval-start"
                  className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
                  onClick={() => {
                    setPendingIntervalStartId(contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                >
                  设为区间起点
                </button>
              ) : null}
              {contextMenuState?.interval.canClearStart ? (
                <button
                  type="button"
                  data-testid="task-dag-context-interval-clear-start"
                  className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
                  onClick={() => {
                    setPendingIntervalStartId(null);
                    setContextMenu(null);
                  }}
                >
                  取消区间起点
                </button>
              ) : null}
              {contextMenuState?.interval.canCollapseToEnd ? (
                <button
                  type="button"
                  data-testid="task-dag-context-interval-collapse"
                  className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
                  onClick={() => {
                    const startId = pendingIntervalStartId;
                    setContextMenu(null);
                    if (!startId) {
                      return;
                    }
                    handleCreateIntervalCollapse(startId, contextMenu.nodeId);
                  }}
                >
                  收缩到此终点
                </button>
              ) : null}
              {contextMenuState?.interval.hasCollapsedIntervals ? (
                <button
                  type="button"
                  data-testid="task-dag-context-interval-expand"
                  className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
                  onClick={() => {
                    handleToggleIntervalsForTerminal(contextMenu.nodeId, false);
                    setContextMenu(null);
                  }}
                >
                  展开区间
                </button>
              ) : null}
              {contextMenuState?.interval.hasExpandedIntervals ? (
                <button
                  type="button"
                  data-testid="task-dag-context-interval-collapse-existing"
                  className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
                  onClick={() => {
                    handleToggleIntervalsForTerminal(contextMenu.nodeId, true);
                    setContextMenu(null);
                  }}
                >
                  收起区间
                </button>
              ) : null}
              {contextMenuState?.showEndBlock ? (
                <button
                  type="button"
                  data-testid="task-dag-context-end-block"
                  className="block w-full px-4 py-1.5 text-left text-xs text-[#C75B3A] hover:bg-[#FFF7ED] dark:text-[#FDBA74] dark:hover:bg-[#292524]"
                  onClick={() => {
                    setContextMenu(null);
                    void handleOpenEndDialog(activeTaskIds);
                  }}
                >
                  结束时间块
                </button>
              ) : null}
              {contextMenuState?.focusSeries.visible ? (
                <button
                  type="button"
                  data-testid="task-dag-context-toggle-focus-series"
                  className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
                  onClick={() => {
                    if (contextMenuState.focusSeries.active) {
                      removeFocusedSeriesAnchorsForNode(contextMenu.nodeId);
                    } else {
                      addFocusedSeriesAnchor(contextMenu.nodeId);
                    }
                    setContextMenu(null);
                  }}
                >
                  {contextMenuState.focusSeries.active
                    ? "取消聚焦此系列"
                    : "聚焦此系列"}
                </button>
              ) : null}
              {contextMenuState?.upstream.visible ? (
                <button
                  type="button"
                  data-testid="task-dag-context-toggle-upstream"
                  className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
                  onClick={() => {
                    toggleCollapse("upstream", contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                >
                  {contextMenuState.upstream.collapsed
                    ? "展开上游"
                    : "折叠上游"}
                </button>
              ) : null}
              {contextMenuState?.downstream.visible ? (
                <button
                  type="button"
                  data-testid="task-dag-context-toggle-downstream"
                  className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
                  onClick={() => {
                    toggleCollapse("downstream", contextMenu.nodeId);
                    setContextMenu(null);
                  }}
                >
                  {contextMenuState.downstream.collapsed
                    ? "展开下游"
                    : "折叠下游"}
                </button>
              ) : null}
            </div>
          ) : null}

          {paneContextMenu && mode === "connect" ? (
            <div
              data-testid="task-dag-pane-context-menu"
              className="fixed z-50 rounded-lg border border-[#E7E5E4] bg-white py-1 shadow-lg dark:border-[#292524] dark:bg-[#1C1917]"
              style={{ left: paneContextMenu.x, top: paneContextMenu.y }}
            >
              <button
                type="button"
                data-testid="task-dag-pane-context-create"
                className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
                onClick={() => {
                  setPaneContextMenu(null);
                  setQuickCreateDependency(null);
                  setQuickCreateDirection(null);
                  setQuickCreateFromNodeId(null);
                  quickCreateDropPositionRef.current = null;
                  setQuickCreateDropPosition(null);
                  setQuickCreateOpen(true);
                }}
              >
                快速创建任务
              </button>
            </div>
          ) : null}

          {selectedTask && selectedGraphNode ? (
            <TaskDagDetailPanel
              task={selectedTask}
              executionHint={selectedTaskExecutionHint}
              upstreamDependencies={selectedTaskUpstreamDependencies}
              downstreamDependencies={selectedTaskDownstreamDependencies}
              intervalDetails={selectedTaskIntervalDetails}
              foldSummary={
                hasFoldSummary
                  ? {
                      collapsedUpstreamAnchorCount,
                      collapsedDownstreamAnchorCount,
                      collapsedIntervalCount,
                    }
                  : null
              }
              onToggleIntervalCollapse={handleSetIntervalCollapsed}
              onClearAllFoldedState={handleClearAllFoldedState}
              onClose={() => setSelectedTaskId(null)}
              onOpenDetail={() => handleNavigateToTaskDetail(selectedTask.id)}
            />
          ) : null}

          <MultiTaskEndDialog
            open={endingDialogOpen}
            tasks={endingDialogTasks}
            onOpenChange={setEndingDialogOpen}
            onSubmit={handleEndDialogSubmit}
          />
          <TaskQuickCreateDialog
            open={quickCreateOpen}
            onOpenChange={(open) => {
              setQuickCreateOpen(open);
              if (!open) {
                setQuickCreateDependency(null);
                setQuickCreateDirection(null);
                setQuickCreateFromNodeId(null);
              }
            }}
            onSubmit={handleQuickCreateTask}
          />
          <Dialog
            open={disassociateDialogOpen}
            onOpenChange={(open) => {
              setDisassociateDialogOpen(open);
              if (!open) {
                setDisassociateTargetTaskId(null);
                setDisassociateChoice("suspended");
                setDisassociateDescription("");
              }
            }}
          >
            <DialogContent
              data-testid="task-dag-disassociate-dialog"
              className="w-[calc(100vw-2rem)] max-w-md rounded-2xl"
            >
              <DialogHeader>
                <DialogTitle>
                  {disassociateTargetTask
                    ? `取消关联「${disassociateTargetTask.title}」`
                    : "取消关联任务"}
                </DialogTitle>
                <DialogDescription>
                  从当前时间块移除该任务时，可同步选择它的下一步状态。
                </DialogDescription>
              </DialogHeader>
              <TaskStatusSelector
                value={disassociateChoice}
                onChange={setDisassociateChoice}
                allowedChoices={TASK_STATUS_SELECTOR_END_OPTIONS}
                helperHint="取消关联后，请选择任务状态。"
                optionTestIdPrefix="task-dag-disassociate-status"
                data-testid="task-dag-disassociate-status-selector"
              />
              <textarea
                data-testid="task-dag-disassociate-description"
                value={disassociateDescription}
                onChange={(event) =>
                  setDisassociateDescription(event.target.value)
                }
                onKeyDown={(event) => {
                  handleFeedbackKeyDown(
                    event,
                    handleDisassociateSubmit,
                    setDisassociateDescription,
                  );
                }}
                placeholder="补充状态变化说明（可选）..."
                className="min-h-[88px] resize-none rounded-xl border border-[#E7E5E4] bg-transparent px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#C75B3A] dark:border-[#292524] dark:text-[#FAFAF9]"
              />
              <DialogFooter>
                <button
                  type="button"
                  data-testid="task-dag-disassociate-cancel"
                  onClick={() => {
                    setDisassociateDialogOpen(false);
                    setDisassociateTargetTaskId(null);
                    setDisassociateChoice("suspended");
                    setDisassociateDescription("");
                  }}
                  className="rounded-full px-4 py-2 text-sm font-medium text-[#78716C] transition-colors hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]"
                >
                  关闭
                </button>
                <button
                  type="button"
                  data-testid="task-dag-disassociate-submit"
                  onClick={() => {
                    void handleDisassociateSubmit();
                  }}
                  className="inline-flex items-center justify-center rounded-full bg-[#C75B3A] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  确认取消关联
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </PageShell>
  );
}
