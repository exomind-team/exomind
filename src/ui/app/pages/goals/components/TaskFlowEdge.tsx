import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { TaskEdgeStatus } from '../goal-types';
import { useLongPress } from '../hooks/useLongPress';

export interface TaskFlowEdgeData extends Record<string, unknown> {
  label: string;
  status: TaskEdgeStatus;
  isEmptySlot?: boolean;
  isZombie?: boolean;
  highlighted?: boolean;
  sourceCenterX?: number;
  sourceCenterY?: number;
  sourceRadius?: number;
  targetCenterX?: number;
  targetCenterY?: number;
  targetRadius?: number;
  parallelIndex?: number;
  parallelTotal?: number;
  onOpenContextMenu?: (edgeId: string, x: number, y: number) => void;
}

const PARALLEL_EDGE_SPACING = 20;

function getParallelOffset(parallelIndex: number, parallelTotal: number) {
  if (parallelTotal <= 1) return 0;
  return (parallelIndex - (parallelTotal - 1) / 2) * PARALLEL_EDGE_SPACING;
}

function getEdgeColor(status: TaskEdgeStatus, highlighted: boolean, isZombie: boolean) {
  if (highlighted) return '#C75B3A';
  if (isZombie) return 'rgba(148,163,184,0.52)';
  if (status === 'completed') return '#10b981';
  if (status === 'in_progress') return '#f59e0b';
  if (status === 'suspended') return '#64748b';
  if (status === 'cancelled') return 'rgba(120,113,108,0.45)';
  return 'rgba(120,113,108,0.7)';
}

function getEdgeStyle(status: TaskEdgeStatus, selected: boolean, highlighted: boolean, isEmptySlot: boolean, isZombie: boolean) {
  if (highlighted) {
    return {
      stroke: getEdgeColor(status, highlighted, isZombie),
      strokeDasharray: '6 4',
      strokeWidth: selected ? 3.2 : 2.8,
      filter: 'drop-shadow(0 0 6px rgba(199,91,58,0.45))',
    };
  }
  if (isZombie) {
    return {
      stroke: getEdgeColor(status, highlighted, isZombie),
      strokeDasharray: '2 6',
      strokeWidth: selected ? 1.9 : 1.6,
    };
  }
  if (status === 'completed') {
    return { stroke: getEdgeColor(status, highlighted, isZombie), strokeWidth: selected ? 2.8 : 2.2 };
  }
  if (status === 'in_progress') {
    return { stroke: getEdgeColor(status, highlighted, isZombie), strokeWidth: selected ? 2.8 : 2.2 };
  }
  if (status === 'suspended') {
    return { stroke: getEdgeColor(status, highlighted, isZombie), strokeDasharray: '6 4', strokeWidth: selected ? 2.6 : 2 };
  }
  if (status === 'cancelled') {
    return { stroke: getEdgeColor(status, highlighted, isZombie), strokeDasharray: '8 4', strokeWidth: selected ? 2.4 : 1.8 };
  }
  if (isEmptySlot) {
    return { stroke: getEdgeColor(status, highlighted, isZombie), strokeDasharray: '4 5', strokeWidth: selected ? 2.1 : 1.5 };
  }
  return { stroke: getEdgeColor(status, highlighted, isZombie), strokeDasharray: '6 4', strokeWidth: selected ? 2.4 : 1.8 };
}

export function buildTaskEdgePath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceCenterX,
  sourceCenterY,
  sourceRadius,
  targetCenterX,
  targetCenterY,
  targetRadius,
  parallelIndex = 0,
  parallelTotal = 1,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourceCenterX?: number;
  sourceCenterY?: number;
  sourceRadius?: number;
  targetCenterX?: number;
  targetCenterY?: number;
  targetRadius?: number;
  parallelIndex?: number;
  parallelTotal?: number;
}) {
  const anchors = (
    sourceCenterX !== undefined
    && sourceCenterY !== undefined
    && sourceRadius !== undefined
    && targetCenterX !== undefined
    && targetCenterY !== undefined
    && targetRadius !== undefined
  )
    ? resolveEdgeAnchors({
      sourceCenterX,
      sourceCenterY,
      sourceRadius,
      targetCenterX,
      targetCenterY,
      targetRadius,
    })
    : { sourceX, sourceY, targetX, targetY };

  const anchorSourceX = anchors.sourceX;
  const anchorSourceY = anchors.sourceY;
  const anchorTargetX = anchors.targetX;
  const anchorTargetY = anchors.targetY;

  if (parallelTotal <= 1) {
    return {
      path: `M ${anchorSourceX} ${anchorSourceY} L ${anchorTargetX} ${anchorTargetY}`,
      labelX: (anchorSourceX + anchorTargetX) / 2,
      labelY: (anchorSourceY + anchorTargetY) / 2,
    };
  }

  const dx = anchorTargetX - anchorSourceX;
  const dy = anchorTargetY - anchorSourceY;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const directionX = dx / distance;
  const directionY = dy / distance;
  const offset = getParallelOffset(parallelIndex, parallelTotal);
  const controlDistance = Math.min(Math.max(distance * 0.35, 42), 132);
  const control1X = anchorSourceX + directionX * controlDistance + normalX * offset;
  const control1Y = anchorSourceY + directionY * controlDistance + normalY * offset;
  const control2X = anchorTargetX - directionX * controlDistance + normalX * offset;
  const control2Y = anchorTargetY - directionY * controlDistance + normalY * offset;
  const labelPoint = getCubicPointAt(
    0.5,
    anchorSourceX,
    anchorSourceY,
    control1X,
    control1Y,
    control2X,
    control2Y,
    anchorTargetX,
    anchorTargetY,
  );

  return {
    path: `M ${anchorSourceX} ${anchorSourceY} C ${control1X} ${control1Y} ${control2X} ${control2Y} ${anchorTargetX} ${anchorTargetY}`,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
  };
}

export function resolveEdgeAnchors({
  sourceCenterX,
  sourceCenterY,
  sourceRadius,
  targetCenterX,
  targetCenterY,
  targetRadius,
}: {
  sourceCenterX: number;
  sourceCenterY: number;
  sourceRadius: number;
  targetCenterX: number;
  targetCenterY: number;
  targetRadius: number;
}) {
  const dx = targetCenterX - sourceCenterX;
  const dy = targetCenterY - sourceCenterY;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = dx / distance;
  const normalY = dy / distance;

  return {
    sourceX: sourceCenterX + normalX * sourceRadius,
    sourceY: sourceCenterY + normalY * sourceRadius,
    targetX: targetCenterX - normalX * targetRadius,
    targetY: targetCenterY - normalY * targetRadius,
  };
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
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps<Edge<TaskFlowEdgeData>>) {
  const { path, labelX, labelY } = buildTaskEdgePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourceCenterX: typeof data?.sourceCenterX === 'number' ? data.sourceCenterX : undefined,
    sourceCenterY: typeof data?.sourceCenterY === 'number' ? data.sourceCenterY : undefined,
    sourceRadius: typeof data?.sourceRadius === 'number' ? data.sourceRadius : undefined,
    targetCenterX: typeof data?.targetCenterX === 'number' ? data.targetCenterX : undefined,
    targetCenterY: typeof data?.targetCenterY === 'number' ? data.targetCenterY : undefined,
    targetRadius: typeof data?.targetRadius === 'number' ? data.targetRadius : undefined,
    parallelIndex: data?.parallelIndex ?? 0,
    parallelTotal: data?.parallelTotal ?? 1,
  });
  const label = data?.label || '';
  const status = data?.status ?? 'pending';
  const highlighted = Boolean(data?.highlighted);
  const isEmptySlot = Boolean(data?.isEmptySlot);
  const isZombie = Boolean(data?.isZombie);
  const hasPlaceholderLabel = isEmptySlot && label.trim() === '待定义';
  const style = getEdgeStyle(status, Boolean(selected), highlighted, isEmptySlot, isZombie);
  const markerId = `goal-task-arrow-${id}`;
  const markerColor = getEdgeColor(status, highlighted, isZombie);
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
      {status === 'cancelled' && !isZombie ? (
        <line
          data-testid={`task-flow-edge-cancel-strike-${id}`}
          x1={labelX - 12}
          y1={labelY + 9}
          x2={labelX + 12}
          y2={labelY - 9}
          stroke="rgba(225,29,72,0.65)"
          strokeWidth={1.8}
          strokeLinecap="round"
        />
      ) : null}
      <path
        data-testid={`task-flow-edge-hit-area-${id}`}
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
            data-testid={`task-flow-edge-label-${id}`}
            className={cn(
              'absolute rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-stone-600 shadow-sm dark:bg-stone-900/90 dark:text-stone-300',
              hasPlaceholderLabel && 'italic opacity-75',
              highlighted && 'bg-[#FFF7ED] text-[#C75B3A] ring-1 ring-[#F5C7B8]',
              status === 'cancelled' && 'line-through opacity-60',
              isZombie && 'opacity-60',
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
