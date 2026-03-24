// ---------------------------------------------------------------------------
// GoalsPage — Goal network visualization prototype (v1)
// ---------------------------------------------------------------------------
// Fix 1: zoomOnDoubleClick={false} so double-click creates nodes
// Fix 2: Browse mode = drag nodes; Edit mode = drag creates connections
// Fix 3: Me gets its own panel (not "目标详情")
// Fix 4: Desktop shell path registered (shell-mode.ts)
// Fix 5: Continuous force simulation (Obsidian-style floating)
// Fix 6: Center-to-center edges clipped to circle boundary
// Fix 7: Browse/Edit mode toggle (like TaskDag)
// Fix 8: Cycle detection with toast notification
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type NodeTypes,
  type EdgeTypes,
  type OnConnect,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast-hook';
import {
  type GoalGraphData,
  type GoalNode as GoalNodeData,
  type TaskEdge as TaskEdgeData,
  type GoalStatus,
  type AchieveMode,
  type TaskEdgeStatus,
  loadGoalGraph,
  saveGoalGraph,
  generateId,
} from './goal-store';
import { GoalForceSimulation, type PositionMap } from './goal-force-layout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoalPageMode = 'browse' | 'edit';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const ME_NODE_SIZE = 80;
const GOAL_NODE_SIZE = 56;
const ME_RADIUS = ME_NODE_SIZE / 2;

const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  pending: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

const TASK_STATUS_LABELS: Record<TaskEdgeStatus, string> = {
  pending: '待办',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  cancelled: '已取消',
};

const MODE_STORAGE_KEY = 'exomind:goals-mode';

// ---------------------------------------------------------------------------
// Geometry: clip line to circle boundary
// ---------------------------------------------------------------------------

function clipToCircle(
  cx: number, cy: number, radius: number,
  toX: number, toY: number,
): { x: number; y: number } {
  const dx = toX - cx;
  const dy = toY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x: cx + radius, y: cy };
  return { x: cx + (dx / dist) * radius, y: cy + (dy / dist) * radius };
}

// ---------------------------------------------------------------------------
// Cycle detection via DFS
// ---------------------------------------------------------------------------

function wouldCreateCycle(
  tasks: TaskEdgeData[],
  newSource: string,
  newTarget: string,
): boolean {
  // Build adjacency: source → targets
  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    const list = adj.get(t.source) ?? [];
    list.push(t.target);
    adj.set(t.source, list);
  }
  // Add the proposed edge
  const list = adj.get(newSource) ?? [];
  list.push(newTarget);
  adj.set(newSource, list);

  // DFS from newTarget: if we can reach newSource, there's a cycle
  const visited = new Set<string>();
  const stack = [newTarget];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === newSource) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const neighbor of adj.get(node) ?? []) {
      stack.push(neighbor);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Mode Selector (Browse / Edit)
// ---------------------------------------------------------------------------

function GoalModeSelector({
  mode,
  onChange,
}: {
  mode: GoalPageMode;
  onChange: (mode: GoalPageMode) => void;
}) {
  const modes: { key: GoalPageMode; label: string }[] = [
    { key: 'browse', label: '浏览' },
    { key: 'edit', label: '编辑' },
  ];

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
      <div className="pointer-events-auto relative overflow-hidden rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90">
        <div
          className="pointer-events-none absolute inset-y-1 left-1 rounded-full border border-orange-400/40 bg-orange-400/15 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-200 ease-out"
          style={{
            width: `calc((100% - 8px) / ${modes.length})`,
            transform: `translateX(${mode === 'edit' ? '100%' : '0%'})`,
          }}
        />
        <div className="relative z-10 grid grid-cols-2 gap-0">
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onChange(m.key)}
              className={cn(
                'relative z-10 min-w-[56px] rounded-full px-3 py-1 text-[11px] font-medium transition-colors',
                mode === m.key
                  ? 'font-semibold text-[#1C1917] dark:text-[#FAFAF9]'
                  : 'text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#FAFAF9]',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Goal Node
// ---------------------------------------------------------------------------

type GoalFlowNodeData = GoalNodeData & { [key: string]: unknown };

// In edit mode: handles cover the full node (drag = connect).
// In browse mode: handles are tiny center dots (drag = move node).
function GoalFlowNode({ data, selected }: NodeProps<Node<GoalFlowNodeData>>) {
  const isMe = data.isMe as boolean;
  const size = isMe ? ME_NODE_SIZE : GOAL_NODE_SIZE;
  const status = data.status as GoalStatus;
  const dimmed = status === 'completed' || status === 'cancelled';
  const editMode = (data._editMode as boolean) ?? false;

  const bgColor = isMe
    ? 'bg-gradient-to-br from-orange-400 to-rose-500'
    : dimmed
      ? 'bg-stone-300 dark:bg-stone-700'
      : 'bg-gradient-to-br from-sky-400 to-indigo-500';

  const displayName = (data.name as string) || '待命名';

  // Handle style depends on mode
  const handleStyle: React.CSSProperties = editMode
    ? {
        // Edit mode: handle covers entire node for easy connection drag
        left: 0, top: 0,
        width: '100%', height: '100%',
        borderRadius: '50%',
        background: 'transparent',
        border: 'none',
        transform: 'none',
      }
    : {
        // Browse mode: tiny centered handle (won't intercept node drag)
        left: '50%', top: '50%',
        width: 8, height: 8,
        transform: 'translate(-50%, -50%)',
        background: 'transparent',
        border: 'none',
      };

  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full text-white shadow-lg transition-shadow',
        bgColor,
        !editMode && 'cursor-grab active:cursor-grabbing',
        editMode && 'cursor-crosshair',
        selected && 'ring-2 ring-orange-400 ring-offset-2 ring-offset-[#FAF7F5] dark:ring-offset-[#0C0A09]',
        dimmed && 'opacity-60',
      )}
      style={{ width: size, height: size }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
      <span
        className={cn(
          'text-center leading-tight select-none pointer-events-none px-1',
          isMe ? 'text-sm font-bold' : 'text-xs font-medium',
        )}
      >
        {displayName}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Task Edge (center-to-center, clipped to circle edges)
// ---------------------------------------------------------------------------

type TaskEdgeFlowData = TaskEdgeData & { [key: string]: unknown };

function TaskFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps<Edge<TaskEdgeFlowData>>) {
  const edgeData = data as (TaskEdgeData & Record<string, unknown>) | undefined;
  const label = edgeData?.name || '';
  const edgeStatus = edgeData?.status;
  const dimmed = edgeStatus === 'completed' || edgeStatus === 'cancelled';

  // Per-node radius (Fix 6)
  const srcIsMe = edgeData?.sourceIsMe as boolean | undefined;
  const tgtIsMe = edgeData?.targetIsMe as boolean | undefined;
  const sourceRadius = srcIsMe ? ME_RADIUS : GOAL_NODE_SIZE / 2;
  const targetRadius = tgtIsMe ? ME_RADIUS : GOAL_NODE_SIZE / 2;

  // Parallel edge offset (Fix: 重边分离)
  const parallelIndex = (edgeData?.parallelIndex as number) ?? 0;
  const parallelTotal = (edgeData?.parallelTotal as number) ?? 1;

  // Compute perpendicular offset for parallel edges
  const PARALLEL_GAP = 20;
  const offset = parallelTotal <= 1 ? 0 : (parallelIndex - (parallelTotal - 1) / 2) * PARALLEL_GAP;

  // Clip endpoints to circle boundaries
  const src = clipToCircle(sourceX, sourceY, sourceRadius, targetX, targetY);
  const tgt = clipToCircle(targetX, targetY, targetRadius, sourceX, sourceY);

  // Perpendicular vector for offset
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = len > 0 ? -dy / len : 0;
  const ny = len > 0 ? dx / len : 0;

  // Apply offset to create curved path via quadratic bezier
  const midX = (src.x + tgt.x) / 2 + nx * offset;
  const midY = (src.y + tgt.y) / 2 + ny * offset;

  const strokeColor = dimmed
    ? 'rgba(168,162,158,0.5)'
    : selected
      ? '#C75B3A'
      : 'rgba(120,113,108,0.6)';

  // Straight line for single edges, quadratic bezier for parallel edges
  const pathD = offset === 0
    ? `M ${src.x} ${src.y} L ${tgt.x} ${tgt.y}`
    : `M ${src.x} ${src.y} Q ${midX} ${midY} ${tgt.x} ${tgt.y}`;

  // Label position along midpoint
  const labelX = offset === 0 ? (src.x + tgt.x) / 2 : midX;
  const labelY = offset === 0 ? (src.y + tgt.y) / 2 : midY;

  return (
    <g>
      <defs>
        <marker
          id={`arrow-${id}`}
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={strokeColor} />
        </marker>
      </defs>
      <path
        d={pathD}
        stroke={strokeColor}
        strokeWidth={selected ? 2.5 : 1.5}
        fill="none"
        markerEnd={`url(#arrow-${id})`}
        style={{ opacity: dimmed ? 0.5 : 1 }}
      />
      {label ? (
        <foreignObject
          x={labelX - 50}
          y={labelY - 12}
          width={100}
          height={24}
          className="pointer-events-none overflow-visible"
        >
          <div className="flex items-center justify-center">
            <span
              className={cn(
                'rounded bg-white/90 dark:bg-stone-900/90 px-1.5 py-0.5 text-[10px] text-stone-600 dark:text-stone-400 whitespace-nowrap',
                dimmed && 'opacity-50',
              )}
            >
              {label}
            </span>
          </div>
        </foreignObject>
      ) : null}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel — Goal
// ---------------------------------------------------------------------------

function GoalDetailPanel({
  goal,
  graphData,
  onUpdate,
  onClose,
}: {
  goal: GoalNodeData;
  graphData: GoalGraphData;
  onUpdate: (data: GoalGraphData) => void;
  onClose: () => void;
}) {
  const updateGoal = (patch: Partial<GoalNodeData>) => {
    onUpdate({
      ...graphData,
      goals: graphData.goals.map((g) => (g.id === goal.id ? { ...g, ...patch } : g)),
    });
  };

  const connectedEdges = graphData.tasks.filter(
    (t) => t.source === goal.id || t.target === goal.id,
  );

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-l border-stone-200 dark:border-stone-800 z-50 overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">目标详情</h3>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-lg leading-none">×</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">名称</label>
            <input
              type="text"
              value={goal.name}
              placeholder="待命名"
              onChange={(e) => updateGoal({ name: e.target.value })}
              className="w-full rounded-md border border-stone-200 dark:border-stone-700 bg-transparent px-2 py-1.5 text-sm text-stone-800 dark:text-stone-200 outline-none focus:border-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">状态</label>
            <select
              value={goal.status}
              onChange={(e) => updateGoal({ status: e.target.value as GoalStatus })}
              className="w-full rounded-md border border-stone-200 dark:border-stone-700 bg-transparent px-2 py-1.5 text-sm text-stone-800 dark:text-stone-200 outline-none focus:border-orange-400"
            >
              {Object.entries(GOAL_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">达成方式</label>
            <div className="flex gap-2">
              {(['AND', 'OR'] as AchieveMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => updateGoal({ achieveMode: m })}
                  className={cn(
                    'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                    goal.achieveMode === m
                      ? 'border-orange-400 bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                      : 'border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 hover:border-stone-300',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {connectedEdges.length > 0 ? (
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">关联任务</label>
              <div className="space-y-1">
                {connectedEdges.map((t) => {
                  const dir = t.source === goal.id ? '→' : '←';
                  const otherId = t.source === goal.id ? t.target : t.source;
                  const other = graphData.goals.find((g) => g.id === otherId);
                  return (
                    <div key={t.id} className="flex items-center gap-1 text-xs text-stone-600 dark:text-stone-400 rounded bg-stone-50 dark:bg-stone-800 px-2 py-1">
                      <span className="text-stone-400">{dir}</span>
                      <span className="truncate flex-1">{t.name || '未命名任务'}</span>
                      <span className="text-stone-400 truncate max-w-[60px]">({other?.name || '?'})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel — Me (dedicated)
// ---------------------------------------------------------------------------

function MeDetailPanel({
  graphData,
  onClose,
}: {
  graphData: GoalGraphData;
  onClose: () => void;
}) {
  const me = graphData.goals.find((g) => g.isMe);
  if (!me) return null;

  const directTasks = graphData.tasks.filter((t) => t.source === me.id || t.target === me.id);
  const directGoalIds = new Set(
    directTasks.map((t) => (t.source === me.id ? t.target : t.source)),
  );
  const directGoals = graphData.goals.filter((g) => directGoalIds.has(g.id));

  const totalGoals = graphData.goals.filter((g) => !g.isMe).length;
  const completedGoals = graphData.goals.filter((g) => !g.isMe && g.status === 'completed').length;
  const totalTasks = graphData.tasks.length;
  const activeTasks = graphData.tasks.filter((t) => t.status === 'in_progress').length;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-l border-stone-200 dark:border-stone-800 z-50 overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">Me — 你的中心</h3>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-lg leading-none">×</button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-stone-50 dark:bg-stone-800 p-2 text-center">
              <div className="text-lg font-bold text-stone-800 dark:text-stone-200">{totalGoals}</div>
              <div className="text-[10px] text-stone-500">目标</div>
            </div>
            <div className="rounded-lg bg-stone-50 dark:bg-stone-800 p-2 text-center">
              <div className="text-lg font-bold text-green-600 dark:text-green-400">{completedGoals}</div>
              <div className="text-[10px] text-stone-500">已完成</div>
            </div>
            <div className="rounded-lg bg-stone-50 dark:bg-stone-800 p-2 text-center">
              <div className="text-lg font-bold text-stone-800 dark:text-stone-200">{totalTasks}</div>
              <div className="text-[10px] text-stone-500">任务</div>
            </div>
            <div className="rounded-lg bg-stone-50 dark:bg-stone-800 p-2 text-center">
              <div className="text-lg font-bold text-orange-500">{activeTasks}</div>
              <div className="text-[10px] text-stone-500">进行中</div>
            </div>
          </div>
          {directGoals.length > 0 ? (
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">直接关联目标</label>
              <div className="space-y-1">
                {directGoals.map((g) => {
                  const task = directTasks.find(
                    (t) => (t.source === me.id && t.target === g.id) || (t.target === me.id && t.source === g.id),
                  );
                  return (
                    <div key={g.id} className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400 rounded bg-stone-50 dark:bg-stone-800 px-2 py-1.5">
                      <span className={cn(
                        'inline-block w-2 h-2 rounded-full shrink-0',
                        g.status === 'completed' ? 'bg-green-500' : g.status === 'cancelled' ? 'bg-stone-400' : 'bg-sky-500',
                      )} />
                      <span className="truncate flex-1">{g.name || '待命名'}</span>
                      {task ? <span className="text-stone-400 text-[10px] shrink-0">{TASK_STATUS_LABELS[task.status]}</span> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-stone-400 dark:text-stone-500 italic">
              还没有关联目标。双击空白处添加目标，然后在编辑模式下从 Me 拖出连线。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel — Edge
// ---------------------------------------------------------------------------

function EdgeDetailPanel({
  edge,
  graphData,
  onUpdate,
  onClose,
}: {
  edge: TaskEdgeData;
  graphData: GoalGraphData;
  onUpdate: (data: GoalGraphData) => void;
  onClose: () => void;
}) {
  const updateEdge = (patch: Partial<TaskEdgeData>) => {
    onUpdate({
      ...graphData,
      tasks: graphData.tasks.map((t) => (t.id === edge.id ? { ...t, ...patch } : t)),
    });
  };

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-l border-stone-200 dark:border-stone-800 z-50 overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">任务详情</h3>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-lg leading-none">×</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">名称</label>
            <input
              type="text"
              value={edge.name}
              placeholder="待命名"
              onChange={(e) => updateEdge({ name: e.target.value })}
              className="w-full rounded-md border border-stone-200 dark:border-stone-700 bg-transparent px-2 py-1.5 text-sm text-stone-800 dark:text-stone-200 outline-none focus:border-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">状态</label>
            <select
              value={edge.status}
              onChange={(e) => updateEdge({ status: e.target.value as TaskEdgeStatus })}
              className="w-full rounded-md border border-stone-200 dark:border-stone-700 bg-transparent px-2 py-1.5 text-sm text-stone-800 dark:text-stone-200 outline-none focus:border-orange-400"
            >
              {Object.entries(TASK_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">连接</label>
            <div className="text-xs text-stone-600 dark:text-stone-400">
              <span>{graphData.goals.find((g) => g.id === edge.source)?.name || '?'}</span>
              <span className="mx-1">→</span>
              <span>{graphData.goals.find((g) => g.id === edge.target)?.name || '?'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node & Edge type registrations (stable references — outside component)
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = {
  goalNode: GoalFlowNode as NodeTypes['goalNode'],
};

const edgeTypes: EdgeTypes = {
  taskEdge: TaskFlowEdge as EdgeTypes['taskEdge'],
};

// ---------------------------------------------------------------------------
// Convert GoalGraphData + positions → React Flow nodes/edges
// ---------------------------------------------------------------------------

function buildFlowElements(
  graphData: GoalGraphData,
  positions: PositionMap,
  editMode: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graphData.goals.map((g) => {
    const center = positions.get(g.id) ?? { x: 0, y: 0 };
    const size = g.isMe ? ME_NODE_SIZE : GOAL_NODE_SIZE;
    return {
      id: g.id,
      type: 'goalNode',
      position: { x: center.x - size / 2, y: center.y - size / 2 },
      data: { ...g, _editMode: editMode } as Record<string, unknown>,
      // Browse mode: nodes are draggable (except Me). Edit mode: drag starts connections.
      draggable: !editMode && !g.isMe,
    };
  });

  const goalById = new Map(graphData.goals.map((g) => [g.id, g]));

  // Compute parallel-edge indices: for edges sharing the same (source,target) pair,
  // assign an index (0,1,2…) and total count so the edge component can offset them.
  const pairCount = new Map<string, number>();
  for (const t of graphData.tasks) {
    // Use canonical key so A→B and B→A share the same pair
    const a = t.source < t.target ? t.source : t.target;
    const b = t.source < t.target ? t.target : t.source;
    const pairKey = `${a}::${b}`;
    pairCount.set(pairKey, (pairCount.get(pairKey) ?? 0) + 1);
  }
  const pairSeen = new Map<string, number>();

  const edges: Edge[] = graphData.tasks.map((t) => {
    const a = t.source < t.target ? t.source : t.target;
    const b = t.source < t.target ? t.target : t.source;
    const pairKey = `${a}::${b}`;
    const idx = pairSeen.get(pairKey) ?? 0;
    pairSeen.set(pairKey, idx + 1);
    const total = pairCount.get(pairKey) ?? 1;

    return {
      id: t.id,
      source: t.source,
      target: t.target,
      type: 'taskEdge',
      data: {
        ...t,
        sourceIsMe: goalById.get(t.source)?.isMe ?? false,
        targetIsMe: goalById.get(t.target)?.isMe ?? false,
        parallelIndex: idx,
        parallelTotal: total,
      } as Record<string, unknown>,
    };
  });

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Main GoalsPage component
// ---------------------------------------------------------------------------

function readStoredMode(): GoalPageMode {
  if (typeof window === 'undefined') return 'browse';
  const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
  return stored === 'edit' ? 'edit' : 'browse';
}

export function GoalsPage() {
  const [graphData, setGraphData] = useState<GoalGraphData>(() => loadGoalGraph());
  const [positions, setPositions] = useState<PositionMap>(new Map());
  const [mode, setMode] = useState<GoalPageMode>(readStoredMode);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !window.localStorage.getItem('exomind:goals-guide-dismissed');
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rfInstance = useRef<any>(null);
  const simRef = useRef<GoalForceSimulation | null>(null);
  const graphDataRef = useRef(graphData);
  graphDataRef.current = graphData;

  const editMode = mode === 'edit';

  const handleModeChange = useCallback((m: GoalPageMode) => {
    setMode(m);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MODE_STORAGE_KEY, m);
    }
  }, []);

  // ---- Continuous force simulation ----

  useEffect(() => {
    const sim = new GoalForceSimulation(
      graphData,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      setPositions,
    );
    simRef.current = sim;
    return () => {
      sim.destroy();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    simRef.current?.updateData(graphData);
  }, [graphData]);

  useEffect(() => {
    saveGoalGraph(graphData);
  }, [graphData]);

  // ---- Build React Flow elements ----

  const { nodes, edges } = useMemo(
    () => buildFlowElements(graphData, positions, editMode),
    [graphData, positions, editMode],
  );

  // ---- Event handlers ----

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedGoalId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
    setSelectedGoalId(null);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedGoalId(null);
    setSelectedEdgeId(null);
  }, []);

  // Double-click on pane creates new goal (works in both modes)
  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    if (!rfInstance.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('.react-flow__node')) return;

    const position = rfInstance.current.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const newGoal: GoalNodeData = {
      id: generateId('goal'),
      name: '',
      status: 'pending',
      achieveMode: 'AND',
      isMe: false,
    };

    setGraphData((prev) => ({
      ...prev,
      goals: [...prev.goals, newGoal],
    }));

    setTimeout(() => {
      simRef.current?.pinNode(newGoal.id, position.x, position.y);
      setTimeout(() => simRef.current?.releaseNode(newGoal.id), 300);
    }, 50);

    setSelectedGoalId(newGoal.id);
    setSelectedEdgeId(null);
  }, []);

  // Browse mode: drag syncs with simulation
  const onNodeDrag = useCallback((_: React.MouseEvent, node: Node) => {
    if (editMode) return; // edit mode doesn't drag nodes
    const g = graphDataRef.current.goals.find((goal) => goal.id === node.id);
    const size = g?.isMe ? ME_NODE_SIZE : GOAL_NODE_SIZE;
    simRef.current?.pinNode(node.id, node.position.x + size / 2, node.position.y + size / 2);
  }, [editMode]);

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (editMode) return;
    simRef.current?.releaseNode(node.id);
  }, [editMode]);

  // Edit mode: connect nodes with cycle detection
  const onConnect: OnConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;

    setGraphData((prev) => {
      // Duplicate check
      const exists = prev.tasks.some(
        (t) => t.source === connection.source && t.target === connection.target,
      );
      if (exists) {
        toast({ title: '连线已存在', description: '这两个目标之间已有相同方向的任务连线。' });
        return prev;
      }

      // Cycle detection
      if (wouldCreateCycle(prev.tasks, connection.source!, connection.target!)) {
        toast({ title: '无法创建环路', description: '目标网络不允许形成循环依赖。' });
        return prev;
      }

      const newTask: TaskEdgeData = {
        id: generateId('task'),
        name: '',
        source: connection.source!,
        target: connection.target!,
        status: 'pending',
      };
      return { ...prev, tasks: [...prev.tasks, newTask] };
    });
  }, []);

  const dismissGuide = useCallback(() => {
    setShowGuide(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('exomind:goals-guide-dismissed', '1');
    }
  }, []);

  const closePanel = useCallback(() => {
    setSelectedGoalId(null);
    setSelectedEdgeId(null);
  }, []);

  // ---- Determine which panel to show ----

  const selectedGoal = selectedGoalId ? graphData.goals.find((g) => g.id === selectedGoalId) : null;
  const selectedEdge = selectedEdgeId ? graphData.tasks.find((t) => t.id === selectedEdgeId) : null;

  return (
    <div className="relative w-full h-full" style={{ minHeight: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => { rfInstance.current = instance; }}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onDoubleClick={onDoubleClick}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        defaultEdgeOptions={{ type: 'taskEdge' }}
        connectionLineStyle={{ stroke: 'rgba(120,113,108,0.6)', strokeWidth: 1.5 }}
        zoomOnDoubleClick={false}
        nodesDraggable={!editMode}
        nodesConnectable={editMode}
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(168,162,158,0.3)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Mode selector */}
      <GoalModeSelector mode={mode} onChange={handleModeChange} />

      {/* Guide overlay */}
      {showGuide ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-[1px]"
          onClick={dismissGuide}
        >
          <div className="max-w-xs rounded-2xl bg-white/95 dark:bg-stone-900/95 p-6 shadow-xl text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-3">目标网络</h2>
            <div className="space-y-2 text-sm text-stone-600 dark:text-stone-400 text-left">
              <p>• <strong>双击空白处</strong> 添加新目标</p>
              <p>• <strong>浏览模式</strong> 拖动节点移动，松手后自动回弹</p>
              <p>• <strong>编辑模式</strong> 从节点拖出连线关联目标</p>
              <p>• <strong>点击节点/连线</strong> 查看和编辑详情</p>
              <p>• <strong>Me</strong> 是你的中心，固定不动</p>
            </div>
            <button
              type="button"
              onClick={dismissGuide}
              className="mt-4 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
            >
              开始探索
            </button>
          </div>
        </div>
      ) : null}

      {/* Detail panels */}
      {selectedGoal?.isMe ? (
        <MeDetailPanel graphData={graphData} onClose={closePanel} />
      ) : selectedGoal ? (
        <GoalDetailPanel goal={selectedGoal} graphData={graphData} onUpdate={setGraphData} onClose={closePanel} />
      ) : selectedEdge ? (
        <EdgeDetailPanel edge={selectedEdge} graphData={graphData} onUpdate={setGraphData} onClose={closePanel} />
      ) : null}
    </div>
  );
}
