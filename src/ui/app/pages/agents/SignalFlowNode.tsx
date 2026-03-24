import {
  Handle,
  Position,
  type Node as FlowNode,
  type NodeProps as FlowNodeProps,
} from '@xyflow/react';
import { ENERGY_PHASE_COLORS, nodeTypeTint } from './agents-utils';
import type { SignalGraphNodeType } from '../agents-signal-topology';

export type SignalFlowNodeData = {
  label: string;
  subtitle: string;
  nodeType: SignalGraphNodeType;
  energyPhase?: string;
  isDormant?: boolean;
};

export type SignalFlowNodeType = FlowNode<SignalFlowNodeData, SignalGraphNodeType>;

export function SignalFlowNode({ data }: FlowNodeProps<SignalFlowNodeType>) {
  const tint = nodeTypeTint(data.nodeType);
  const lifecycleTint = data.energyPhase ? (ENERGY_PHASE_COLORS[data.energyPhase] ?? tint) : tint;
  const handleBaseStyle = {
    width: 8,
    height: 8,
    border: 0,
    background: tint,
    opacity: 0,
    pointerEvents: 'none' as const,
  };
  if (data.nodeType === 'frontend') {
    return (
      <div className="relative h-[70px] w-[130px]">
        <Handle type="target" position={Position.Left} style={handleBaseStyle} />
        <Handle type="source" position={Position.Right} style={handleBaseStyle} />
        <div
          className="absolute left-1/2 top-1/2 h-[64px] w-[64px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-md border bg-card"
          style={{ borderColor: `${lifecycleTint}80` }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="max-w-[120px] truncate text-xs font-semibold text-foreground">{data.label}</p>
          <p className="mt-1 max-w-[120px] truncate text-[10px] text-muted-foreground">{data.subtitle}</p>
        </div>
      </div>
    );
  }

  const shapeClass =
    data.nodeType === 'topic'
      ? 'rounded-full px-5 py-3'
      : data.nodeType === 'signal-input'
        ? 'rounded-2xl px-4 py-3'
        : data.nodeType === 'actor'
          ? 'rounded-xl px-4 py-3'
          : 'rounded-md px-4 py-3';

  return (
    <div
      className={`relative min-w-[120px] border bg-card text-center shadow-sm ${shapeClass}`}
      style={{ borderColor: `${lifecycleTint}80`, boxShadow: data.nodeType === 'agent' ? `0 0 0 1px ${lifecycleTint}20` : undefined }}
    >
      <Handle type="target" position={Position.Left} style={handleBaseStyle} />
      <Handle type="source" position={Position.Right} style={handleBaseStyle} />
      {data.isDormant && (
        <span className="absolute right-2 top-2 rounded-full bg-[#6B7280]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#6B7280]">
          dormant
        </span>
      )}
      <p className="truncate text-xs font-semibold text-foreground">{data.label}</p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{data.subtitle}</p>
    </div>
  );
}

export const SIGNAL_NODE_TYPES = {
  'signal-input': SignalFlowNode,
  topic: SignalFlowNode,
  agent: SignalFlowNode,
  actor: SignalFlowNode,
  frontend: SignalFlowNode,
} as const;
