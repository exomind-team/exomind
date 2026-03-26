import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { getTaskService } from '@/lib/services/task.service';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import {
  deriveGoalDisplayStatus as deriveGoalDisplayStatusLogic,
  getEdgeStatus as getEdgeStatusLogic,
  getHopDistance as getHopDistanceLogic,
  getInEdges as getInEdgesLogic,
} from './goal-logic';
import { GoalForceSimulation, type PositionMap } from './goal-force-layout';
import { useGoalStore } from './goal-store';
import type { TaskEdgeStatus } from './goal-types';
import { CancelGoalDialog } from './components/CancelGoalDialog';
import { EdgeDetailPanel } from './components/EdgeDetailPanel';
import { GoalContextMenu } from './components/GoalContextMenu';
import { GoalDetailPanel } from './components/GoalDetailPanel';
import { GOAL_NODE_SIZE, GoalFlowNode, ME_NODE_SIZE, type GoalFlowNodeData } from './components/GoalFlowNode';
import { MeDetailPanel } from './components/MeDetailPanel';
import { SplitEdgeDialog } from './components/SplitEdgeDialog';
import { TaskFlowEdge, type TaskFlowEdgeData } from './components/TaskFlowEdge';
import { useConnectMode } from './hooks/useConnectMode';
import { useContextMenu } from './hooks/useContextMenu';

type GoalPageMode = 'browse' | 'edit';
type Selection = { kind: 'goal' | 'edge' | 'me'; id: string } | null;

const MODE_STORAGE_KEY = 'exomind:goals-mode';
const SHOW_CANCELLED_STORAGE_KEY = 'exomind:goals-show-cancelled';
const GUIDE_HIDDEN_STORAGE_KEY = 'exomind:goals-guide-hidden';
const COMPLETION_ABSORB_DURATION_MS = 520;
const COMPLETION_ME_PULSE_DURATION_MS = 320;
const COMPLETION_ABSORB_NODE_SIZE = 72;

interface CompletionAbsorptionAnimation {
  goalId: string;
  title: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

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

const HOP_RING_SPACING = 152;

function GoalHopRings({
  centerX,
  centerY,
  maxHop,
  viewportX,
  viewportY,
  zoom,
}: {
  centerX: number;
  centerY: number;
  maxHop: number;
  viewportX: number;
  viewportY: number;
  zoom: number;
}) {
  if (maxHop < 1) return null;

  return (
    <svg
      data-testid="goals-hop-rings"
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
      style={{
        transform: `translate(${viewportX}px, ${viewportY}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }}
    >
      <defs>
        <radialGradient id="goal-hop-ring-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(199,91,58,0.10)" />
          <stop offset="70%" stopColor="rgba(199,91,58,0.03)" />
          <stop offset="100%" stopColor="rgba(199,91,58,0)" />
        </radialGradient>
      </defs>
      <circle cx={centerX} cy={centerY} r={Math.max(HOP_RING_SPACING * maxHop, 120)} fill="url(#goal-hop-ring-glow)" />
      {Array.from({ length: maxHop }, (_, index) => {
        const hop = index + 1;
        const radius = hop * HOP_RING_SPACING;
        return (
          <g key={hop} data-testid={`goals-hop-ring-${hop}`}>
            <circle
              cx={centerX}
              cy={centerY}
              r={radius}
              fill="none"
              stroke={hop === 1 ? 'rgba(199,91,58,0.22)' : 'rgba(168,162,158,0.26)'}
              strokeWidth={hop === 1 ? 1.6 : 1}
              strokeDasharray={hop === 1 ? '0' : '5 10'}
            />
            <text
              x={centerX}
              y={Math.max(centerY - radius + 18, 24)}
              fill="rgba(120,113,108,0.8)"
              fontSize="11"
              textAnchor="middle"
            >
              {hop} 跳
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function GoalCompletionEffects({
  animations,
  meCenterX,
  meCenterY,
  mePulseActive,
  viewportX,
  viewportY,
  zoom,
}: {
  animations: CompletionAbsorptionAnimation[];
  meCenterX: number;
  meCenterY: number;
  mePulseActive: boolean;
  viewportX: number;
  viewportY: number;
  zoom: number;
}) {
  if (animations.length === 0 && !mePulseActive) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[9]"
      style={{
        transform: `translate(${viewportX}px, ${viewportY}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }}
    >
      <style>
        {`
          @keyframes goal-completion-absorb {
            0% {
              transform: translate(var(--goal-absorb-from-x), var(--goal-absorb-from-y)) scale(1);
              opacity: 1;
            }
            72% {
              opacity: 1;
            }
            100% {
              transform: translate(var(--goal-absorb-to-x), var(--goal-absorb-to-y)) scale(0.2);
              opacity: 0;
            }
          }

          @keyframes goal-completion-trail {
            0% {
              opacity: 0.68;
              transform: scaleX(1);
            }
            100% {
              opacity: 0;
              transform: scaleX(0.18);
            }
          }

          @keyframes goal-me-pulse {
            0% {
              transform: scale(0.78);
              opacity: 0;
            }
            30% {
              opacity: 0.82;
            }
            100% {
              transform: scale(1.32);
              opacity: 0;
            }
          }
        `}
      </style>

      {animations.map((animation) => {
        const deltaX = animation.toX - animation.fromX;
        const deltaY = animation.toY - animation.fromY;
        const distance = Math.hypot(deltaX, deltaY);
        const angle = Math.atan2(deltaY, deltaX);
        const absorbStyle = {
          width: `${COMPLETION_ABSORB_NODE_SIZE}px`,
          height: `${COMPLETION_ABSORB_NODE_SIZE}px`,
          ['--goal-absorb-from-x' as string]: `${animation.fromX - COMPLETION_ABSORB_NODE_SIZE / 2}px`,
          ['--goal-absorb-from-y' as string]: `${animation.fromY - COMPLETION_ABSORB_NODE_SIZE / 2}px`,
          ['--goal-absorb-to-x' as string]: `${animation.toX - COMPLETION_ABSORB_NODE_SIZE / 2}px`,
          ['--goal-absorb-to-y' as string]: `${animation.toY - COMPLETION_ABSORB_NODE_SIZE / 2}px`,
          animation: `goal-completion-absorb ${COMPLETION_ABSORB_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1) forwards`,
        } as CSSProperties;

        return (
          <div key={animation.goalId}>
            <div
              className="absolute h-[2px] origin-left rounded-full bg-[linear-gradient(90deg,rgba(199,91,58,0.72),rgba(199,91,58,0.08))]"
              style={{
                left: `${animation.fromX}px`,
                top: `${animation.fromY}px`,
                width: `${distance}px`,
                transform: `rotate(${angle}rad)`,
                animation: `goal-completion-trail ${COMPLETION_ABSORB_DURATION_MS}ms ease-out forwards`,
              }}
            />
            <div
              data-testid={`goals-completion-absorption-${animation.goalId}`}
              className="absolute flex items-center justify-center rounded-full border border-[#F5C7B8] bg-[radial-gradient(circle_at_30%_30%,rgba(125,211,252,0.95),rgba(59,130,246,0.86)_55%,rgba(79,70,229,0.88))] px-3 text-center text-[11px] font-semibold leading-tight text-white shadow-[0_18px_40px_-18px_rgba(59,130,246,0.9),0_0_0_1px_rgba(255,255,255,0.25)]"
              style={absorbStyle}
            >
              <span className="max-w-[52px] truncate">{animation.title || '待命名'}</span>
            </div>
          </div>
        );
      })}

      {mePulseActive ? (
        <div
          data-testid="goals-me-pulse"
          className="absolute rounded-full border border-[#FDBA74]/70 bg-[radial-gradient(circle,rgba(251,191,36,0.22),rgba(251,146,60,0.10)_58%,rgba(251,146,60,0))] shadow-[0_0_36px_rgba(251,146,60,0.28)]"
          style={{
            left: `${meCenterX - 62}px`,
            top: `${meCenterY - 62}px`,
            width: '124px',
            height: '124px',
            animation: `goal-me-pulse ${COMPLETION_ME_PULSE_DURATION_MS}ms ease-out forwards`,
          }}
        />
      ) : null}
    </div>
  );
}

export function GoalsPage() {
  const graph = useGoalStore((state) => state.graph);
  const edgeOverrides = useGoalStore((state) => state.edgeOverrides);
  const getOutEdges = useGoalStore((state) => state.getOutEdges);
  const createGoal = useGoalStore((state) => state.createGoal);
  const createEdge = useGoalStore((state) => state.createEdge);
  const reconnectEdge = useGoalStore((state) => state.reconnectEdge);
  const cancelGoal = useGoalStore((state) => state.cancelGoal);
  const deleteEdge = useGoalStore((state) => state.deleteEdge);
  const splitEdge = useGoalStore((state) => state.splitEdge);
  const updateGoal = useGoalStore((state) => state.updateGoal);
  const updateEdge = useGoalStore((state) => state.updateEdge);
  const setEdgeStatusOverride = useGoalStore((state) => state.setEdgeStatusOverride);
  const clearEdgeStatusOverride = useGoalStore((state) => state.clearEdgeStatusOverride);
  const updateMe = useGoalStore((state) => state.updateMe);
  const isDesktop = useIsDesktop();

  const [positions, setPositions] = useState<PositionMap>(new Map());
  const [taskMetaById, setTaskMetaById] = useState<Map<string, { title: string; status: TaskEdgeStatus }>>(() => new Map());
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [mode, setMode] = useState<GoalPageMode>(() => readModeStorage());
  const [showCancelled, setShowCancelled] = useState(() => readBooleanStorage(SHOW_CANCELLED_STORAGE_KEY, false));
  const [guideHidden, setGuideHidden] = useState(() => readBooleanStorage(GUIDE_HIDDEN_STORAGE_KEY, false));
  const [selected, setSelected] = useState<Selection>(null);
  const [cancelGoalId, setCancelGoalId] = useState<string | null>(null);
  const [cancelCascadeInTasks, setCancelCascadeInTasks] = useState(false);
  const [cancelCascadeOutTasks, setCancelCascadeOutTasks] = useState(false);
  const [splitEdgeId, setSplitEdgeId] = useState<string | null>(null);
  const [splitInsertMode, setSplitInsertMode] = useState<'new' | 'existing'>('new');
  const [splitExistingGoalId, setSplitExistingGoalId] = useState('');
  const [splitNewGoalTitle, setSplitNewGoalTitle] = useState('');
  const [splitOriginalEdgePlacement, setSplitOriginalEdgePlacement] = useState<'first-half' | 'second-half'>('second-half');
  const [highlightedEdgeIds, setHighlightedEdgeIds] = useState<string[]>([]);
  const [completionAnimations, setCompletionAnimations] = useState<CompletionAbsorptionAnimation[]>([]);
  const [mePulseActive, setMePulseActive] = useState(false);
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();
  const connectMode = useConnectMode();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const simulationRef = useRef<GoalForceSimulation | null>(null);
  const highlightTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const completionTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mePulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousGoalStatusesRef = useRef<Map<string, string>>(new Map());

  const updateConnectPreview = useCallback((clientX: number, clientY: number) => {
    const bounds = pageRef.current?.getBoundingClientRect();
    if (!bounds) return;
    connectMode.updatePreviewPoint({
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    });
  }, [connectMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeContextMenu();
      connectMode.cancel();
      setCancelGoalId(null);
      setCancelCascadeInTasks(false);
      setCancelCascadeOutTasks(false);
      setSplitEdgeId(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeContextMenu, connectMode]);

  useEffect(() => () => {
    highlightTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    highlightTimeoutsRef.current.clear();
    completionTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    completionTimeoutsRef.current.clear();
    if (mePulseTimeoutRef.current) {
      clearTimeout(mePulseTimeoutRef.current);
      mePulseTimeoutRef.current = null;
    }
  }, []);

  const triggerMePulse = useCallback(() => {
    setMePulseActive(true);
    if (mePulseTimeoutRef.current) {
      clearTimeout(mePulseTimeoutRef.current);
    }
    mePulseTimeoutRef.current = setTimeout(() => {
      setMePulseActive(false);
      mePulseTimeoutRef.current = null;
    }, COMPLETION_ME_PULSE_DURATION_MS);
  }, []);

  useEffect(() => {
    const taskService = getTaskService();
    let cancelled = false;

    async function syncTaskMeta() {
      const tasks = await taskService.listTasks(true);
      if (cancelled) return;
      const nextTaskMeta = new Map(tasks.map((task) => [task.id, { title: task.title, status: task.status }]));
      setTaskMetaById((current) => {
        if (current.size !== nextTaskMeta.size) return nextTaskMeta;
        for (const [taskId, taskMeta] of nextTaskMeta) {
          const currentMeta = current.get(taskId);
          if (!currentMeta || currentMeta.title !== taskMeta.title || currentMeta.status !== taskMeta.status) {
            return nextTaskMeta;
          }
        }
        return current;
      });
    }

    void syncTaskMeta();
    const unsubscribe = taskService.onTaskChange(() => {
      void syncTaskMeta();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const visibleGraph = useMemo(() => ({
    ...graph,
    goals: showCancelled ? graph.goals : graph.goals.filter((goal) => !goal.cancelled),
    edges: buildVisibleEdges(graph, showCancelled),
  }), [graph, showCancelled]);

  const getTaskStatusByRef = useCallback((taskNodeRef: string) => (
    taskMetaById.get(taskNodeRef)?.status
  ), [taskMetaById]);

  const getTaskTitleByRef = useCallback((taskNodeRef: string) => (
    taskMetaById.get(taskNodeRef)?.title
  ), [taskMetaById]);

  const resolveEdgeStatus = useCallback((edgeId: string) => {
    const edge = graph.edges.find((item) => item.id === edgeId);
    if (!edge) return 'pending';
    return getEdgeStatusLogic(edge, {
      edgeOverrides,
      getTaskStatus: getTaskStatusByRef,
    });
  }, [edgeOverrides, getTaskStatusByRef, graph.edges]);

  const resolveGoalStatus = useCallback((goalId: string) => {
    const goal = graph.goals.find((item) => item.id === goalId);
    if (!goal) return 'pending';
    return deriveGoalDisplayStatusLogic(goal, getInEdgesLogic(graph, goalId), {
      graph,
      edgeOverrides,
      getTaskStatus: getTaskStatusByRef,
    });
  }, [edgeOverrides, getTaskStatusByRef, graph]);

  const resolveHopDistance = useCallback((goalId: string) => (
    getHopDistanceLogic(graph, goalId, {
      edgeOverrides,
      getTaskStatus: getTaskStatusByRef,
    })
  ), [edgeOverrides, getTaskStatusByRef, graph]);

  const resolveEdgeLabel = useCallback((edgeId: string) => {
    const edge = graph.edges.find((item) => item.id === edgeId);
    if (!edge) return '待定义';
    if (edge.title) return edge.title;
    if (edge.taskNodeRef) return getTaskTitleByRef(edge.taskNodeRef) || edge.taskNodeRef;
    return '待定义';
  }, [getTaskTitleByRef, graph.edges]);

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
        connectModeTargetable: false,
        connectModeHovering: false,
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
        status: resolveGoalStatus(goal.id),
        isAbsorbing: completionAnimations.some((animation) => animation.goalId === goal.id),
        editMode: mode === 'edit',
        hasEmptyRule: goal.completionRule.length === 0,
        connectModeTargetable: connectMode.isActive && goal.id !== connectMode.sourceId,
        connectModeHovering: connectMode.hoverTargetId === goal.id,
        onConnectHoverChange: (hovering: boolean) => {
          if (!connectMode.isActive || goal.id === connectMode.sourceId) return;
          connectMode.setHoverTarget(hovering ? goal.id : null);
        },
        onOpenContextMenu: (nodeId: string, x: number, y: number) => {
          setSelected({ kind: 'goal', id: nodeId });
          openContextMenu({ kind: 'goal', id: nodeId, x, y });
        },
      },
      draggable: mode === 'browse',
    }));

    return [meNode, ...goalNodes];
  }, [completionAnimations, connectMode, graph.me.id, graph.me.name, mode, openContextMenu, positions, resolveGoalStatus, visibleGraph.goals]);

  const edges = useMemo<Array<Edge<TaskFlowEdgeData>>>(() => {
    const edgesByPair = new Map<string, Array<{ id: string }>>();
    for (const edge of visibleGraph.edges) {
      const key = `${edge.source}::${edge.target}`;
      const current = edgesByPair.get(key) ?? [];
      current.push({ id: edge.id });
      edgesByPair.set(key, current);
    }

    return visibleGraph.edges.map((edge) => {
      const siblings = edgesByPair.get(`${edge.source}::${edge.target}`) ?? [{ id: edge.id }];
      const parallelIndex = siblings.findIndex((candidate) => candidate.id === edge.id);
      const sourceGoal = edge.source === graph.me.id ? null : graph.goals.find((goal) => goal.id === edge.source);
      const targetGoal = graph.goals.find((goal) => goal.id === edge.target);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'task',
        selectable: true,
        data: {
          label: resolveEdgeLabel(edge.id),
          status: resolveEdgeStatus(edge.id),
          isEmptySlot: !edge.taskNodeRef,
          isZombie: Boolean(showCancelled && (sourceGoal?.cancelled || targetGoal?.cancelled)),
          highlighted: highlightedEdgeIds.includes(edge.id),
          parallelIndex,
          parallelTotal: siblings.length,
          onOpenContextMenu: (edgeId: string, x: number, y: number) => {
            setSelected({ kind: 'edge', id: edgeId });
            openContextMenu({ kind: 'edge', id: edgeId, x, y });
          },
        },
      };
    });
  }, [graph.goals, highlightedEdgeIds, openContextMenu, resolveEdgeLabel, resolveEdgeStatus, showCancelled, visibleGraph.edges]);

  const connectPreview = useMemo(() => {
    if (!connectMode.isActive || !connectMode.sourceId || !connectMode.previewPoint) return null;

    const sourcePosition = positions.get(connectMode.sourceId);
    if (!sourcePosition) return null;

    const sourceSize = connectMode.sourceId === graph.me.id ? ME_NODE_SIZE : GOAL_NODE_SIZE;

    return {
      x1: sourcePosition.x + sourceSize / 2,
      y1: sourcePosition.y + sourceSize / 2,
      x2: connectMode.previewPoint.x,
      y2: connectMode.previewPoint.y,
    };
  }, [connectMode, graph.me.id, positions]);

  const hopRingMetrics = useMemo(() => {
    const finiteDistances = visibleGraph.goals
      .map((goal) => resolveHopDistance(goal.id))
      .filter((distance) => Number.isFinite(distance));

    if (finiteDistances.length === 0) return null;

    const mePosition = positions.get(graph.me.id) ?? { x: 0, y: 0 };
    return {
      centerX: mePosition.x + ME_NODE_SIZE / 2,
      centerY: mePosition.y + ME_NODE_SIZE / 2,
      maxHop: Math.max(...finiteDistances),
    };
  }, [graph.me.id, positions, resolveHopDistance, visibleGraph.goals]);

  const meCenter = useMemo(() => {
    const mePosition = positions.get(graph.me.id) ?? { x: 0, y: 0 };
    return {
      x: mePosition.x + ME_NODE_SIZE / 2,
      y: mePosition.y + ME_NODE_SIZE / 2,
    };
  }, [graph.me.id, positions]);

  const emptyStateGuideStyle = useMemo(() => {
    const mePosition = positions.get(graph.me.id) ?? { x: 0, y: 0 };
    return {
      left: `${Math.round(mePosition.x + ME_NODE_SIZE + 26)}px`,
      top: `${Math.round(mePosition.y + ME_NODE_SIZE / 2 - 24)}px`,
    };
  }, [graph.me.id, positions]);

  const goalStatusSnapshot = useMemo(
    () => visibleGraph.goals.map((goal) => ({
      id: goal.id,
      status: resolveGoalStatus(goal.id),
      inboundEdgeIds: visibleGraph.edges
        .filter((edge) => edge.target === goal.id)
        .map((edge) => edge.id),
    })),
    [resolveGoalStatus, visibleGraph.edges, visibleGraph.goals],
  );

  const selectedGoal = selected?.kind === 'goal'
    ? graph.goals.find((goal) => goal.id === selected.id) ?? null
    : null;
  const selectedEdge = selected?.kind === 'edge'
    ? graph.edges.find((edge) => edge.id === selected.id) ?? null
    : null;
  const splitTargetEdge = splitEdgeId
    ? graph.edges.find((edge) => edge.id === splitEdgeId) ?? null
    : null;
  const availableSplitGoals = useMemo(() => {
    if (!splitTargetEdge) return [];
    return graph.goals.filter((goal) => (
      goal.id !== splitTargetEdge.source
      && goal.id !== splitTargetEdge.target
      && !goal.cancelled
      && resolveGoalStatus(goal.id) !== 'completed'
    ));
  }, [graph.goals, resolveGoalStatus, splitTargetEdge]);

  function notifyResult(
    result: { ok: false; error: string } | { ok: true },
    success?: string,
    failureTitle = '操作失败',
  ) {
    if (!result.ok) {
      toast({ title: failureTitle, description: result.error });
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

  function handleReconnect(oldEdge: Edge, source?: string, target?: string) {
    if (!source || !target || target === graph.me.id) return;
    const result = reconnectEdge({
      edgeId: oldEdge.id,
      newSource: source,
      newTarget: target,
      rulePosition: { clauseIndex: 0 },
    });
    if (!notifyResult(result, result.ok && !result.value.autoAddedEdgeId ? '已更新连接' : undefined)) return;
    if (!result.ok) return;
    if (result.value.autoAddedEdgeId) {
      flashEdge(result.value.autoAddedEdgeId);
      toast({ title: '已自动添加连接以保持目标可达' });
    }
    setSelected({ kind: 'edge', id: result.value.edge.id });
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

  function resetSplitDialog() {
    setSplitEdgeId(null);
    setSplitInsertMode('new');
    setSplitExistingGoalId('');
    setSplitNewGoalTitle('');
    setSplitOriginalEdgePlacement('second-half');
  }

  useLayoutEffect(() => {
    const currentStatuses = new Map<string, string>();
    for (const item of goalStatusSnapshot) {
      currentStatuses.set(item.id, item.status);
    }

    if (previousGoalStatusesRef.current.size === 0) {
      previousGoalStatusesRef.current = currentStatuses;
      return;
    }

    const edgesToFlash = new Set<string>();
    const completedGoalsToAnimate: CompletionAbsorptionAnimation[] = [];
    for (const item of goalStatusSnapshot) {
      const previousStatus = previousGoalStatusesRef.current.get(item.id);
      const nextStatus = currentStatuses.get(item.id);
      if (!previousStatus || !nextStatus || previousStatus === nextStatus) continue;
      for (const edgeId of item.inboundEdgeIds) {
        edgesToFlash.add(edgeId);
      }
      if (previousStatus !== 'completed' && nextStatus === 'completed') {
        const goalPosition = positions.get(item.id);
        if (!goalPosition) continue;
        const goal = graph.goals.find((candidate) => candidate.id === item.id);
        completedGoalsToAnimate.push({
          goalId: item.id,
          title: goal?.title || '',
          fromX: goalPosition.x + GOAL_NODE_SIZE / 2,
          fromY: goalPosition.y + GOAL_NODE_SIZE / 2,
          toX: meCenter.x,
          toY: meCenter.y,
        });
      }
    }

    edgesToFlash.forEach((edgeId) => {
      setHighlightedEdgeIds((current) => (current.includes(edgeId) ? current : [...current, edgeId]));
      const existing = highlightTimeoutsRef.current.get(edgeId);
      if (existing) clearTimeout(existing);
      const timeoutId = setTimeout(() => {
        setHighlightedEdgeIds((current) => current.filter((candidate) => candidate !== edgeId));
        highlightTimeoutsRef.current.delete(edgeId);
      }, 320);
      highlightTimeoutsRef.current.set(edgeId, timeoutId);
    });

    if (completedGoalsToAnimate.length > 0) {
      setCompletionAnimations((current) => {
        const activeGoalIds = new Set(current.map((animation) => animation.goalId));
        return [
          ...current,
          ...completedGoalsToAnimate.filter((animation) => !activeGoalIds.has(animation.goalId)),
        ];
      });

      completedGoalsToAnimate.forEach((animation) => {
        const existing = completionTimeoutsRef.current.get(animation.goalId);
        if (existing) {
          clearTimeout(existing);
        }
        const timeoutId = setTimeout(() => {
          setCompletionAnimations((current) => current.filter((candidate) => candidate.goalId !== animation.goalId));
          completionTimeoutsRef.current.delete(animation.goalId);
          triggerMePulse();
        }, COMPLETION_ABSORB_DURATION_MS);
        completionTimeoutsRef.current.set(animation.goalId, timeoutId);
      });
    }

    previousGoalStatusesRef.current = currentStatuses;
  }, [goalStatusSnapshot, graph.goals, meCenter.x, meCenter.y, positions, triggerMePulse]);

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
      const goalStatus = resolveGoalStatus(contextMenu.id);
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
        {
          key: 'cancel',
          label: '取消目标',
          danger: true,
          onSelect: () => {
            setCancelCascadeInTasks(false);
            setCancelCascadeOutTasks(false);
            setCancelGoalId(contextMenu.id);
          },
        },
      ];
    }
    const edge = graph.edges.find((item) => item.id === contextMenu.id);
    const targetCompleted = edge ? resolveGoalStatus(edge.target) === 'completed' : false;
    return [
      { key: 'detail', label: '详情', onSelect: () => setSelected({ kind: 'edge', id: contextMenu.id }) },
      ...(!targetCompleted ? [{
        key: 'split',
        label: '拆解',
        onSelect: () => {
          setSplitEdgeId(contextMenu.id);
          setSplitInsertMode('new');
          setSplitExistingGoalId('');
          setSplitNewGoalTitle('');
          setSplitOriginalEdgePlacement('second-half');
        },
      }] : []),
      ...(!targetCompleted ? [{
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
      }] : []),
    ];
  }, [connectMode, contextMenu, deleteEdge, graph.edges, graph.goals, resolveGoalStatus]);

  return (
    <div
      ref={pageRef}
      data-testid="goals-page"
      className={cn(
        'relative h-[calc(100vh-5rem)] overflow-hidden rounded-[32px] border border-[#E7E5E4] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]',
        connectMode.isActive && 'cursor-crosshair',
      )}
      onMouseMove={(event) => {
        if (!connectMode.isActive) return;
        updateConnectPreview(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (!connectMode.isActive) return;
        updateConnectPreview(event.clientX, event.clientY);
      }}
    >
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

      {hopRingMetrics ? (
        <GoalHopRings
          centerX={hopRingMetrics.centerX}
          centerY={hopRingMetrics.centerY}
          maxHop={hopRingMetrics.maxHop}
          viewportX={viewport.x}
          viewportY={viewport.y}
          zoom={viewport.zoom}
        />
      ) : null}

      <GoalCompletionEffects
        animations={completionAnimations}
        meCenterX={meCenter.x}
        meCenterY={meCenter.y}
        mePulseActive={mePulseActive}
        viewportX={viewport.x}
        viewportY={viewport.y}
        zoom={viewport.zoom}
      />

      {connectPreview ? (
        <svg
          data-testid="goals-connect-preview"
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        >
          <line
            x1={connectPreview.x1}
            y1={connectPreview.y1}
            x2={connectPreview.x2}
            y2={connectPreview.y2}
            stroke="#C75B3A"
            strokeWidth="2.5"
            strokeDasharray="8 6"
            strokeLinecap="round"
            opacity="0.95"
          />
          <circle cx={connectPreview.x1} cy={connectPreview.y1} r="4" fill="#C75B3A" opacity="0.85" />
        </svg>
      ) : null}

      {!guideHidden && graph.goals.length === 0 ? (
        <div
          data-testid="goals-empty-state-guide"
          className="pointer-events-none absolute z-10"
          style={emptyStateGuideStyle}
        >
          <div className="relative rounded-[24px] border border-[#F3D5C7] bg-[linear-gradient(180deg,rgba(255,251,247,0.95),rgba(252,244,238,0.92))] px-4 py-3 text-sm text-[#6B5B52] shadow-[0_18px_40px_-18px_rgba(120,113,108,0.45)] backdrop-blur dark:border-[#3F3F46] dark:bg-[#1C1917]/95 dark:text-[#D6D3D1]">
            <div className="absolute left-[-36px] top-1/2 h-px w-9 -translate-y-1/2 bg-gradient-to-r from-[#C75B3A]/80 to-[#C75B3A]/0" />
            <div className="absolute left-[-8px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-[#F3D5C7] bg-[#FFF7ED] shadow-sm dark:border-[#57534E] dark:bg-[#292524]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C75B3A]">起点</p>
            <p className="mt-1 whitespace-nowrap">
              {isDesktop ? '右键 Me 添加你的第一个目标' : '长按 Me 添加你的第一个目标'}
            </p>
          </div>
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
        edgesReconnectable={mode === 'edit'}
        zoomOnDoubleClick={false}
        onMove={(_, nextViewport) => setViewport(nextViewport)}
        onInit={(instance) => setViewport(instance.getViewport())}
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
            if (node.id === graph.me.id) return;
            handleConnect(connectMode.sourceId as string, node.id);
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
          updateConnectPreview(event.clientX, event.clientY);
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
        onReconnect={(oldEdge, connection) => {
          handleReconnect(oldEdge, connection.source, connection.target);
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
          status={resolveGoalStatus(selectedGoal.id)}
          inEdges={getInEdgesLogic(graph, selectedGoal.id)}
          outEdges={getOutEdges(selectedGoal.id)}
          edgeLabelById={Object.fromEntries(
            [...getInEdgesLogic(graph, selectedGoal.id), ...getOutEdges(selectedGoal.id)].map((edge) => [
              edge.id,
              resolveEdgeLabel(edge.id),
            ]),
          )}
          onClose={() => setSelected(null)}
          onJumpEdge={(edgeId) => setSelected({ kind: 'edge', id: edgeId })}
          hopDistance={resolveHopDistance(selectedGoal.id)}
          onUpdate={(patch) => {
            const result = updateGoal({ goalId: selectedGoal.id, ...patch });
            if (!result.ok) {
              return notifyResult(result, undefined, '保存失败');
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
          status={resolveEdgeStatus(selectedEdge.id)}
          targetStatus={resolveGoalStatus(selectedEdge.target)}
          taskTitle={selectedEdge.taskNodeRef ? getTaskTitleByRef(selectedEdge.taskNodeRef) : undefined}
          sourceLabel={selectedEdge.source === graph.me.id ? graph.me.name : graph.goals.find((goal) => goal.id === selectedEdge.source)?.title || '待命名'}
          targetLabel={graph.goals.find((goal) => goal.id === selectedEdge.target)?.title || '待命名'}
          onClose={() => setSelected(null)}
          onJumpNode={(nodeId) => setSelected(nodeId === graph.me.id ? { kind: 'me', id: nodeId } : { kind: 'goal', id: nodeId })}
          onUpdate={(patch) => notifyResult(updateEdge({ edgeId: selectedEdge.id, ...patch }), '已更新路径', '保存失败')}
          onSetOverride={(status) => {
            const edgeLabel = resolveEdgeLabel(selectedEdge.id);
            setEdgeStatusOverride(selectedEdge.id, status);
            toast({ title: `[开发者] 边'${edgeLabel}'状态已设为 ${status}` });
          }}
          onClearOverride={() => {
            if (edgeOverrides.has(selectedEdge.id)) {
              const edgeLabel = resolveEdgeLabel(selectedEdge.id);
              clearEdgeStatusOverride(selectedEdge.id);
              toast({ title: `[开发者] 已清除边'${edgeLabel}'的状态覆盖` });
            }
          }}
        />
      ) : null}

      {selected?.kind === 'me' ? (
        <MeDetailPanel
          name={graph.me.name}
          goalsCount={graph.goals.length}
          onClose={() => setSelected(null)}
          onUpdate={(name) => notifyResult(updateMe(name), '已更新 Me', '保存失败')}
        />
      ) : null}

      <SplitEdgeDialog
        open={Boolean(splitTargetEdge)}
        availableGoals={availableSplitGoals}
        insertMode={splitInsertMode}
        existingGoalId={splitExistingGoalId}
        newGoalTitle={splitNewGoalTitle}
        originalEdgePlacement={splitOriginalEdgePlacement}
        onInsertModeChange={(mode) => {
          setSplitInsertMode(mode);
          if (mode === 'new') {
            setSplitExistingGoalId('');
          } else {
            setSplitNewGoalTitle('');
          }
        }}
        onExistingGoalIdChange={setSplitExistingGoalId}
        onNewGoalTitleChange={setSplitNewGoalTitle}
        onOriginalEdgePlacementChange={setSplitOriginalEdgePlacement}
        onCancel={resetSplitDialog}
        onConfirm={() => {
          if (!splitTargetEdge) return;
          const result = splitEdge({
            edgeId: splitTargetEdge.id,
            insertMode: splitInsertMode,
            existingGoalId: splitInsertMode === 'existing' ? splitExistingGoalId || undefined : undefined,
            newGoalTitle: splitInsertMode === 'new' ? splitNewGoalTitle : undefined,
            originalEdgePlacement: splitOriginalEdgePlacement,
            rulePosition: { clauseIndex: 0 },
          });
          if (!notifyResult(result, '已拆解路径')) return;
          if (!result.ok) return;
          setSelected({ kind: 'goal', id: result.value.midGoal.id });
          simulationRef.current?.reheat();
          resetSplitDialog();
        }}
      />

      <CancelGoalDialog
        open={Boolean(cancelGoalId)}
        goalTitle={graph.goals.find((goal) => goal.id === cancelGoalId)?.title ?? ''}
        cascadeInTasks={cancelCascadeInTasks}
        cascadeOutTasks={cancelCascadeOutTasks}
        onCascadeInTasksChange={setCancelCascadeInTasks}
        onCascadeOutTasksChange={setCancelCascadeOutTasks}
        onCancel={() => {
          setCancelGoalId(null);
          setCancelCascadeInTasks(false);
          setCancelCascadeOutTasks(false);
        }}
        onConfirm={() => {
          if (!cancelGoalId) return;
          const result = cancelGoal({
            goalId: cancelGoalId,
            cascadeInTasks: cancelCascadeInTasks,
            cascadeOutTasks: cancelCascadeOutTasks,
          });
          if (notifyResult(result, '目标已取消')) {
            setSelected(null);
            setCancelGoalId(null);
            setCancelCascadeInTasks(false);
            setCancelCascadeOutTasks(false);
          }
        }}
      />
    </div>
  );
}
