import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps, getBezierPath } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { TaskEdgeStatus } from '../goal-types';

export interface TaskFlowEdgeData extends Record<string, unknown> {
  label: string;
  status: TaskEdgeStatus;
  highlighted?: boolean;
}

function getEdgeStyle(status: TaskEdgeStatus, selected: boolean, highlighted: boolean) {
  if (highlighted) {
    return {
      stroke: '#C75B3A',
      strokeDasharray: '6 4',
      strokeWidth: selected ? 3.2 : 2.8,
      filter: 'drop-shadow(0 0 6px rgba(199,91,58,0.45))',
    };
  }
  if (status === 'completed') {
    return { stroke: '#10b981', strokeWidth: selected ? 2.8 : 2.2 };
  }
  if (status === 'in_progress') {
    return { stroke: '#f59e0b', strokeWidth: selected ? 2.8 : 2.2 };
  }
  if (status === 'suspended') {
    return { stroke: '#64748b', strokeDasharray: '6 4', strokeWidth: selected ? 2.6 : 2 };
  }
  if (status === 'cancelled') {
    return { stroke: 'rgba(120,113,108,0.45)', strokeDasharray: '8 4', strokeWidth: selected ? 2.4 : 1.8 };
  }
  return { stroke: 'rgba(120,113,108,0.7)', strokeDasharray: '6 4', strokeWidth: selected ? 2.4 : 1.8 };
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
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const label = data?.label || '';
  const status = data?.status ?? 'pending';
  const highlighted = Boolean(data?.highlighted);
  const style = getEdgeStyle(status, Boolean(selected), highlighted);

  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
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
