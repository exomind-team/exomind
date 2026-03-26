import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { TaskEdgeStatus } from '../goal-types';
import { useLongPress } from '../hooks/useLongPress';

export interface TaskFlowEdgeData extends Record<string, unknown> {
  label: string;
  status: TaskEdgeStatus;
  highlighted?: boolean;
  parallelIndex?: number;
  parallelTotal?: number;
  onOpenContextMenu?: (edgeId: string, x: number, y: number) => void;
}

const PARALLEL_EDGE_SPACING = 20;

function getParallelOffset(parallelIndex: number, parallelTotal: number) {
  if (parallelTotal <= 1) return 0;
  return (parallelIndex - (parallelTotal - 1) / 2) * PARALLEL_EDGE_SPACING;
}

function getEdgeColor(status: TaskEdgeStatus, highlighted: boolean) {
  if (highlighted) return '#C75B3A';
  if (status === 'completed') return '#10b981';
  if (status === 'in_progress') return '#f59e0b';
  if (status === 'suspended') return '#64748b';
  if (status === 'cancelled') return 'rgba(120,113,108,0.45)';
  return 'rgba(120,113,108,0.7)';
}

function getEdgeStyle(status: TaskEdgeStatus, selected: boolean, highlighted: boolean) {
  if (highlighted) {
    return {
      stroke: getEdgeColor(status, highlighted),
      strokeDasharray: '6 4',
      strokeWidth: selected ? 3.2 : 2.8,
      filter: 'drop-shadow(0 0 6px rgba(199,91,58,0.45))',
    };
  }
  if (status === 'completed') {
    return { stroke: getEdgeColor(status, highlighted), strokeWidth: selected ? 2.8 : 2.2 };
  }
  if (status === 'in_progress') {
    return { stroke: getEdgeColor(status, highlighted), strokeWidth: selected ? 2.8 : 2.2 };
  }
  if (status === 'suspended') {
    return { stroke: getEdgeColor(status, highlighted), strokeDasharray: '6 4', strokeWidth: selected ? 2.6 : 2 };
  }
  if (status === 'cancelled') {
    return { stroke: getEdgeColor(status, highlighted), strokeDasharray: '8 4', strokeWidth: selected ? 2.4 : 1.8 };
  }
  return { stroke: getEdgeColor(status, highlighted), strokeDasharray: '6 4', strokeWidth: selected ? 2.4 : 1.8 };
}

export function buildTaskEdgePath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  parallelIndex = 0,
  parallelTotal = 1,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition?: string;
  targetX: number;
  targetY: number;
  targetPosition?: string;
  parallelIndex?: number;
  parallelTotal?: number;
}) {
  if (parallelTotal <= 1) {
    return {
      path: `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`,
      labelX: (sourceX + targetX) / 2,
      labelY: (sourceY + targetY) / 2,
    };
  }

  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const offset = getParallelOffset(parallelIndex, parallelTotal);
  const controlDistance = Math.min(Math.max(distance * 0.35, 42), 132);
  const sourceVector = getHandleVector(sourcePosition, dx, dy, 'source');
  const targetVector = getHandleVector(targetPosition, dx, dy, 'target');
  const control1X = sourceX + sourceVector.x * controlDistance + normalX * offset;
  const control1Y = sourceY + sourceVector.y * controlDistance + normalY * offset;
  const control2X = targetX + targetVector.x * controlDistance + normalX * offset;
  const control2Y = targetY + targetVector.y * controlDistance + normalY * offset;
  const labelPoint = getCubicPointAt(0.5, sourceX, sourceY, control1X, control1Y, control2X, control2Y, targetX, targetY);

  return {
    path: `M ${sourceX} ${sourceY} C ${control1X} ${control1Y} ${control2X} ${control2Y} ${targetX} ${targetY}`,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
  };
}

function getHandleVector(position: string | undefined, dx: number, dy: number, role: 'source' | 'target') {
  switch (position) {
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    default: {
      const distance = Math.hypot(dx, dy) || 1;
      const directionX = dx / distance;
      const directionY = dy / distance;
      return role === 'source'
        ? { x: directionX, y: directionY }
        : { x: -directionX, y: -directionY };
    }
  }
}

function getCubicPointAt(
  t: number,
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
) {
  const inverse = 1 - t;
  const x = inverse ** 3 * p0x
    + 3 * inverse ** 2 * t * p1x
    + 3 * inverse * t ** 2 * p2x
    + t ** 3 * p3x;
  const y = inverse ** 3 * p0y
    + 3 * inverse ** 2 * t * p1y
    + 3 * inverse * t ** 2 * p2y
    + t ** 3 * p3y;
  return { x, y };
}

export function TaskFlowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
  selected,
}: EdgeProps<Edge<TaskFlowEdgeData>>) {
  const { path, labelX, labelY } = buildTaskEdgePath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    parallelIndex: data?.parallelIndex ?? 0,
    parallelTotal: data?.parallelTotal ?? 1,
  });
  const label = data?.label || '';
  const status = data?.status ?? 'pending';
  const highlighted = Boolean(data?.highlighted);
  const style = getEdgeStyle(status, Boolean(selected), highlighted);
  const markerId = `goal-task-arrow-${id}`;
  const markerColor = getEdgeColor(status, highlighted);
  const longPressHandlers = useLongPress((event) => {
    data?.onOpenContextMenu?.(id, event.clientX, event.clientY);
  });

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={markerColor} />
        </marker>
      </defs>
      <BaseEdge id={id} path={path} style={style} markerEnd={`url(#${markerId})`} />
      <path
        data-testid="task-flow-edge-hit-area"
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        strokeLinecap="round"
        style={{ pointerEvents: 'stroke' }}
        onContextMenu={(event) => {
          event.preventDefault();
          data?.onOpenContextMenu?.(id, event.clientX, event.clientY);
        }}
        {...longPressHandlers}
      />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'absolute rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-stone-600 shadow-sm dark:bg-stone-900/90 dark:text-stone-300',
              highlighted && 'bg-[#FFF7ED] text-[#C75B3A] ring-1 ring-[#F5C7B8]',
              status === 'cancelled' && 'line-through opacity-60',
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
