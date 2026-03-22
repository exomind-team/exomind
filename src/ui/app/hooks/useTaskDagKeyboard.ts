import { useCallback, useEffect, useRef } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import type { TaskDagMode } from '@/ui/app/components/TaskDagModeSelector';
import type { TaskDagFlowEdge, TaskDagFlowNode } from '@/ui/app/pages/task-dag-flow';

const MODE_ORDER: TaskDagMode[] = ['browse', 'connect', 'execute'];

type Direction = 'up' | 'down' | 'left' | 'right';

const DIRECTION_ANGLES: Record<Direction, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

const WASD_DIRECTION: Record<string, Direction> = {
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
};

const ARROW_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const TASK_DAG_MIN_ZOOM = 0.01;
const TASK_DAG_MAX_ZOOM = 2.5;
export interface TaskDagKeyboardOptions {
  mode: TaskDagMode;
  immersive: boolean;
  selectedTaskId: string | null;
  connectState: { sourceId: string; type: 'hard' | 'soft' } | null;
  flowNodes: TaskDagFlowNode[];
  flowInstance: ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null;
  panSpeed: number;
  zoomSpeed: number;
  onModeChange: (mode: TaskDagMode) => void;
  onImmersiveChange: (immersive: boolean) => void;
  onSelectedTaskIdChange: (taskId: string | null) => void;
  onBrowseActivate?: (nodeId: string) => void;
  onConnectStateChange: (state: { sourceId: string; type: 'hard' | 'soft' } | null) => void;
  onConnectExecute: (sourceId: string, targetId: string, type: 'hard' | 'soft') => void;
  onQuickCreateUpstream: (fromNodeId: string) => void;
  onQuickCreateDownstream: (fromNodeId: string) => void;
  onToggleCollapse: (direction: 'upstream' | 'downstream', nodeId: string) => void;
  canToggleCollapse: (direction: 'upstream' | 'downstream', nodeId: string) => boolean;
}

function isInputFocused(): boolean {
  const activeElement = document.activeElement;
  if (!activeElement) {
    return false;
  }

  const element = activeElement as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || element.isContentEditable
  );
}

function normalizeContinuousKey(key: string): string {
  if (key === 'Shift') {
    return 'Shift';
  }

  if (key.length === 1) {
    const lowered = key.toLowerCase();
    if (lowered === 'w' || lowered === 'a' || lowered === 's' || lowered === 'd' || lowered === 'z') {
      return lowered;
    }
  }

  return key;
}

export function findNearestNodeInDirection(
  currentNodeId: string,
  direction: Direction,
  nodes: TaskDagFlowNode[],
): string | null {
  const current = nodes.find((node) => node.id === currentNodeId);
  if (!current) {
    return null;
  }

  const currentWidth = current.measured?.width ?? 256;
  const currentHeight = current.measured?.height ?? 140;
  const cx = current.position.x + currentWidth / 2;
  const cy = current.position.y + currentHeight / 2;
  const targetAngle = DIRECTION_ANGLES[direction];
  const halfCone = Math.PI / 4;

  let bestId: string | null = null;
  let bestDistance = Infinity;

  for (const node of nodes) {
    if (node.id === currentNodeId) {
      continue;
    }

    const nodeWidth = node.measured?.width ?? 256;
    const nodeHeight = node.measured?.height ?? 140;
    const nx = node.position.x + nodeWidth / 2;
    const ny = node.position.y + nodeHeight / 2;
    const dx = nx - cx;
    const dy = ny - cy;
    const angle = Math.atan2(dy, dx);

    let diff = angle - targetAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    if (Math.abs(diff) > halfCone) {
      continue;
    }

    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = node.id;
    }
  }

  return bestId;
}

function getCanvasShell(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="task-dag-canvas-shell"]');
}

function getNodeScreenCenter(
  node: TaskDagFlowNode,
  viewport: { x: number; y: number; zoom: number },
): { x: number; y: number } {
  const nodeWidth = node.measured?.width ?? 256;
  const nodeHeight = node.measured?.height ?? 140;
  return {
    x: node.position.x * viewport.zoom + viewport.x + (nodeWidth * viewport.zoom) / 2,
    y: node.position.y * viewport.zoom + viewport.y + (nodeHeight * viewport.zoom) / 2,
  };
}

export function findNearestNodeToViewportCenter(
  flowInstance: ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null,
  nodes: TaskDagFlowNode[],
): string | null {
  if (!flowInstance || nodes.length === 0) {
    return null;
  }

  const container = getCanvasShell();
  if (!container) {
    return null;
  }

  const viewport = flowInstance.getViewport();
  const viewportCenter = {
    x: container.clientWidth / 2,
    y: container.clientHeight / 2,
  };

  let bestId: string | null = null;
  let bestDistance = Infinity;

  for (const node of nodes) {
    const center = getNodeScreenCenter(node, viewport);
    const dx = center.x - viewportCenter.x;
    const dy = center.y - viewportCenter.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = node.id;
    }
  }

  return bestId;
}

export function ensureNodeVisible(
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

  const viewport = flowInstance.getViewport();
  const zoom = viewport.zoom;
  const nodeWidth = node.measured?.width ?? 256;
  const nodeHeight = node.measured?.height ?? 140;
  const screenX = node.position.x * zoom + viewport.x;
  const screenY = node.position.y * zoom + viewport.y;
  const screenWidth = nodeWidth * zoom;
  const screenHeight = nodeHeight * zoom;
  const container = getCanvasShell();
  if (!container) {
    return;
  }

  const margin = 40;
  let dx = 0;
  let dy = 0;

  if (screenX < margin) {
    dx = margin - screenX;
  } else if (screenX + screenWidth > container.clientWidth - margin) {
    dx = (container.clientWidth - margin) - (screenX + screenWidth);
  }

  if (screenY < margin) {
    dy = margin - screenY;
  } else if (screenY + screenHeight > container.clientHeight - margin) {
    dy = (container.clientHeight - margin) - (screenY + screenHeight);
  }

  if (dx !== 0 || dy !== 0) {
    flowInstance.setViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom }, { duration: 150 });
  }
}

export function useTaskDagKeyboard(options: TaskDagKeyboardOptions): void {
  const {
    mode,
    immersive,
    selectedTaskId,
    connectState,
    flowNodes,
    flowInstance,
    panSpeed,
    zoomSpeed,
    onModeChange,
    onImmersiveChange,
    onSelectedTaskIdChange,
    onBrowseActivate,
    onConnectStateChange,
    onConnectExecute,
    onQuickCreateUpstream,
    onQuickCreateDownstream,
    onToggleCollapse,
    canToggleCollapse,
  } = options;

  const pressedKeysRef = useRef<Set<string>>(new Set());
  const frameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  const resolveFocusNodeId = useCallback(() => {
    if (mode === 'connect' && connectState) {
      return selectedTaskId ?? connectState.sourceId;
    }
    return selectedTaskId;
  }, [connectState, mode, selectedTaskId]);

  const stopContinuousLoop = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    lastFrameTimeRef.current = null;
  }, []);

  const applyPan = useCallback((direction: Direction, deltaMs: number) => {
    if (!flowInstance) {
      return;
    }

    const viewport = flowInstance.getViewport();
    const step = panSpeed * (deltaMs / 1000);
    const panMap: Record<Direction, { x: number; y: number }> = {
      up: { x: 0, y: step },
      down: { x: 0, y: -step },
      left: { x: step, y: 0 },
      right: { x: -step, y: 0 },
    };
    const pan = panMap[direction];
    flowInstance.setViewport({
      x: viewport.x + pan.x,
      y: viewport.y + pan.y,
      zoom: viewport.zoom,
    });
  }, [flowInstance, panSpeed]);

  const applyZoom = useCallback((zoomOut: boolean, deltaMs: number) => {
    if (!flowInstance) {
      return;
    }

    const viewport = flowInstance.getViewport();
    const zoomDelta = (zoomSpeed / 100) * (deltaMs / 1000);
    const nextZoom = zoomOut
      ? viewport.zoom - zoomDelta
      : viewport.zoom + zoomDelta;
    const normalizedZoom = Math.min(TASK_DAG_MAX_ZOOM, Math.max(TASK_DAG_MIN_ZOOM, nextZoom));
    const container = getCanvasShell();
    if (!container) {
      flowInstance.setViewport({
        x: viewport.x,
        y: viewport.y,
        zoom: normalizedZoom,
      });
      return;
    }

    const centerX = container.clientWidth / 2;
    const centerY = container.clientHeight / 2;
    const worldCenterX = (centerX - viewport.x) / viewport.zoom;
    const worldCenterY = (centerY - viewport.y) / viewport.zoom;
    flowInstance.setViewport({
      x: centerX - worldCenterX * normalizedZoom,
      y: centerY - worldCenterY * normalizedZoom,
      zoom: normalizedZoom,
    });
  }, [flowInstance, zoomSpeed]);

  const applyContinuousAction = useCallback((key: string, deltaMs: number) => {
    const normalizedKey = normalizeContinuousKey(key);
    const wasdDirection = WASD_DIRECTION[normalizedKey];
    const arrowDirection = ARROW_DIRECTION[normalizedKey];
    if (wasdDirection) {
      applyPan(wasdDirection, deltaMs);
      return;
    }
    if (arrowDirection) {
      applyPan(arrowDirection, deltaMs);
      return;
    }

    if (normalizedKey === 'z') {
      applyZoom(pressedKeysRef.current.has('Shift'), deltaMs);
    }
  }, [applyPan, applyZoom]);

  const runContinuousLoop = useCallback((timestamp: number) => {
    if (pressedKeysRef.current.size === 0) {
      stopContinuousLoop();
      return;
    }

    const lastFrameTime = lastFrameTimeRef.current ?? timestamp;
    const deltaMs = Math.max(16, Math.min(64, timestamp - lastFrameTime));
    lastFrameTimeRef.current = timestamp;

    for (const key of pressedKeysRef.current) {
      applyContinuousAction(key, deltaMs);
    }

    frameRef.current = window.requestAnimationFrame(runContinuousLoop);
  }, [applyContinuousAction, stopContinuousLoop]);

  const startContinuousAction = useCallback((key: string) => {
    const normalizedKey = normalizeContinuousKey(key);
    if (pressedKeysRef.current.has(normalizedKey)) {
      return;
    }

    pressedKeysRef.current.add(normalizedKey);
    applyContinuousAction(normalizedKey, 1000 / 60);
    if (frameRef.current === null) {
      lastFrameTimeRef.current = null;
      frameRef.current = window.requestAnimationFrame(runContinuousLoop);
    }
  }, [applyContinuousAction, runContinuousLoop]);

  const stopContinuousAction = useCallback((key: string) => {
    pressedKeysRef.current.delete(normalizeContinuousKey(key));
    if (pressedKeysRef.current.size === 0) {
      stopContinuousLoop();
    }
  }, [stopContinuousLoop]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (isInputFocused()) {
      return;
    }

    const key = event.key;
    const normalizedKey = normalizeContinuousKey(key);
    const focusNodeId = resolveFocusNodeId();

    if (normalizedKey === 'Shift') {
      pressedKeysRef.current.add('Shift');
      return;
    }

    if (key === 'Escape') {
      if (immersive) {
        onImmersiveChange(false);
        event.preventDefault();
        return;
      }
      if (mode === 'connect' && connectState) {
        onConnectStateChange(null);
        event.preventDefault();
        return;
      }
      if (selectedTaskId) {
        onSelectedTaskIdChange(null);
        event.preventDefault();
      }
      return;
    }

    if (key === 'E' || key === 'e') {
      if (!focusNodeId) {
        const nearestNodeId = findNearestNodeToViewportCenter(flowInstance, flowNodes);
        if (nearestNodeId) {
          onSelectedTaskIdChange(nearestNodeId);
          ensureNodeVisible(nearestNodeId, flowInstance, flowNodes);
          event.preventDefault();
        }
      }
      return;
    }

    if (event.ctrlKey && event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      const currentIndex = MODE_ORDER.indexOf(mode);
      const delta = key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (currentIndex + delta + MODE_ORDER.length) % MODE_ORDER.length;
      onModeChange(MODE_ORDER[nextIndex]);
      return;
    }

    if (event.altKey && (key === 'f' || key === 'F')) {
      const collapseTargetId = mode === 'connect' && connectState
        ? connectState.sourceId
        : focusNodeId;
      const direction = event.shiftKey ? 'upstream' : 'downstream';
      if (collapseTargetId && canToggleCollapse(direction, collapseTargetId)) {
        onToggleCollapse(direction, collapseTargetId);
        event.preventDefault();
      }
      return;
    }

    if ((key === 'Enter' || key === ' ') && mode === 'browse' && selectedTaskId) {
      event.preventDefault();
      onBrowseActivate?.(selectedTaskId);
      return;
    }

    if ((key === 'Enter' || key === ' ') && mode === 'connect') {
      event.preventDefault();

      if (!connectState && focusNodeId) {
        onConnectStateChange({ sourceId: focusNodeId, type: 'hard' });
        return;
      }

      if (connectState && focusNodeId === connectState.sourceId) {
        if (connectState.type === 'hard') {
          onConnectStateChange({ sourceId: connectState.sourceId, type: 'soft' });
        } else {
          onConnectStateChange(null);
        }
        return;
      }

      if (connectState && focusNodeId && focusNodeId !== connectState.sourceId) {
        onConnectExecute(connectState.sourceId, focusNodeId, connectState.type);
        onConnectStateChange(null);
      }
      return;
    }

    if (key === 'Tab' && mode === 'connect') {
      const quickCreateAnchorId = connectState?.sourceId ?? focusNodeId;
      if (!quickCreateAnchorId) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        onQuickCreateUpstream(quickCreateAnchorId);
      } else {
        onQuickCreateDownstream(quickCreateAnchorId);
      }
      return;
    }

    const wasdDirection = WASD_DIRECTION[normalizedKey];
    if (wasdDirection) {
      if (focusNodeId) {
        const nextId = findNearestNodeInDirection(focusNodeId, wasdDirection, flowNodes);
        if (nextId) {
          onSelectedTaskIdChange(nextId);
          ensureNodeVisible(nextId, flowInstance, flowNodes);
        }
        event.preventDefault();
        return;
      }

      startContinuousAction(normalizedKey);
      event.preventDefault();
      return;
    }

    if (ARROW_DIRECTION[normalizedKey]) {
      startContinuousAction(normalizedKey);
      event.preventDefault();
      return;
    }

    if (normalizedKey === 'z' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      startContinuousAction(normalizedKey);
      event.preventDefault();
    }
  }, [
    canToggleCollapse,
    connectState,
    flowInstance,
    flowNodes,
    immersive,
    mode,
    onConnectStateChange,
    onImmersiveChange,
    onModeChange,
    onQuickCreateDownstream,
    onQuickCreateUpstream,
    onBrowseActivate,
    onSelectedTaskIdChange,
    onConnectExecute,
    onToggleCollapse,
    resolveFocusNodeId,
    startContinuousAction,
  ]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    stopContinuousAction(event.key);
  }, [stopContinuousAction]);

  const handleWindowBlur = useCallback(() => {
    pressedKeysRef.current.clear();
    stopContinuousLoop();
  }, [stopContinuousLoop]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      pressedKeysRef.current.clear();
      stopContinuousLoop();
    };
  }, [handleKeyDown, handleKeyUp, handleWindowBlur, stopContinuousLoop]);
}
