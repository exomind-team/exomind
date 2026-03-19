import { Waypoints } from 'lucide-react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type NodeProps as FlowNodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from '@/components/ui/toast-hook';
import { getTaskService, getTaskTimerService, getTimeBlockService } from '@/lib/services';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import {
  calculateTaskDagCollapseScope,
  type TaskDagVisibilityState,
  EMPTY_TASK_DAG_VISIBILITY_STATE,
  projectVisibleTaskGraph,
  type VisibleTaskGraph,
} from '@/lib/task/task-dag-visibility';
import { resolveActiveBlockTaskIds, type ActiveBlockData, type TimerConfig } from '@/lib/types/event';
import type { TaskNode, TaskStatus } from '@/lib/types/task';
import { MultiTaskEndDialog } from '@/ui/app/components/MultiTaskEndDialog';
import { TaskDagControlPanel } from '@/ui/app/components/TaskDagControlPanel';
import { TaskQuickCreateDialog } from '@/ui/app/components/TaskQuickCreateDialog';
import {
  TaskDagDetailPanel,
  type TaskDagDependencyItem,
} from '@/ui/app/components/TaskDagDetailPanel';
import { useIsDesktop } from '@/ui/app/hooks/useIsDesktop';
import { TaskDagModeSelector, type TaskDagMode } from '@/ui/app/components/TaskDagModeSelector';
import { TaskBreadcrumb } from '@/ui/app/components/TaskBreadcrumb';
import type { TaskStatusChoice } from '@/ui/app/components/TaskStatusSelector';
import {
  buildVisibleTaskDagFlow,
  TASK_DAG_NODE_HEIGHT,
  TASK_DAG_NODE_WIDTH,
  type TaskDagFlowEdge,
  type TaskDagFlowNode,
  type TaskDagFlowNodeData,
} from './task-dag-flow';
import { resolveDagDirection, type DagDirection } from './task-dag-layout';
import { extractTaskTitleSearchQuery, filterTasksByTitleFuzzySearch } from './task-title-fuzzy-search';
import { TASKS_LAST_PATH_KEY } from './task-route-memory';

type DagConnectType = 'hard' | 'soft';
type DagConnectState = { sourceId: string; type: DagConnectType } | null;

const TASK_DAG_MODE_STORAGE_KEY = 'exomind:dag-mode';
const TASK_DAG_DIRECTION_STORAGE_KEY = 'exomind:dag-direction';

function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

function buildExecutionHint(task: TaskNode, isBlocked: boolean, isExecutable: boolean): string {
  if (task.status === 'completed') {
    return '该任务已经完成，可双击进入详情页回顾依赖关系与时间记录。';
  }
  if (task.status === 'cancelled') {
    return '该任务已经取消，如需继续推进，请先在任务详情页中调整任务状态。';
  }
  if (task.status === 'in_progress') {
    return '该任务正在推进中，可在详情页继续查看时间块、依赖与执行记录。';
  }
  if (task.status === 'suspended') {
    return isExecutable
      ? '该任务已挂起，但当前依赖已满足，可恢复执行。'
      : '该任务已挂起，且仍受前置依赖限制，暂不适合恢复执行。';
  }
  if (isBlocked) {
    return '该任务目前仍被前置任务阻塞，需先完成对应依赖后才能启动。';
  }
  if (isExecutable) {
    return '该任务当前可执行，可继续在后续执行模式中直接发起时间块。';
  }
  return '该任务暂未开始，建议先确认依赖、估时与执行策略。';
}

function buildUpstreamDependencies(task: TaskNode, taskById: ReadonlyMap<string, TaskNode>): TaskDagDependencyItem[] {
  return task.dependsOn.map((dependency) => ({
    taskId: dependency.taskId,
    title: taskById.get(dependency.taskId)?.title ?? dependency.taskId,
    type: dependency.type,
  }));
}

function buildDownstreamDependencies(taskId: string, tasks: TaskNode[]): TaskDagDependencyItem[] {
  return tasks.flatMap((task) => task.dependsOn
    .filter((dependency) => dependency.taskId === taskId)
    .map((dependency) => ({
      taskId: task.id,
      title: task.title,
      type: dependency.type,
    })));
}

function readStoredDagMode(): TaskDagMode {
  if (typeof window === 'undefined') return 'browse';

  try {
    const saved = window.localStorage.getItem(TASK_DAG_MODE_STORAGE_KEY);
    if (saved === 'connect' || saved === 'execute') {
      return saved;
    }
  } catch {
    // Ignore storage failures and fall back to browse mode.
  }

  return 'browse';
}

function readStoredDagDirection(): DagDirection {
  if (typeof window === 'undefined') return 'auto';

  try {
    const saved = window.localStorage.getItem(TASK_DAG_DIRECTION_STORAGE_KEY);
    if (saved === 'TB' || saved === 'LR' || saved === 'auto') {
      return saved;
    }
  } catch {
    // Ignore storage failures and fall back to auto direction.
  }

  return 'auto';
}

function resolveConnectTypeFromEvent(event: unknown): DagConnectType {
  if (
    event
    && typeof event === 'object'
    && 'shiftKey' in event
    && Boolean((event as { shiftKey?: boolean }).shiftKey)
  ) {
    return 'soft';
  }

  return 'hard';
}

function isPaneInteractionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest('.react-flow__node') || target.closest('[data-testid^="mock-react-flow-node-"]')) {
    return false;
  }

  return Boolean(
    target.closest('.react-flow__pane')
    || target.closest('[data-testid="mock-react-flow-pane"]')
    || target.closest('[data-testid="mock-react-flow-pane-double"]')
    || target.closest('[data-testid="mock-react-flow-pane-context"]'),
  );
}

function buildBlockedReason(task: TaskNode, taskById: ReadonlyMap<string, TaskNode>): string | null {
  const incompleteHardDependencies = task.dependsOn
    .filter((dependency) => dependency.type === 'hard')
    .map((dependency) => {
      const predecessor = taskById.get(dependency.taskId);
      if (!predecessor || predecessor.status === 'completed') {
        return null;
      }
      return predecessor.title;
    })
    .filter((title): title is string => title !== null);

  const pendingSoftDependencies = task.dependsOn
    .filter((dependency) => dependency.type === 'soft')
    .map((dependency) => {
      const predecessor = taskById.get(dependency.taskId);
      if (!predecessor || predecessor.status !== 'pending') {
        return null;
      }
      return predecessor.title;
    })
    .filter((title): title is string => title !== null);

  const reasons: string[] = [];
  if (incompleteHardDependencies.length > 0) {
    reasons.push(`硬依赖未完成：${incompleteHardDependencies.join('、')}`);
  }
  if (pendingSoftDependencies.length > 0) {
    reasons.push(`软依赖尚未开始：${pendingSoftDependencies.join('、')}`);
  }

  return reasons.length > 0 ? reasons.join('；') : null;
}

function formatDependencyMutationError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  const normalized = message.toLowerCase();

  if (normalized.includes('cycle')) {
    return '不允许循环依赖';
  }
  if (normalized.includes('not found')) {
    return '依赖任务不存在，请刷新后重试';
  }

  return message || '依赖关系更新失败';
}

function formatExecuteActionError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error ?? '').trim();
  if (message.includes('hard dependencies not met')) {
    return '所选任务存在未完成的硬依赖，当前不能执行或关联。';
  }

  return message || '执行模式操作失败，请稍后重试。';
}

function resolveExecuteState(
  task: TaskNode,
  isBlocked: boolean,
  isExecutable: boolean,
  activeTaskIdSet: ReadonlySet<string>,
): TaskDagFlowNodeData['executeState'] {
  if (activeTaskIdSet.has(task.id)) {
    return 'active';
  }
  if (isTerminalStatus(task.status)) {
    return 'terminal';
  }
  if (isExecutable) {
    return 'executable';
  }
  if (isBlocked) {
    return 'blocked';
  }

  return 'blocked';
}

function buildExecuteTimerConfig(task: TaskNode, spentMinutes: number): TimerConfig {
  if (task.estimatedMinutes == null) {
    return { mode: 'countup' };
  }

  return {
    mode: 'countdown',
    minutes: Math.max(1, Math.round(task.estimatedMinutes - spentMinutes)),
  };
}

function filterTerminalNodesFromVisibleGraph(visibleGraph: VisibleTaskGraph): VisibleTaskGraph {
  const terminalNodeIds = visibleGraph.nodes
    .filter((node) => isTerminalStatus(node.status))
    .map((node) => node.id);
  const visibleNodeIdSet = new Set(
    visibleGraph.nodes
      .filter((node) => !isTerminalStatus(node.status))
      .map((node) => node.id),
  );
  const nodes = visibleGraph.nodes.filter((node) => visibleNodeIdSet.has(node.id));
  const edges = visibleGraph.edges.filter(
    (edge) => visibleNodeIdSet.has(edge.source) && visibleNodeIdSet.has(edge.target),
  );
  const incomingCount = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  const visibleRootNodeIds = nodes
    .map((node) => node.id)
    .filter((nodeId) => (incomingCount.get(nodeId) ?? 0) === 0);
  const visibleRootNodeIdSet = new Set(visibleRootNodeIds);
  const visibleCurrentRootNodeId = nodes.find((node) => visibleRootNodeIdSet.has(node.id))?.id ?? null;

  return {
    ...visibleGraph,
    nodes,
    edges,
    hiddenNodeIds: Array.from(new Set([...visibleGraph.hiddenNodeIds, ...terminalNodeIds])),
    visibleRootNodeIds,
    visibleCurrentRootNodeId,
  };
}

function TaskDagNode({
  id,
  data,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
}: FlowNodeProps<TaskDagFlowNode>) {
  const nodeData = data as TaskDagFlowNodeData;
  const handleStyle = {
    width: 10,
    height: 10,
    border: nodeData.showConnectHandles ? '2px solid #C75B3A' : 0,
    background: nodeData.showConnectHandles ? '#FAF7F5' : 'transparent',
    opacity: nodeData.showConnectHandles ? 1 : 0,
    pointerEvents: nodeData.showConnectHandles ? 'auto' as const : 'none' as const,
  };

  return (
    <div
      title={nodeData.blockedReason ?? undefined}
      data-testid={`task-dag-node-${id}`}
      className={[
        'w-64 rounded-2xl border bg-white px-4 py-3 text-left shadow-sm transition-all dark:bg-[#1C1917]',
        nodeData.connectPreviewType === 'hard'
          ? 'border-[#2563EB] ring-2 ring-[#2563EB]/30 bg-[#EFF6FF] shadow-[0_14px_32px_-18px_rgba(37,99,235,0.7)] dark:border-[#60A5FA] dark:bg-[#172554]'
          : nodeData.connectPreviewType === 'soft'
            ? 'border-dashed border-[#0F766E] ring-2 ring-[#14B8A6]/25 bg-[#F0FDFA] shadow-[0_14px_32px_-18px_rgba(20,184,166,0.7)] dark:border-[#2DD4BF] dark:bg-[#042F2E]'
            : nodeData.executeState === 'active'
              ? 'border-[2.5px] border-[#C75B3A] ring-[3px] ring-[#C75B3A]/35 shadow-[0_12px_36px_-12px_rgba(199,91,58,0.55)] animate-pulse'
              : nodeData.isSelected
                ? 'border-[#C75B3A] ring-2 ring-[#C75B3A]/35 shadow-[0_12px_36px_-12px_rgba(199,91,58,0.55)]'
                : nodeData.executeState === 'executable'
                  ? 'border-[2.5px] border-[#16A34A]/60 ring-[3px] ring-[#22C55E]/20 bg-[#F0FDF4] shadow-[0_12px_28px_-18px_rgba(34,197,94,0.7)] dark:border-[#22C55E]/60 dark:bg-[#052E16]'
                  : nodeData.executeState === 'blocked'
                    ? 'border-[2.5px] border-[#EAB308]/60 ring-[3px] ring-[#EAB308]/15 opacity-60'
                    : nodeData.executeState === 'terminal'
                      ? 'border-[2.5px] border-[#D6D3D1] ring-[3px] ring-[#D6D3D1]/15 opacity-35 grayscale dark:border-[#44403C] dark:ring-[#57534E]/15'
                      : nodeData.isCurrentRoot
                        ? 'border-[#C75B3A] ring-2 ring-[#FDE7DC] dark:ring-[#4A2317]'
                        : nodeData.isCollapsedTarget
                          ? 'border-[#C75B3A] ring-2 ring-[#FDE7DC] dark:border-[#FDBA74] dark:ring-[#4A2317]'
                          : nodeData.isSearchMatch
                            ? 'border-[#2563EB] bg-[#EFF6FF] shadow-[0_10px_25px_-15px_rgba(37,99,235,0.65)] dark:border-[#60A5FA] dark:bg-[#172554]'
                            : nodeData.isBlocked
                              ? 'border-[#EAB308]/60'
                              : 'border-[#E7E5E4] dark:border-[#292524]',
        nodeData.isSearchDimmed && !nodeData.isSelected && nodeData.executeState !== 'active' ? 'opacity-35 saturate-[0.7]' : '',
      ].join(' ')}
    >
      <Handle type="target" position={targetPosition} style={handleStyle} />
      <Handle type="source" position={sourcePosition} style={handleStyle} />

      <div className="flex flex-wrap items-center gap-2">
        {nodeData.connectPreviewType === 'hard' ? (
          <span className="rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-medium text-[#1D4ED8] dark:bg-[#1E3A5F] dark:text-[#93C5FD]">
            准备硬依赖
          </span>
        ) : null}
        {nodeData.connectPreviewType === 'soft' ? (
          <span className="rounded-full bg-[#CCFBF1] px-2 py-0.5 text-[10px] font-medium text-[#0F766E] dark:bg-[#134E4A] dark:text-[#99F6E4]">
            准备软依赖
          </span>
        ) : null}
        {nodeData.executeState === 'active' ? (
          <span className="rounded-full bg-[#FDE7DC] px-2 py-0.5 text-[10px] font-semibold text-[#C75B3A]">
            专注中
          </span>
        ) : null}
        {nodeData.isCollapsedUpstreamTarget ? (
          <span className="rounded-full bg-[#FFF7ED] px-2 py-0.5 text-[10px] font-medium text-[#C75B3A]">
            已折叠上游
          </span>
        ) : null}
        {nodeData.isCollapsedDownstreamTarget ? (
          <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-medium text-[#047857]">
            已折叠下游
          </span>
        ) : null}
        <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
          {nodeData.statusLabel}
        </span>
        {nodeData.hiddenUpstreamCount > 0 ? (
          <span
            data-testid={`task-dag-hidden-upstream-badge-${id}`}
            className="rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-medium text-[#1D4ED8] dark:bg-[#1E3A5F] dark:text-[#93C5FD]"
          >
            {`+${nodeData.hiddenUpstreamCount} 已折叠`}
          </span>
        ) : null}
        {nodeData.hiddenDownstreamCount > 0 ? (
          <span
            data-testid={`task-dag-hidden-downstream-badge-${id}`}
            className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-medium text-[#15803D] dark:bg-[#14532D] dark:text-[#BBF7D0]"
          >
            {`+${nodeData.hiddenDownstreamCount} 下游已折叠`}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">{nodeData.title}</p>
      <p className="mt-2 text-xs text-[#78716C] dark:text-[#A8A29E]">{nodeData.priorityLabel}</p>
      <p className="mt-1 text-xs text-[#57534E] dark:text-[#D6D3D1]">{nodeData.executionLabel}</p>
    </div>
  );
}

const TASK_DAG_NODE_TYPES = {
  taskDag: TaskDagNode,
} satisfies NodeTypes;

const TASK_DAG_MIN_ZOOM = 0.01;
const TASK_DAG_FIT_VIEW_OPTIONS = { padding: 0.2, minZoom: TASK_DAG_MIN_ZOOM } as const;

export function TaskDagPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [activeBlock, setActiveBlock] = useState<ActiveBlockData | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dagVisibility, setDagVisibility] = useState<TaskDagVisibilityState>(EMPTY_TASK_DAG_VISIBILITY_STATE);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [paneContextMenu, setPaneContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [hideTerminal, setHideTerminal] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dagDirection, setDagDirection] = useState<DagDirection>(() => readStoredDagDirection());
  const [mode, setMode] = useState<TaskDagMode>(() => readStoredDagMode());
  const [connectState, setConnectState] = useState<DagConnectState>(null);
  const [endingDialogOpen, setEndingDialogOpen] = useState(false);
  const [endingTaskIds, setEndingTaskIds] = useState<string[]>([]);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const flowInstanceRef = useRef<ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null>(null);
  const connectDragTypeRef = useRef<DagConnectType>('hard');
  const hasMountedDirectionRef = useRef(false);

  useEffect(() => {
    const fullPath = location.pathname + (location.searchStr || '');
    if (fullPath.startsWith('/tasks/')) {
      sessionStorage.setItem(TASKS_LAST_PATH_KEY, fullPath);
    }
  }, [location.pathname, location.searchStr]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TASK_DAG_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage failures and keep mode in-memory only.
    }
  }, [mode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TASK_DAG_DIRECTION_STORAGE_KEY, dagDirection);
    } catch {
      // Ignore storage failures and keep direction in-memory only.
    }
  }, [dagDirection]);

  useEffect(() => {
    let disposed = false;
    const taskService = getTaskService();

    const load = async () => {
      const list = await taskService.listTasks(true);
      if (!disposed) {
        setTasks(list);
      }
    };

    void load();
    const unsubscribe = taskService.onTaskChange(() => {
      void load();
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const timeBlockService = getTimeBlockService();

    const load = async () => {
      const block = await timeBlockService.loadActiveBlock();
      if (!disposed) {
        setActiveBlock(block);
      }
    };

    void load();
    const unsubscribe = timeBlockService.onBlockChange((block) => {
      if (!disposed) {
        setActiveBlock(block);
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(extractTaskTitleSearchQuery(searchDraft));
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchDraft]);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu]);

  useEffect(() => {
    if (!paneContextMenu) return;
    const handler = () => setPaneContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [paneContextMenu]);

  useEffect(() => {
    if (mode !== 'browse') {
      setSelectedTaskId(null);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'connect') {
      setConnectState(null);
      setPaneContextMenu(null);
    }
  }, [mode]);

  useEffect(() => {
    if (activeBlock) return;
    setEndingDialogOpen(false);
    setEndingTaskIds([]);
  }, [activeBlock]);

  useEffect(() => {
    if (!immersive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setImmersive(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [immersive]);

  const resolvedDirection = useMemo(
    () => resolveDagDirection(dagDirection, isDesktop),
    [dagDirection, isDesktop],
  );

  useEffect(() => {
    if (!hasMountedDirectionRef.current) {
      hasMountedDirectionRef.current = true;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void flowInstanceRef.current?.fitView(TASK_DAG_FIT_VIEW_OPTIONS);
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [resolvedDirection]);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const graph = useMemo(() => buildTaskGraph(tasks), [tasks]);
  const graphNodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const activeTaskIds = useMemo(() => resolveActiveBlockTaskIds(activeBlock), [activeBlock]);
  const activeTaskIdSet = useMemo(() => new Set(activeTaskIds), [activeTaskIds]);
  const interactionGraph = useMemo(() => (
    hideTerminal
      ? buildTaskGraph(tasks.filter((task) => !isTerminalStatus(task.status)))
      : graph
  ), [graph, hideTerminal, tasks]);
  const visibleGraph = useMemo(() => projectVisibleTaskGraph(graph, dagVisibility), [graph, dagVisibility]);
  const renderedVisibleGraph = useMemo(() => (
    hideTerminal ? filterTerminalNodesFromVisibleGraph(visibleGraph) : visibleGraph
  ), [hideTerminal, visibleGraph]);
  const visibleNodeIdSet = useMemo(
    () => new Set(renderedVisibleGraph.nodes.map((node) => node.id)),
    [renderedVisibleGraph.nodes],
  );
  const searchMatchedTaskIds = useMemo(() => {
    if (!searchQuery) {
      return new Set<string>();
    }
    return new Set(
      filterTasksByTitleFuzzySearch(tasks, searchQuery).map((task) => task.id),
    );
  }, [searchQuery, tasks]);
  const searchMatchCount = useMemo(() => {
    if (!searchQuery) return 0;
    return renderedVisibleGraph.nodes.reduce((count, node) => (
      searchMatchedTaskIds.has(node.id) ? count + 1 : count
    ), 0);
  }, [renderedVisibleGraph.nodes, searchMatchedTaskIds, searchQuery]);

  useEffect(() => {
    if (selectedTaskId && !visibleNodeIdSet.has(selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [selectedTaskId, visibleNodeIdSet]);

  useEffect(() => {
    if (connectState && !visibleNodeIdSet.has(connectState.sourceId)) {
      setConnectState(null);
    }
  }, [connectState, visibleNodeIdSet]);

  const flowGraph = useMemo(() => {
    const baseFlowGraph = buildVisibleTaskDagFlow(renderedVisibleGraph, {
      direction: resolvedDirection,
      selectedTaskId: mode === 'browse' ? selectedTaskId : null,
      searchMatchedTaskIds,
      hasActiveSearch: Boolean(searchQuery),
    });

    return {
      nodes: baseFlowGraph.nodes.map((node) => {
        const task = taskById.get(node.id);
        const graphNode = graphNodeById.get(node.id);
        const blockedReason = task ? buildBlockedReason(task, taskById) : null;

        return {
          ...node,
          data: {
            ...node.data,
            blockedReason,
            showConnectHandles: mode === 'connect',
            connectPreviewType: connectState?.sourceId === node.id ? connectState.type : null,
            executeState: task && graphNode
              ? resolveExecuteState(task, graphNode.isBlocked, graphNode.isExecutable, activeTaskIdSet)
              : undefined,
          },
        } satisfies TaskDagFlowNode;
      }),
      edges: baseFlowGraph.edges,
    };
  }, [
    activeTaskIdSet,
    connectState,
    graphNodeById,
    mode,
    renderedVisibleGraph,
    resolvedDirection,
    searchMatchedTaskIds,
    searchQuery,
    selectedTaskId,
    taskById,
  ]);

  const toggleCollapse = (direction: 'upstream' | 'downstream', nodeId: string) => {
    setDagVisibility((prev) => {
      if (direction === 'upstream') {
        return {
          ...prev,
          collapsedUpstreamOf: prev.collapsedUpstreamOf.includes(nodeId)
            ? prev.collapsedUpstreamOf.filter((id) => id !== nodeId)
            : [...prev.collapsedUpstreamOf, nodeId],
        };
      }

      return {
        ...prev,
        collapsedDownstreamOf: prev.collapsedDownstreamOf.includes(nodeId)
          ? prev.collapsedDownstreamOf.filter((id) => id !== nodeId)
          : [...prev.collapsedDownstreamOf, nodeId],
      };
    });
  };

  const handleJumpToCurrentRoot = () => {
    const currentRootNodeId = renderedVisibleGraph.visibleCurrentRootNodeId;
    if (!currentRootNodeId) return;
    const currentRootNode = flowGraph.nodes.find((node) => node.id === currentRootNodeId);
    if (!currentRootNode) return;

    if (mode === 'browse') {
      setSelectedTaskId(currentRootNodeId);
    }
    const currentZoom = flowInstanceRef.current?.getViewport().zoom ?? 1;
    flowInstanceRef.current?.setCenter(
      currentRootNode.position.x + TASK_DAG_NODE_WIDTH / 2,
      currentRootNode.position.y + TASK_DAG_NODE_HEIGHT / 2,
      { zoom: currentZoom, duration: 250 },
    );
  };

  const selectedTaskTitle = mode === 'browse' && selectedTaskId
    ? taskById.get(selectedTaskId)?.title ?? selectedTaskId
    : null;
  const selectedTask = mode === 'browse' && selectedTaskId
    ? taskById.get(selectedTaskId) ?? null
    : null;
  const selectedGraphNode = mode === 'browse' && selectedTaskId
    ? graphNodeById.get(selectedTaskId) ?? null
    : null;
  const selectedTaskExecutionHint = selectedTask && selectedGraphNode
    ? buildExecutionHint(selectedTask, selectedGraphNode.isBlocked, selectedGraphNode.isExecutable)
    : '';
  const selectedTaskUpstreamDependencies = selectedTask
    ? buildUpstreamDependencies(selectedTask, taskById)
    : [];
  const selectedTaskDownstreamDependencies = selectedTask
    ? buildDownstreamDependencies(selectedTask.id, tasks)
    : [];

  const handleNavigateToTaskDetail = (taskId: string) => {
    void navigate({
      to: '/tasks/$taskId',
      params: { taskId },
      search: { from: 'dag' } as never,
    });
  };

  const handleQuickCreateTask = async (title: string, description: string) => {
    try {
      await getTaskService().createTask({
        title,
        description: description || undefined,
      });
      toast({
        title: '任务已创建',
        description: title,
      });
    } catch (error) {
      toast({
        title: '创建任务失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      throw error;
    }
  };

  const applyDependencyMutation = async (
    sourceId: string,
    targetId: string,
    dependencyType: DagConnectType,
  ) => {
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }

    const targetTask = taskById.get(targetId);
    if (!targetTask) {
      return;
    }

    const existingDependency = targetTask.dependsOn.find((dependency) => dependency.taskId === sourceId);
    try {
      if (existingDependency?.type === dependencyType) {
        await getTaskService().removeDependency(targetId, sourceId);
        return;
      }

      await getTaskService().addDependency(targetId, sourceId, dependencyType);
    } catch (error) {
      toast({
        title: '依赖更新失败',
        description: formatDependencyMutationError(error),
        variant: 'destructive',
      });
    }
  };

  const handleConnectNodeClick = (nodeId: string) => {
    setContextMenu(null);

    if (!connectState) {
      setConnectState({ sourceId: nodeId, type: 'hard' });
      return;
    }

    if (connectState.sourceId === nodeId) {
      setConnectState(connectState.type === 'hard'
        ? { sourceId: nodeId, type: 'soft' }
        : null);
      return;
    }

    const pendingConnectState = connectState;
    setConnectState(null);
    void applyDependencyMutation(pendingConnectState.sourceId, nodeId, pendingConnectState.type);
  };

  const handleOpenEndDialog = async (taskIds: string[] = activeTaskIds) => {
    const normalizedTaskIds = Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)));
    if (normalizedTaskIds.length === 0) return;

    try {
      const timeBlockService = getTimeBlockService();
      const block = await timeBlockService.loadActiveBlock();
      if (block && block.phase !== 'feedback_in_progress') {
        await timeBlockService.markEnding();
      }
      setEndingTaskIds(normalizedTaskIds);
      setEndingDialogOpen(true);
    } catch (error) {
      toast({
        title: '无法结束时间块',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const handleExecuteNodeClick = async (nodeId: string) => {
    setContextMenu(null);

    const task = taskById.get(nodeId);
    const graphNode = graphNodeById.get(nodeId);
    if (!task || !graphNode) {
      return;
    }

    if (activeBlock?.phase === 'feedback_in_progress') {
      setEndingTaskIds((current) => current.length > 0 ? current : activeTaskIds);
      setEndingDialogOpen(true);
      return;
    }

    if (isTerminalStatus(task.status)) {
      return;
    }

    if (graphNode.isBlocked && !activeTaskIdSet.has(nodeId)) {
      return;
    }

    try {
      const taskTimerService = getTaskTimerService();
      const taskService = getTaskService();

      if (activeTaskIdSet.has(nodeId)) {
        if (activeTaskIds.length <= 1) {
          await handleOpenEndDialog(activeTaskIds);
          return;
        }

        await taskTimerService.removeTaskFromBlock(nodeId);
        if (task.status === 'in_progress') {
          await taskService.transitionTask(nodeId, 'suspended');
        }
        return;
      }

      if (activeBlock) {
        await taskTimerService.addTaskToBlock(nodeId);
        return;
      }

      const spentMinutes = task.estimatedMinutes
        ? await taskTimerService.calculateSpentMinutes(nodeId)
        : 0;
      await taskTimerService.startBlockForTask(nodeId, buildExecuteTimerConfig(task, spentMinutes));
    } catch (error) {
      toast({
        title: '执行模式操作失败',
        description: formatExecuteActionError(error),
        variant: 'destructive',
      });
    }
  };

  const handleNodeClick = (_event: unknown, node: { id: string }) => {
    if (mode === 'browse') {
      setSelectedTaskId(node.id);
      setContextMenu(null);
      return;
    }

    if (mode === 'connect') {
      handleConnectNodeClick(node.id);
      return;
    }

    void handleExecuteNodeClick(node.id);
  };

  const endingDialogTaskIds = endingTaskIds.length > 0 ? endingTaskIds : activeTaskIds;
  const endingDialogTasks = endingDialogTaskIds
    .map((taskId) => taskById.get(taskId))
    .filter((task): task is TaskNode => Boolean(task));
  const subtitle = useMemo(() => {
    if (mode === 'connect') {
      if (connectState) {
        const sourceTitle = taskById.get(connectState.sourceId)?.title ?? connectState.sourceId;
        return `连接模式：已选“${sourceTitle}”作为${connectState.type === 'hard' ? '硬依赖' : '软依赖'}起点，再点目标节点即可。`;
      }
      return '连接模式：拖拽节点两端句柄，或依次点击两个节点建立依赖；再次点击同一节点可切换硬/软依赖。';
    }

    if (mode === 'execute') {
      if (activeTaskIds.length > 0) {
        return `执行模式：当前时间块关联 ${activeTaskIds.length} 个任务。单击节点可追加或移除关联，右键可结束时间块。`;
      }
      return '执行模式：单击可执行节点即可开始时间块，双击仍可进入任务详情页。';
    }

    if (selectedTaskTitle) {
      return `当前聚焦：${selectedTaskTitle}。双击节点可进入任务详情页。`;
    }

    return '单击节点可查看详情，双击节点可进入任务详情页，右键节点可折叠上下游。';
  }, [activeTaskIds.length, connectState, mode, selectedTaskTitle, taskById]);

  const handleEndDialogSubmit = async (payload: {
    feedback: string;
    outcomes: Record<string, TaskStatusChoice>;
  }) => {
    const taskIdsSnapshot = endingDialogTaskIds;
    const blockId = activeBlock?.startId;
    const taskStatusOutcomes = Object.entries(payload.outcomes).reduce<Record<string, string>>((next, [taskId, status]) => {
      if (status !== 'continue') {
        next[taskId] = status;
      }
      return next;
    }, {});
    const taskTitles = taskIdsSnapshot.reduce<Record<string, string>>((next, taskId) => {
      const title = taskById.get(taskId)?.title;
      if (title) {
        next[taskId] = title;
      }
      return next;
    }, {});

    try {
      await getTimeBlockService().endBlock(payload.feedback || undefined, {
        taskStatusOutcomes: Object.keys(taskStatusOutcomes).length > 0 ? taskStatusOutcomes : undefined,
        taskTitles: Object.keys(taskTitles).length > 0 ? taskTitles : undefined,
      });

      if (blockId && taskIdsSnapshot.length > 0) {
        await getTaskTimerService().onBlockEndForTasks(taskIdsSnapshot, blockId);
      }

      for (const [taskId, status] of Object.entries(taskStatusOutcomes)) {
        await getTaskService().transitionTask(taskId, status as TaskStatus);
      }

      setEndingTaskIds([]);
      setEndingDialogOpen(false);
    } catch (error) {
      toast({
        title: '结束时间块失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
      throw error;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="task-dag-page">
      <header
        data-testid="task-dag-page-header"
        className={immersive ? 'hidden' : 'px-5 py-4 md:px-8 lg:px-10'}
      >
        <TaskBreadcrumb
          segments={[{ label: '任务', to: '/tasks' }]}
          current={{ label: 'DAG 视图', icon: Waypoints }}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务依赖 DAG</h1>
            <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">{subtitle}</p>
          </div>
        </div>
      </header>

      <div
        data-testid="task-dag-canvas-shell"
        className="relative flex-1 min-h-0 overflow-hidden border-t border-[#F0ECE8] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]"
      >
        <TaskDagModeSelector
          mode={mode}
          enabledModes={['browse', 'connect', 'execute']}
          onChange={setMode}
          immersive={immersive}
        />
        <TaskDagControlPanel
          direction={dagDirection}
          searchValue={searchDraft}
          searchMatchCount={searchMatchCount}
          hideTerminal={hideTerminal}
          immersive={immersive}
          onDirectionChange={setDagDirection}
          onSearchValueChange={setSearchDraft}
          onToggleHideTerminal={() => setHideTerminal((value) => !value)}
          onToggleImmersive={() => setImmersive((value) => !value)}
          onFitView={() => {
            void flowInstanceRef.current?.fitView(TASK_DAG_FIT_VIEW_OPTIONS);
          }}
          onJumpToCurrentRoot={renderedVisibleGraph.visibleCurrentRootNodeId ? handleJumpToCurrentRoot : undefined}
          hasCurrentRoot={Boolean(renderedVisibleGraph.visibleCurrentRootNodeId)}
        />

        <div
          className="h-full w-full"
          onDoubleClick={(event) => {
            if (mode !== 'connect' || !isPaneInteractionTarget(event.target)) {
              return;
            }
            setContextMenu(null);
            setPaneContextMenu(null);
            setQuickCreateOpen(true);
          }}
          onContextMenu={(event) => {
            if (mode !== 'connect' || !isPaneInteractionTarget(event.target)) {
              return;
            }
            event.preventDefault();
            setContextMenu(null);
            setPaneContextMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <ReactFlow<TaskDagFlowNode, TaskDagFlowEdge>
            nodes={flowGraph.nodes}
            edges={flowGraph.edges}
            nodeTypes={TASK_DAG_NODE_TYPES}
            proOptions={{ hideAttribution: true }}
            fitView
            minZoom={TASK_DAG_MIN_ZOOM}
            fitViewOptions={TASK_DAG_FIT_VIEW_OPTIONS}
            nodesDraggable={false}
            nodesConnectable={mode === 'connect'}
            elementsSelectable
            zoomOnDoubleClick={false}
            onInit={(instance) => {
              flowInstanceRef.current = instance;
              void instance.fitView(TASK_DAG_FIT_VIEW_OPTIONS);
            }}
            onPaneClick={() => {
              if (mode === 'browse') {
                setSelectedTaskId(null);
              }
              if (mode === 'connect') {
                setConnectState(null);
              }
              setContextMenu(null);
              setPaneContextMenu(null);
            }}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={(_event, node) => {
              setContextMenu(null);
              if (mode === 'connect') {
                return;
              }
              handleNavigateToTaskDetail(node.id);
            }}
            onConnectStart={(event) => {
              connectDragTypeRef.current = resolveConnectTypeFromEvent(event);
            }}
            onConnect={(connection) => {
              setConnectState(null);
              void applyDependencyMutation(
                connection.source?.trim() ?? '',
                connection.target?.trim() ?? '',
                connectDragTypeRef.current,
              );
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              setPaneContextMenu(null);
              setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
            }}
          >
            <Background gap={20} color="#E7E5E4" />
            {immersive ? null : (
              <Controls className="!rounded-lg !border-[#E7E3E0] !bg-white/90 !shadow-sm dark:!border-[#3C3836] dark:!bg-[#1C1917]/90 [&>button]:!border-[#E7E3E0] [&>button]:!bg-transparent [&>button]:!fill-[#57534E] dark:[&>button]:!border-[#3C3836] dark:[&>button]:!fill-[#A8A29E] [&>button:hover]:!bg-[#F5F0ED] dark:[&>button:hover]:!bg-[#292524]" />
            )}
          </ReactFlow>
        </div>

        {contextMenu ? (
          <div
            className="fixed z-50 rounded-lg border border-[#E7E5E4] bg-white py-1 shadow-lg dark:border-[#292524] dark:bg-[#1C1917]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {mode === 'execute' && activeTaskIds.length > 0 ? (
              <button
                type="button"
                data-testid="task-dag-context-end-block"
                className="block w-full px-4 py-1.5 text-left text-xs text-[#C75B3A] hover:bg-[#FFF7ED] dark:text-[#FDBA74] dark:hover:bg-[#292524]"
                onClick={() => {
                  setContextMenu(null);
                  void handleOpenEndDialog(activeTaskIds);
                }}
              >
                结束时间块
              </button>
            ) : null}
            <button
              type="button"
              data-testid="task-dag-context-toggle-upstream"
              className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#A8A29E] dark:hover:bg-[#292524]"
              onClick={() => {
                toggleCollapse('upstream', contextMenu.nodeId);
                setContextMenu(null);
              }}
              disabled={
                calculateTaskDagCollapseScope(interactionGraph, dagVisibility, 'upstream', contextMenu.nodeId).size <= 1
                && !dagVisibility.collapsedUpstreamOf.includes(contextMenu.nodeId)
              }
            >
              {dagVisibility.collapsedUpstreamOf.includes(contextMenu.nodeId) ? '展开上游' : '折叠上游'}
            </button>
            <button
              type="button"
              data-testid="task-dag-context-toggle-downstream"
              className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] disabled:cursor-not-allowed disabled:opacity-60 dark:text-[#A8A29E] dark:hover:bg-[#292524]"
              onClick={() => {
                toggleCollapse('downstream', contextMenu.nodeId);
                setContextMenu(null);
              }}
              disabled={
                calculateTaskDagCollapseScope(interactionGraph, dagVisibility, 'downstream', contextMenu.nodeId).size <= 1
                && !dagVisibility.collapsedDownstreamOf.includes(contextMenu.nodeId)
              }
            >
              {dagVisibility.collapsedDownstreamOf.includes(contextMenu.nodeId) ? '展开下游' : '折叠下游'}
            </button>
          </div>
        ) : null}

        {paneContextMenu && mode === 'connect' ? (
          <div
            data-testid="task-dag-pane-context-menu"
            className="fixed z-50 rounded-lg border border-[#E7E5E4] bg-white py-1 shadow-lg dark:border-[#292524] dark:bg-[#1C1917]"
            style={{ left: paneContextMenu.x, top: paneContextMenu.y }}
          >
            <button
              type="button"
              data-testid="task-dag-pane-context-create"
              className="block w-full px-4 py-1.5 text-left text-xs text-[#57534E] hover:bg-[#F5F0ED] dark:text-[#A8A29E] dark:hover:bg-[#292524]"
              onClick={() => {
                setPaneContextMenu(null);
                setQuickCreateOpen(true);
              }}
            >
              快速创建任务
            </button>
          </div>
        ) : null}

        {selectedTask && selectedGraphNode ? (
          <TaskDagDetailPanel
            task={selectedTask}
            executionHint={selectedTaskExecutionHint}
            upstreamDependencies={selectedTaskUpstreamDependencies}
            downstreamDependencies={selectedTaskDownstreamDependencies}
            onClose={() => setSelectedTaskId(null)}
            onOpenDetail={() => handleNavigateToTaskDetail(selectedTask.id)}
          />
        ) : null}

        <MultiTaskEndDialog
          open={endingDialogOpen}
          tasks={endingDialogTasks}
          onOpenChange={setEndingDialogOpen}
          onSubmit={handleEndDialogSubmit}
        />
        <TaskQuickCreateDialog
          open={quickCreateOpen}
          onOpenChange={setQuickCreateOpen}
          onSubmit={handleQuickCreateTask}
        />
      </div>
    </div>
  );
}
