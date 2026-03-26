import type { CSSProperties } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import type { GoalDisplayStatus } from '../goal-types';
import { useLongPress } from '../hooks/useLongPress';

export const ME_NODE_SIZE = 84;
export const GOAL_NODE_SIZE = 58;

export interface GoalFlowNodeData extends Record<string, unknown> {
  title: string;
  status: GoalDisplayStatus;
  isMe?: boolean;
  editMode?: boolean;
  hasEmptyRule?: boolean;
  connectModeTargetable?: boolean;
  connectModeHovering?: boolean;
  onConnectHoverChange?: (hovering: boolean) => void;
  onOpenContextMenu?: (nodeId: string, x: number, y: number) => void;
}

function getHandleStyle(editMode: boolean): CSSProperties {
  return editMode
    ? {
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background: 'transparent',
        border: 'none',
        transform: 'none',
      }
    : {
        left: '50%',
        top: '50%',
        width: 8,
        height: 8,
        transform: 'translate(-50%, -50%)',
        background: 'transparent',
        border: 'none',
      };
}

function getGoalClasses(status: GoalDisplayStatus, isMe: boolean): string {
  if (isMe) {
    return 'bg-gradient-to-br from-orange-400 via-orange-500 to-rose-500';
  }

  switch (status) {
    case 'completed':
      return 'border border-emerald-300 bg-gradient-to-br from-emerald-400 to-emerald-600 opacity-80';
    case 'in_progress':
      return 'border-[2.5px] border-[#C75B3A] bg-gradient-to-br from-sky-400 via-sky-500 to-indigo-500 ring-[3px] ring-[#C75B3A]/25 shadow-[0_12px_36px_-12px_rgba(199,91,58,0.55)]';
    case 'suspended':
      return 'border-2 border-[#94A3B8] bg-gradient-to-br from-sky-400/85 via-sky-500/80 to-indigo-500/80';
    case 'cancelled':
      return 'border border-[#94A3B8] bg-gradient-to-br from-sky-400/45 via-sky-500/40 to-indigo-500/40 opacity-50';
    default:
      return 'border border-sky-200 bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-[0_14px_38px_-18px_rgba(59,130,246,0.45)]';
  }
}

export function GoalFlowNode({ id, data, selected }: NodeProps<Node<GoalFlowNodeData>>) {
  const isMe = Boolean(data.isMe);
  const editMode = Boolean(data.editMode);
  const size = isMe ? ME_NODE_SIZE : GOAL_NODE_SIZE;
  const status = data.status;
  const longPressHandlers = useLongPress((event) => {
    data.onOpenContextMenu?.(id, event.clientX, event.clientY);
  });
  const connectModeTargetable = Boolean(data.connectModeTargetable);
  const connectModeHovering = Boolean(data.connectModeHovering);

  return (
    <div
      data-testid={`goal-flow-node-${id}`}
      className={cn(
        'relative flex items-center justify-center rounded-full text-white shadow-lg transition-shadow',
        getGoalClasses(status, isMe),
        !editMode && 'cursor-grab active:cursor-grabbing',
        editMode && 'cursor-crosshair',
        connectModeTargetable && 'ring-2 ring-[#C75B3A]/30 ring-offset-2 ring-offset-[#FAF7F5] dark:ring-offset-[#0C0A09]',
        connectModeHovering && 'ring-4 ring-[#C75B3A]/45 ring-offset-4 ring-offset-[#FAF7F5] shadow-[0_0_0_1px_rgba(199,91,58,0.45),0_18px_42px_-16px_rgba(199,91,58,0.55)] dark:ring-offset-[#0C0A09]',
        selected && 'ring-2 ring-orange-400 ring-offset-2 ring-offset-[#FAF7F5] dark:ring-offset-[#0C0A09]',
      )}
      style={{ width: size, height: size }}
      onPointerEnter={() => data.onConnectHoverChange?.(true)}
      onPointerDown={longPressHandlers.onPointerDown}
      onPointerMove={longPressHandlers.onPointerMove}
      onPointerUp={longPressHandlers.onPointerUp}
      onPointerLeave={() => {
        data.onConnectHoverChange?.(false);
        longPressHandlers.onPointerLeave?.();
      }}
    >
      <Handle type="target" position={Position.Top} style={getHandleStyle(editMode)} />
      <Handle type="source" position={Position.Bottom} style={getHandleStyle(editMode)} />
      <span className={cn('px-1 text-center leading-tight select-none', isMe ? 'text-sm font-bold' : 'text-xs font-medium')}>
        {data.title || '待命名'}
      </span>

      {data.hasEmptyRule ? (
        <span className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[#1C1917]">
          <AlertTriangle size={12} />
        </span>
      ) : null}

      {status === 'completed' ? (
        <span className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-emerald-600">
          <Check size={12} />
        </span>
      ) : null}
    </div>
  );
}
