import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from '@/components/ui/toast-hook';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { GoalForceSimulation, type PositionMap } from './goal-force-layout';
import { useGoalStore } from './goal-store';
import { CancelGoalDialog } from './components/CancelGoalDialog';
import { EdgeDetailPanel } from './components/EdgeDetailPanel';
import { GoalContextMenu } from './components/GoalContextMenu';
import { GoalDetailPanel } from './components/GoalDetailPanel';
import { GoalFlowNode, type GoalFlowNodeData } from './components/GoalFlowNode';
import { MeDetailPanel } from './components/MeDetailPanel';
import { TaskFlowEdge, type TaskFlowEdgeData } from './components/TaskFlowEdge';
import { useConnectMode } from './hooks/useConnectMode';
import { useContextMenu } from './hooks/useContextMenu';

type GoalPageMode = 'browse' | 'edit';
type Selection = { kind: 'goal' | 'edge' | 'me'; id: string } | null;

const MODE_STORAGE_KEY = 'exomind:goals-mode';
const SHOW_CANCELLED_STORAGE_KEY = 'exomind:goals-show-cancelled';
const GUIDE_HIDDEN_STORAGE_KEY = 'exomind:goals-guide-hidden';

function readBooleanStorage(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  return raw === null ? fallback : raw === 'true';
}

function readModeStorage(): GoalPageMode {
  if (typeof window === 'undefined') return 'browse';
  const raw = window.localStorage.getItem(MODE_STORAGE_KEY);
  return raw === 'edit' ? 'edit' : 'browse';
}

function GoalModeSelector({
  mode,
  onChange,
}: {
  mode: GoalPageMode;
  onChange: (mode: GoalPageMode) => void;
}) {
  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-[#E7E3E0] bg-white/90 p-1 shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90">
      {(['browse', 'edit'] as const).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={cn(
            'rounded-full px-3 py-1 text-[11px] font-medium transition-colors',
            mode === item
              ? 'bg-orange-400/15 text-[#1C1917] dark:text-[#FAFAF9]'
              : 'text-[#78716C] dark:text-[#A8A29E]',
          )}
        >
          {item === 'browse' ? '浏览' : '编辑'}
        </button>
      ))}
    </div>
  );
}

function buildVisibleEdges(graph: ReturnType<typeof useGoalStore.getState>['graph'], showCancelled: boolean) {
  return graph.edges.filter((edge) => {
    const sourceGoal = edge.source === graph.me.id ? null : graph.goals.find((goal) => goal.id === edge.source);
    const targetGoal = graph.goals.find((goal) => goal.id === edge.target);
    if (!targetGoal) return false;
    if (showCancelled) return true;
    return !sourceGoal?.cancelled && !targetGoal.cancelled;
  });
}

export function GoalsPage() {
  const graph = useGoalStore((state) => state.graph);
  const edgeOverrides = useGoalStore((state) => state.edgeOverrides);
  const getEdgeStatus = useGoalStore((state) => state.getEdgeStatus);
  const deriveGoalDisplayStatus = useGoalStore((state) => state.deriveGoalDisplayStatus);
  const getInEdges = useGoalStore((state) => state.getInEdges);
  const getOutEdges = useGoalStore((state) => state.getOutEdges);
  const getHopDistance = useGoalStore((state) => state.getHopDistance);
  const createGoal = useGoalStore((state) => state.createGoal);
  const createEdge = useGoalStore((state) => state.createEdge);
  const cancelGoal = useGoalStore((state) => state.cancelGoal);
  const deleteEdge = useGoalStore((state) => state.deleteEdge);
  const updateGoal = useGoalStore((state) => state.updateGoal);
  const updateEdge = useGoalStore((state) => state.updateEdge);
  const setEdgeStatusOverride = useGoalStore((state) => state.setEdgeStatusOverride);
  const clearEdgeStatusOverride = useGoalStore((state) => state.clearEdgeStatusOverride);
  const updateMe = useGoalStore((state) => state.updateMe);
  const isDesktop = useIsDesktop();

  const [positions, setPositions] = useState<PositionMap>(new Map());
  const [mode, setMode] = useState<GoalPageMode>(() => readModeStorage());
  const [showCancelled, setShowCancelled] = useState(() => readBooleanStorage(SHOW_CANCELLED_STORAGE_KEY, false));
  const [guideHidden, setGuideHidden] = useState(() => readBooleanStorage(GUIDE_HIDDEN_STORAGE_KEY, false));
  const [selected, setSelected] = useState<Selection>(null);
  const [cancelGoalId, setCancelGoalId] = useState<string | null>(null);
  const [highlightedEdgeIds, setHighlightedEdgeIds] = useState<string[]>([]);
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();
  const connectMode = useConnectMode();
  const simulationRef = useRef<GoalForceSimulation | null>(null);
  const highlightTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeContextMenu();
      connectMode.cancel();
      setCancelGoalId(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeContextMenu, connectMode]);

  useEffect(() => () => {
    highlightTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    highlightTimeoutsRef.current.clear();
  }, []);

  const visibleGraph = useMemo(() => ({
    ...graph,
    goals: showCancelled ? graph.goals : graph.goals.filter((goal) => !goal.cancelled),
    edges: buildVisibleEdges(graph, showCancelled),
  }), [graph, showCancelled]);

  useEffect(() => {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    window.localStorage.setItem(SHOW_CANCELLED_STORAGE_KEY, String(showCancelled));
  }, [showCancelled]);

  useEffect(() => {
    window.localStorage.setItem(GUIDE_HIDDEN_STORAGE_KEY, String(guideHidden));
  }, [guideHidden]);

  useEffect(() => {
    if (graph.goals.length > 0 && !guideHidden) {
      setGuideHidden(true);
    }
  }, [graph.goals.length, guideHidden]);

  useEffect(() => {
    const simulation = simulationRef.current;
    if (!simulation) {
      simulationRef.current = new GoalForceSimulation(visibleGraph, 1200, 800, setPositions, {
        showCancelled,
      });
      return () => {
        simulationRef.current?.destroy();
        simulationRef.current = null;
      };
    }
    simulation.updateData(visibleGraph, { showCancelled });
  }, [visibleGraph, showCancelled]);

  const nodeTypes = useMemo<NodeTypes>(() => ({
    goal: GoalFlowNode,
    me: GoalFlowNode,
  }), []);
  const edgeTypes = useMemo<EdgeTypes>(() => ({ task: TaskFlowEdge }), []);

  const nodes = useMemo<Array<Node<GoalFlowNodeData>>>(() => {
    const meNode: Node<GoalFlowNodeData> = {
      id: graph.me.id,
      type: 'me',
      position: positions.get(graph.me.id) ?? { x: 0, y: 0 },
      data: {
        title: graph.me.name,
        status: 'pending',
        isMe: true,
        editMode: mode === 'edit',
        onOpenContextMenu: (nodeId: string, x: number, y: number) => {
          setSelected({ kind: 'me', id: nodeId });
          openContextMenu({ kind: 'me', id: nodeId, x, y });
        },
      },
      draggable: mode === 'browse',
    };

    const goalNodes = visibleGraph.goals.map((goal) => ({
      id: goal.id,
      type: 'goal',
      position: positions.get(goal.id) ?? { x: 0, y: 0 },
      data: {
        title: goal.title,
        status: deriveGoalDisplayStatus(goal.id),
        editMode: mode === 'edit',
        hasEmptyRule: goal.completionRule.length === 0,
        onOpenContextMenu: (nodeId: string, x: number, y: number) => {
          setSelected({ kind: 'goal', id: nodeId });
          openContextMenu({ kind: 'goal', id: nodeId, x, y });
        },
      },
      draggable: mode === 'browse',
    }));

    return [meNode, ...goalNodes];
  }, [deriveGoalDisplayStatus, graph.me.id, graph.me.name, mode, positions, visibleGraph.goals]);

  const edges = useMemo<Array<Edge<TaskFlowEdgeData>>>(() => (
    visibleGraph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'task',
      selectable: true,
      data: {
        label: edge.title || (edge.taskNodeRef ? edge.taskNodeRef : '待定义'),
        status: getEdgeStatus(edge.id),
        highlighted: highlightedEdgeIds.includes(edge.id),
      },
    }))
  ), [getEdgeStatus, highlightedEdgeIds, visibleGraph.edges]);

  const selectedGoal = selected?.kind === 'goal'
    ? graph.goals.find((goal) => goal.id === selected.id) ?? null
    : null;
  const selectedEdge = selected?.kind === 'edge'
    ? graph.edges.find((edge) => edge.id === selected.id) ?? null
    : null;

  function notifyResult(result: { ok: false; error: string } | { ok: true }, success?: string) {
    if (!result.ok) {
      toast({ title: '操作失败', description: result.error });
      return false;
    }
    if (success) {
      toast({ title: success });
    }
    return true;
  }

  function handleCreateGoal(fromNode: string, direction: 'upstream' | 'downstream') {
    const result = createGoal({
      fromNode,
      direction,
    });
    if (!notifyResult(result)) return;
    if (!result.ok) return;
    setSelected({ kind: 'goal', id: result.value.goal.id });
    simulationRef.current?.reheat();
  }

  function handleConnect(source: string, target: string) {
    const result = createEdge({
      source,
      target,
      rulePosition: { clauseIndex: 0 },
    });
    connectMode.cancel();
    if (!notifyResult(result, '已创建连接')) return;
    if (!result.ok) return;
    setSelected({ kind: 'edge', id: result.value.id });
    simulationRef.current?.reheat();
  }

  function flashEdge(edgeId: string) {
    setHighlightedEdgeIds((current) => (current.includes(edgeId) ? current : [...current, edgeId]));
    const existing = highlightTimeoutsRef.current.get(edgeId);
    if (existing) {
      clearTimeout(existing);
    }
    const timeoutId = setTimeout(() => {
      setHighlightedEdgeIds((current) => current.filter((candidate) => candidate !== edgeId));
      highlightTimeoutsRef.current.delete(edgeId);
    }, 1000);
    highlightTimeoutsRef.current.set(edgeId, timeoutId);
  }

  const contextItems = useMemo(() => {
    if (!contextMenu) return [];
    if (contextMenu.kind === 'me') {
      return [
        { key: 'detail', label: '详情', onSelect: () => setSelected({ kind: 'me', id: contextMenu.id }) },
        { key: 'downstream', label: '添加目标', onSelect: () => handleCreateGoal(contextMenu.id, 'downstream') },
      ];
    }
    if (contextMenu.kind === 'goal') {
      const goal = graph.goals.find((item) => item.id === contextMenu.id);
      if (!goal || goal.cancelled) return [];
      const goalStatus = deriveGoalDisplayStatus(contextMenu.id);
      if (goalStatus === 'completed') {
        return [
          { key: 'detail', label: '详情', onSelect: () => setSelected({ kind: 'goal', id: contextMenu.id }) },
          { key: 'downstream', label: '添加下游目标', onSelect: () => handleCreateGoal(contextMenu.id, 'downstream') },
          { key: 'connect', label: '连接到...', onSelect: () => connectMode.start(contextMenu.id) },
        ];
      }
      return [
        { key: 'detail', label: '详情', onSelect: () => setSelected({ kind: 'goal', id: contextMenu.id }) },
        { key: 'downstream', label: '添加下游目标', onSelect: () => handleCreateGoal(contextMenu.id, 'downstream') },
        { key: 'upstream', label: '添加上游目标', onSelect: () => handleCreateGoal(contextMenu.id, 'upstream') },
        { key: 'connect', label: '连接到...', onSelect: () => connectMode.start(contextMenu.id) },
        { key: 'cancel', label: '取消目标', danger: true, onSelect: () => setCancelGoalId(contextMenu.id) },
      ];
    }
    return [
      { key: 'detail', label: '详情', onSelect: () => setSelected({ kind: 'edge', id: contextMenu.id }) },
      {
        key: 'delete',
        label: '删除',
        danger: true,
        onSelect: () => {
          const result = deleteEdge({ edgeId: contextMenu.id });
          if (!result.ok) {
            notifyResult(result);
            return;
          }
          if (result.value.autoAddedEdgeId) {
            flashEdge(result.value.autoAddedEdgeId);
            toast({ title: '已自动添加连接以保持目标可达' });
          } else if (result.value.adjustedRule) {
            toast({ title: '完成条件已自动调整' });
          } else {
            toast({ title: '已删除连接' });
          }
          setSelected(null);
        },
      },
    ];
  }, [connectMode, contextMenu, deleteEdge, deriveGoalDisplayStatus, graph.goals]);

  return (
    <div data-testid="goals-page" className="relative h-[calc(100vh-5rem)] overflow-hidden rounded-[32px] border border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]">
      <GoalModeSelector mode={mode} onChange={setMode} />

      <div className="pointer-events-auto absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full border border-[#E7E3E0] bg-white/90 px-3 py-2 text-xs text-[#57534E] shadow-sm backdrop-blur dark:border-[#3C3836] dark:bg-[#1C1917]/90 dark:text-[#D6D3D1]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} />
          显示已取消
        </label>
      </div>

      {connectMode.isActive ? (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-[#1C1917] px-4 py-2 text-xs text-white">
          连线模式：点击目标节点完成连接，点击空白或 ESC 取消
        </div>
      ) : null}

      {!guideHidden && graph.goals.length === 0 ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 px-4 py-2 text-sm text-[#57534E] shadow-sm">
          {isDesktop ? '右键 Me 添加你的第一个目标' : '长按 Me 添加你的第一个目标'}
        </div>
      ) : null}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodesDraggable={mode === 'browse'}
        nodesConnectable={mode === 'edit'}
        zoomOnDoubleClick={false}
        onPaneClick={() => {
          closeContextMenu();
          if (connectMode.isActive) {
            connectMode.cancel();
            return;
          }
          setSelected(null);
        }}
        onNodeClick={(_, node) => {
          closeContextMenu();
          if (connectMode.isActive) {
            if (node.id !== connectMode.sourceId && node.id !== graph.me.id) {
              handleConnect(connectMode.sourceId as string, node.id);
            }
            return;
          }
          setSelected(node.id === graph.me.id ? { kind: 'me', id: node.id } : { kind: 'goal', id: node.id });
        }}
        onEdgeClick={(_, edge) => {
          closeContextMenu();
          setSelected({ kind: 'edge', id: edge.id });
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          setSelected(node.id === graph.me.id ? { kind: 'me', id: node.id } : { kind: 'goal', id: node.id });
          openContextMenu({
            kind: node.id === graph.me.id ? 'me' : 'goal',
            id: node.id,
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          setSelected({ kind: 'edge', id: edge.id });
          openContextMenu({ kind: 'edge', id: edge.id, x: event.clientX, y: event.clientY });
        }}
        onConnect={(connection: Connection) => {
          if (!connection.source || !connection.target || connection.target === graph.me.id) return;
          handleConnect(connection.source, connection.target);
        }}
        onNodeDrag={(_, node) => {
          simulationRef.current?.pinNode(node.id, node.position.x, node.position.y);
        }}
        onNodeDragStop={(_, node) => {
          simulationRef.current?.releaseNode(node.id);
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          closeContextMenu();
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} />
        <Controls />
      </ReactFlow>

      {contextMenu && contextItems.length > 0 ? (
        <GoalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItems}
          onClose={closeContextMenu}
        />
      ) : null}

      {selectedGoal ? (
        <GoalDetailPanel
          goal={selectedGoal}
          status={deriveGoalDisplayStatus(selectedGoal.id)}
          inEdges={getInEdges(selectedGoal.id)}
          outEdges={getOutEdges(selectedGoal.id)}
          onClose={() => setSelected(null)}
          onJumpEdge={(edgeId) => setSelected({ kind: 'edge', id: edgeId })}
          hopDistance={getHopDistance(selectedGoal.id)}
          onUpdate={(patch) => {
            const result = updateGoal({ goalId: selectedGoal.id, ...patch });
            if (!result.ok) {
              return notifyResult(result);
            }
            if (patch.completionRule) {
              const nextMode = patch.completionRule.every((clause) => clause.length === 1) ? 'OR' : 'AND';
              console.log('[goals] completionRule updated', {
                goalId: selectedGoal.id,
                previous: selectedGoal.completionRule,
                next: patch.completionRule,
              });
              toast({ title: `完成条件已更新为 ${nextMode}` });
              return true;
            }
            return notifyResult(result, '已更新目标');
          }}
        />
      ) : null}

      {selectedEdge ? (
        <EdgeDetailPanel
          edge={selectedEdge}
          status={getEdgeStatus(selectedEdge.id)}
          targetStatus={deriveGoalDisplayStatus(selectedEdge.target)}
          sourceLabel={selectedEdge.source === graph.me.id ? graph.me.name : graph.goals.find((goal) => goal.id === selectedEdge.source)?.title || '待命名'}
          targetLabel={graph.goals.find((goal) => goal.id === selectedEdge.target)?.title || '待命名'}
          onClose={() => setSelected(null)}
          onJumpNode={(nodeId) => setSelected(nodeId === graph.me.id ? { kind: 'me', id: nodeId } : { kind: 'goal', id: nodeId })}
          onUpdate={(patch) => notifyResult(updateEdge({ edgeId: selectedEdge.id, ...patch }), '已更新路径')}
          onSetOverride={(status) => {
            setEdgeStatusOverride(selectedEdge.id, status);
            toast({ title: `[开发者] 边状态已设为 ${status}` });
          }}
          onClearOverride={() => {
            if (edgeOverrides.has(selectedEdge.id)) {
              clearEdgeStatusOverride(selectedEdge.id);
              toast({ title: '[开发者] 已清除状态覆盖' });
            }
          }}
        />
      ) : null}

      {selected?.kind === 'me' ? (
        <MeDetailPanel
          name={graph.me.name}
          goalsCount={graph.goals.length}
          onClose={() => setSelected(null)}
          onUpdate={(name) => notifyResult(updateMe(name), '已更新 Me')}
        />
      ) : null}

      <CancelGoalDialog
        open={Boolean(cancelGoalId)}
        goalTitle={graph.goals.find((goal) => goal.id === cancelGoalId)?.title ?? ''}
        onCancel={() => setCancelGoalId(null)}
        onConfirm={() => {
          if (!cancelGoalId) return;
          const result = cancelGoal({ goalId: cancelGoalId });
          if (notifyResult(result, '目标已取消')) {
            setSelected(null);
            setCancelGoalId(null);
          }
        }}
      />
    </div>
  );
}
