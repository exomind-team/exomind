import { useCallback, useEffect } from 'react';
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
  W: 'up',
  a: 'left',
  A: 'left',
  s: 'down',
  S: 'down',
  d: 'right',
  D: 'right',
};

const ARROW_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export interface TaskDagKeyboardOptions {
  mode: TaskDagMode;
  immersive: boolean;
  selectedTaskId: string | null;
  connectState: { sourceId: string; type: 'hard' | 'soft' } | null;
  flowNodes: TaskDagFlowNode[];
  flowInstance: ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null;
  panSpeed: number;
  onModeChange: (mode: TaskDagMode) => void;
  onImmersiveChange: (immersive: boolean) => void;
  onSelectedTaskIdChange: (taskId: string | null) => void;
  onConnectStateChange: (state: { sourceId: string; type: 'hard' | 'soft' } | null) => void;
  onConnectExecute: (sourceId: string, targetId: string, type: 'hard' | 'soft') => void;
  onQuickCreateUpstream: (fromNodeId: string) => void;
  onQuickCreateDownstream: (fromNodeId: string) => void;
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
  const container = document.querySelector<HTMLElement>('[data-testid="task-dag-canvas-shell"]');
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
    onModeChange,
    onImmersiveChange,
    onSelectedTaskIdChange,
    onConnectStateChange,
    onConnectExecute,
    onQuickCreateUpstream,
    onQuickCreateDownstream,
  } = options;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (isInputFocused()) {
      return;
    }

    const key = event.key;

    if (key === 'Escape') {
      if (immersive) {
        onImmersiveChange(false);
        event.preventDefault();
        return;
      }
      if (mode === 'connect' && connectState) {
        onConnectStateChange(null);
        event.preventDefault();
      }
      return;
    }

    if (event.ctrlKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      const currentIndex = MODE_ORDER.indexOf(mode);
      const delta = key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (currentIndex + delta + MODE_ORDER.length) % MODE_ORDER.length;
      onModeChange(MODE_ORDER[nextIndex]);
      return;
    }

    if ((key === 'Enter' || key === ' ') && mode === 'connect') {
      event.preventDefault();

      if (!connectState && selectedTaskId) {
        onConnectStateChange({ sourceId: selectedTaskId, type: 'hard' });
        return;
      }

      if (connectState && selectedTaskId === connectState.sourceId) {
        if (connectState.type === 'hard') {
          onConnectStateChange({ sourceId: connectState.sourceId, type: 'soft' });
        } else {
          onConnectStateChange(null);
        }
        return;
      }

      if (connectState && selectedTaskId && selectedTaskId !== connectState.sourceId) {
        onConnectExecute(connectState.sourceId, selectedTaskId, connectState.type);
        onConnectStateChange(null);
      }
      return;
    }

    if (key === 'Tab' && mode === 'connect' && selectedTaskId) {
      event.preventDefault();
      if (event.shiftKey) {
        onQuickCreateUpstream(selectedTaskId);
      } else {
        onQuickCreateDownstream(selectedTaskId);
      }
      return;
    }

    const wasdDirection = WASD_DIRECTION[key];
    if (wasdDirection) {
      const focusNodeId = mode === 'connect' && connectState
        ? selectedTaskId ?? connectState.sourceId
        : selectedTaskId;
      if (focusNodeId) {
        const nextId = findNearestNodeInDirection(focusNodeId, wasdDirection, flowNodes);
        if (nextId) {
          onSelectedTaskIdChange(nextId);
          ensureNodeVisible(nextId, flowInstance, flowNodes);
        }
        event.preventDefault();
        return;
      }

      if (flowInstance) {
        const viewport = flowInstance.getViewport();
        const panMap: Record<Direction, { x: number; y: number }> = {
          up: { x: 0, y: panSpeed },
          down: { x: 0, y: -panSpeed },
          left: { x: panSpeed, y: 0 },
          right: { x: -panSpeed, y: 0 },
        };
        const pan = panMap[wasdDirection];
        flowInstance.setViewport({
          x: viewport.x + pan.x,
          y: viewport.y + pan.y,
          zoom: viewport.zoom,
        });
        event.preventDefault();
      }
      return;
    }

    const arrowDirection = ARROW_DIRECTION[key];
    if (arrowDirection && flowInstance) {
      const viewport = flowInstance.getViewport();
      const panMap: Record<Direction, { x: number; y: number }> = {
        up: { x: 0, y: panSpeed },
        down: { x: 0, y: -panSpeed },
        left: { x: panSpeed, y: 0 },
        right: { x: -panSpeed, y: 0 },
      };
      const pan = panMap[arrowDirection];
      flowInstance.setViewport({
        x: viewport.x + pan.x,
        y: viewport.y + pan.y,
        zoom: viewport.zoom,
      });
      event.preventDefault();
    }
  }, [
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
    onSelectedTaskIdChange,
    panSpeed,
    selectedTaskId,
    onConnectExecute,
  ]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
