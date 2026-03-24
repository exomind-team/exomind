// ---------------------------------------------------------------------------
// GoalsPage — Goal network visualization prototype (v1)
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
import { computeForceLayout } from './goal-force-layout';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 800;
const ME_NODE_SIZE = 80;
const GOAL_NODE_SIZE = 56;

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

// ---------------------------------------------------------------------------
// Custom Goal Node
// ---------------------------------------------------------------------------

type GoalFlowNodeData = GoalNodeData & { selected?: boolean; [key: string]: unknown };

function GoalFlowNode({ data, selected }: NodeProps<Node<GoalFlowNodeData>>) {
  const isMe = data.isMe;
  const size = isMe ? ME_NODE_SIZE : GOAL_NODE_SIZE;
  const isCompleted = data.status === 'completed';
  const isCancelled = data.status === 'cancelled';
  const dimmed = isCompleted || isCancelled;

  const bgColor = isMe
    ? 'bg-gradient-to-br from-orange-400 to-rose-500'
    : dimmed
      ? 'bg-stone-300 dark:bg-stone-700'
      : 'bg-gradient-to-br from-sky-400 to-indigo-500';

  const displayName = data.name || '待命名';

  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full text-white shadow-lg transition-all',
        bgColor,
        selected && 'ring-2 ring-orange-400 ring-offset-2 ring-offset-[#FAF7F5] dark:ring-offset-[#0C0A09]',
        dimmed && 'opacity-60',
      )}
      style={{ width: size, height: size }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-full !h-full !rounded-full !top-0 !left-0 !transform-none" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-full !h-full !rounded-full !top-0 !left-0 !transform-none" />
      <span className={cn(
        'text-center leading-tight select-none pointer-events-none px-1',
        isMe ? 'text-sm font-bold' : 'text-xs font-medium',
      )}>
        {displayName}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Task Edge
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
  const edgeData = data as TaskEdgeData | undefined;
  const label = edgeData?.name || '';
  const isCompleted = edgeData?.status === 'completed';
  const isCancelled = edgeData?.status === 'cancelled';
  const dimmed = isCompleted || isCancelled;

  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  const strokeColor = dimmed
    ? 'rgba(168,162,158,0.5)'
    : selected
      ? '#C75B3A'
      : 'rgba(120,113,108,0.6)';

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
        d={`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`}
        stroke={strokeColor}
        strokeWidth={selected ? 2.5 : 1.5}
        fill="none"
        markerEnd={`url(#arrow-${id})`}
        style={{ opacity: dimmed ? 0.5 : 1 }}
      />
      {label ? (
        <foreignObject
          x={midX - 40}
          y={midY - 12}
          width={80}
          height={24}
          className="pointer-events-none overflow-visible"
        >
          <div className="flex items-center justify-center">
            <span className={cn(
              'rounded bg-white/90 dark:bg-stone-900/90 px-1.5 py-0.5 text-[10px] text-stone-600 dark:text-stone-400 whitespace-nowrap',
              dimmed && 'opacity-50',
            )}>
              {label}
            </span>
          </div>
        </foreignObject>
      ) : null}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

function GoalDetailPanel({
  graphData,
  selectedGoalId,
  selectedEdgeId,
  onUpdate,
  onClose,
}: {
  graphData: GoalGraphData;
  selectedGoalId: string | null;
  selectedEdgeId: string | null;
  onUpdate: (data: GoalGraphData) => void;
  onClose: () => void;
}) {
  const goal = selectedGoalId ? graphData.goals.find((g) => g.id === selectedGoalId) : null;
  const edge = selectedEdgeId ? graphData.tasks.find((t) => t.id === selectedEdgeId) : null;

  if (!goal && !edge) return null;

  const updateGoal = (patch: Partial<GoalNodeData>) => {
    if (!goal) return;
    const updated: GoalGraphData = {
      ...graphData,
      goals: graphData.goals.map((g) => (g.id === goal.id ? { ...g, ...patch } : g)),
    };
    onUpdate(updated);
  };

  const updateEdge = (patch: Partial<TaskEdgeData>) => {
    if (!edge) return;
    const updated: GoalGraphData = {
      ...graphData,
      tasks: graphData.tasks.map((t) => (t.id === edge.id ? { ...t, ...patch } : t)),
    };
    onUpdate(updated);
  };

  const connectedEdges = goal
    ? graphData.tasks.filter((t) => t.source === goal.id || t.target === goal.id)
    : [];

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-white/95 dark:bg-stone-900/95 backdrop-blur border-l border-stone-200 dark:border-stone-800 z-50 overflow-y-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
            {goal ? '目标详情' : '任务详情'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 text-lg leading-none"
          >
            ×
          </button>
        </div>

        {goal ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">名称</label>
              <input
                type="text"
                value={goal.name}
                placeholder="待命名"
                disabled={goal.isMe}
                onChange={(e) => updateGoal({ name: e.target.value })}
                className="w-full rounded-md border border-stone-200 dark:border-stone-700 bg-transparent px-2 py-1.5 text-sm text-stone-800 dark:text-stone-200 outline-none focus:border-orange-400 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">状态</label>
              <select
                value={goal.status}
                disabled={goal.isMe}
                onChange={(e) => updateGoal({ status: e.target.value as GoalStatus })}
                className="w-full rounded-md border border-stone-200 dark:border-stone-700 bg-transparent px-2 py-1.5 text-sm text-stone-800 dark:text-stone-200 outline-none focus:border-orange-400 disabled:opacity-50"
              >
                {Object.entries(GOAL_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">达成方式</label>
              <div className="flex gap-2">
                {(['AND', 'OR'] as AchieveMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => updateGoal({ achieveMode: mode })}
                    className={cn(
                      'flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                      goal.achieveMode === mode
                        ? 'border-orange-400 bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                        : 'border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 hover:border-stone-300',
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            {connectedEdges.length > 0 ? (
              <div>
                <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">关联任务</label>
                <div className="space-y-1">
                  {connectedEdges.map((t) => {
                    const direction = t.source === goal.id ? '→' : '←';
                    const otherGoalId = t.source === goal.id ? t.target : t.source;
                    const otherGoal = graphData.goals.find((g) => g.id === otherGoalId);
                    return (
                      <div key={t.id} className="flex items-center gap-1 text-xs text-stone-600 dark:text-stone-400 rounded bg-stone-50 dark:bg-stone-800 px-2 py-1">
                        <span className="text-stone-400">{direction}</span>
                        <span className="truncate flex-1">{t.name || '未命名任务'}</span>
                        <span className="text-stone-400 truncate max-w-[60px]">({otherGoal?.name || '?'})</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : edge ? (
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
                {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
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
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node & Edge type registrations
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = {
  goalNode: GoalFlowNode as NodeTypes['goalNode'],
};

const edgeTypes: EdgeTypes = {
  taskEdge: TaskFlowEdge as EdgeTypes['taskEdge'],
};

// ---------------------------------------------------------------------------
// Convert GoalGraphData → React Flow nodes/edges
// ---------------------------------------------------------------------------

function buildFlowElements(
  graphData: GoalGraphData,
  positions: Map<string, { x: number; y: number }>,
): { nodes: Node<GoalFlowNodeData>[]; edges: Edge<TaskEdgeFlowData>[] } {
  const nodes: Node<GoalFlowNodeData>[] = graphData.goals.map((g) => {
    const pos = positions.get(g.id) ?? { x: 0, y: 0 };
    const size = g.isMe ? ME_NODE_SIZE : GOAL_NODE_SIZE;
    return {
      id: g.id,
      type: 'goalNode',
      position: { x: pos.x - size / 2, y: pos.y - size / 2 },
      data: { ...g },
      draggable: !g.isMe,
    };
  });

  const edges: Edge<TaskEdgeFlowData>[] = graphData.tasks.map((t) => ({
    id: t.id,
    source: t.source,
    target: t.target,
    type: 'taskEdge',
    data: { ...t },
  }));

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Main GoalsPage component
// ---------------------------------------------------------------------------

export function GoalsPage() {
  const [graphData, setGraphData] = useState<GoalGraphData>(() => loadGoalGraph());
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !window.localStorage.getItem('exomind:goals-guide-dismissed');
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rfInstance = useRef<any>(null);

  const initialPositions = useMemo(() => {
    return computeForceLayout(graphData, CANVAS_WIDTH, CANVAS_HEIGHT).positions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [positions, setPositions] = useState(initialPositions);

  const { nodes, edges } = useMemo(
    () => buildFlowElements(graphData, positions),
    [graphData, positions],
  );

  useEffect(() => {
    saveGoalGraph(graphData);
  }, [graphData]);

  const updateGraphData = useCallback((data: GoalGraphData) => {
    setGraphData(data);
  }, []);

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

  const onPaneDoubleClick = useCallback((event: React.MouseEvent) => {
    if (!rfInstance.current) return;
    const bounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
    if (!bounds) return;

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

    setPositions((prev) => {
      const next = new Map(prev);
      next.set(newGoal.id, { x: position.x + GOAL_NODE_SIZE / 2, y: position.y + GOAL_NODE_SIZE / 2 });
      return next;
    });

    setGraphData((prev) => ({
      ...prev,
      goals: [...prev.goals, newGoal],
    }));

    setSelectedGoalId(newGoal.id);
    setSelectedEdgeId(null);
  }, []);

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;

    const exists = graphData.tasks.some(
      (t) => t.source === connection.source && t.target === connection.target,
    );
    if (exists) return;

    const newTask: TaskEdgeData = {
      id: generateId('task'),
      name: '',
      source: connection.source,
      target: connection.target,
      status: 'pending',
    };

    setGraphData((prev) => ({
      ...prev,
      tasks: [...prev.tasks, newTask],
    }));

    setSelectedEdgeId(newTask.id);
    setSelectedGoalId(null);
  }, [graphData.tasks]);

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    const size = graphData.goals.find((g) => g.id === node.id)?.isMe ? ME_NODE_SIZE : GOAL_NODE_SIZE;
    setPositions((prev) => {
      const next = new Map(prev);
      next.set(node.id, {
        x: node.position.x + size / 2,
        y: node.position.y + size / 2,
      });
      return next;
    });
  }, [graphData.goals]);

  const dismissGuide = useCallback(() => {
    setShowGuide(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('exomind:goals-guide-dismissed', '1');
    }
  }, []);

  const detailOpen = selectedGoalId !== null || selectedEdgeId !== null;

  return (
    <div className="relative w-full" style={{ height: '100dvh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={(instance) => { rfInstance.current = instance; }}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onDoubleClick={onPaneDoubleClick}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        defaultEdgeOptions={{ type: 'taskEdge' }}
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(168,162,158,0.3)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {showGuide ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-[1px]"
          onClick={dismissGuide}
        >
          <div className="max-w-xs rounded-2xl bg-white/95 dark:bg-stone-900/95 p-6 shadow-xl text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200 mb-3">目标网络</h2>
            <div className="space-y-2 text-sm text-stone-600 dark:text-stone-400 text-left">
              <p>• <strong>双击空白处</strong> 添加新目标</p>
              <p>• <strong>从节点拖出连线</strong> 创建任务关联</p>
              <p>• <strong>点击节点/连线</strong> 查看和编辑详情</p>
              <p>• <strong>Me</strong> 是你的中心，所有目标围绕它展开</p>
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

      {detailOpen ? (
        <GoalDetailPanel
          graphData={graphData}
          selectedGoalId={selectedGoalId}
          selectedEdgeId={selectedEdgeId}
          onUpdate={updateGraphData}
          onClose={() => {
            setSelectedGoalId(null);
            setSelectedEdgeId(null);
          }}
        />
      ) : null}
    </div>
  );
}
