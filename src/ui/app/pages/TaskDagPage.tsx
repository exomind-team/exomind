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
import { getTaskService } from '@/lib/services';
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import {
  calculateTaskDagCollapseScope,
  type TaskDagVisibilityState,
  EMPTY_TASK_DAG_VISIBILITY_STATE,
  projectVisibleTaskGraph,
  type VisibleTaskGraph,
} from '@/lib/task/task-dag-visibility';
import type { TaskNode, TaskStatus } from '@/lib/types/task';
import { TaskDagControlPanel } from '@/ui/app/components/TaskDagControlPanel';
import {
  TaskDagDetailPanel,
  type TaskDagDependencyItem,
} from '@/ui/app/components/TaskDagDetailPanel';
import { TaskDagModeSelector, type TaskDagMode } from '@/ui/app/components/TaskDagModeSelector';
import { TaskBreadcrumb } from '@/ui/app/components/TaskBreadcrumb';
import {
  buildVisibleTaskDagFlow,
  TASK_DAG_NODE_HEIGHT,
  TASK_DAG_NODE_WIDTH,
  type TaskDagFlowEdge,
  type TaskDagFlowNode,
  type TaskDagFlowNodeData,
} from './task-dag-flow';
import { extractTaskTitleSearchQuery, filterTasksByTitleFuzzySearch } from './task-title-fuzzy-search';
import { TASKS_LAST_PATH_KEY } from './task-route-memory';

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

function TaskDagNode({ id, data }: FlowNodeProps<TaskDagFlowNode>) {
  const nodeData = data as TaskDagFlowNodeData;
  const handleStyle = {
    width: 8,
    height: 8,
    border: 0,
    opacity: 0,
    pointerEvents: 'none' as const,
  };

  return (
    <div
      data-testid={`task-dag-node-${id}`}
      className={[
        'w-64 rounded-2xl border bg-white px-4 py-3 text-left shadow-sm transition-all dark:bg-[#1C1917]',
        nodeData.isSelected
          ? 'border-[#C75B3A] ring-2 ring-[#C75B3A]/35 shadow-[0_12px_36px_-12px_rgba(199,91,58,0.55)]'
          : nodeData.isCurrentRoot
            ? 'border-[#C75B3A] ring-2 ring-[#FDE7DC] dark:ring-[#4A2317]'
            : nodeData.isCollapsedTarget
              ? 'border-[#C75B3A] ring-2 ring-[#FDE7DC] dark:border-[#FDBA74] dark:ring-[#4A2317]'
              : nodeData.isSearchMatch
                ? 'border-[#2563EB] bg-[#EFF6FF] shadow-[0_10px_25px_-15px_rgba(37,99,235,0.65)] dark:border-[#60A5FA] dark:bg-[#172554]'
                : nodeData.isBlocked
                  ? 'border-[#EAB308]/60'
                  : 'border-[#E7E5E4] dark:border-[#292524]',
        nodeData.isSearchDimmed && !nodeData.isSelected ? 'opacity-35 saturate-[0.7]' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Handle type="source" position={Position.Right} style={handleStyle} />

      <div className="flex flex-wrap items-center gap-2">
        {nodeData.isCurrentRoot ? (
          <span
            data-testid={`task-dag-current-root-badge-${id}`}
            className="rounded-full bg-[#FDE7DC] px-2 py-0.5 text-[10px] font-semibold text-[#C75B3A]"
          >
            当前根节点
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
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dagVisibility, setDagVisibility] = useState<TaskDagVisibilityState>(EMPTY_TASK_DAG_VISIBILITY_STATE);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [hideTerminal, setHideTerminal] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [mode] = useState<TaskDagMode>('browse');
  const flowInstanceRef = useRef<ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null>(null);

  useEffect(() => {
    const fullPath = location.pathname + (location.searchStr || '');
    if (fullPath.startsWith('/tasks/')) {
      sessionStorage.setItem(TASKS_LAST_PATH_KEY, fullPath);
    }
  }, [location.pathname, location.searchStr]);

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

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const graph = useMemo(() => buildTaskGraph(tasks), [tasks]);
  const graphNodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const interactionGraph = useMemo(() => (
    hideTerminal
      ? buildTaskGraph(tasks.filter((task) => !isTerminalStatus(task.status)))
      : graph
  ), [graph, hideTerminal, tasks]);
  const visibleGraph = useMemo(() => projectVisibleTaskGraph(graph, dagVisibility), [graph, dagVisibility]);
  const renderedVisibleGraph = useMemo(() => (
    hideTerminal ? filterTerminalNodesFromVisibleGraph(visibleGraph) : visibleGraph
  ), [hideTerminal, visibleGraph]);
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
  const flowGraph = useMemo(() => buildVisibleTaskDagFlow(renderedVisibleGraph, {
    selectedTaskId,
    searchMatchedTaskIds,
    hasActiveSearch: Boolean(searchQuery),
  }), [renderedVisibleGraph, searchMatchedTaskIds, searchQuery, selectedTaskId]);

  useEffect(() => {
    const visibleNodeIds = new Set(renderedVisibleGraph.nodes.map((node) => node.id));
    if (selectedTaskId && !visibleNodeIds.has(selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [renderedVisibleGraph.nodes, selectedTaskId]);

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

    setSelectedTaskId(currentRootNodeId);
    const currentZoom = flowInstanceRef.current?.getViewport().zoom ?? 1;
    flowInstanceRef.current?.setCenter(
      currentRootNode.position.x + TASK_DAG_NODE_WIDTH / 2,
      currentRootNode.position.y + TASK_DAG_NODE_HEIGHT / 2,
      { zoom: currentZoom, duration: 250 },
    );
  };

  const selectedTaskTitle = selectedTaskId ? taskById.get(selectedTaskId)?.title ?? selectedTaskId : null;
  const selectedTask = selectedTaskId ? taskById.get(selectedTaskId) ?? null : null;
  const selectedGraphNode = selectedTaskId ? graphNodeById.get(selectedTaskId) ?? null : null;
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#FAF7F5] dark:bg-[#0C0A09]" data-testid="task-dag-page">
      <header className="px-5 py-4 md:px-8 lg:px-10">
        <TaskBreadcrumb
          segments={[{ label: '任务', to: '/tasks' }]}
          current={{ label: 'DAG 视图', icon: Waypoints }}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务依赖 DAG</h1>
            <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
              {selectedTaskTitle
                ? `当前聚焦：${selectedTaskTitle}。双击节点可进入任务详情页。`
                : '单击节点可查看详情，双击节点可进入任务详情页，右键节点可折叠上下游。'}
            </p>
          </div>
        </div>
      </header>

      <div
        data-testid="task-dag-canvas-shell"
        className="relative flex-1 min-h-0 overflow-hidden border-t border-[#F0ECE8] bg-[#FAF7F5] dark:border-[#292524] dark:bg-[#0C0A09]"
      >
        <TaskDagModeSelector
          mode={mode}
          enabledModes={['browse']}
          onChange={() => {}}
        />
        <TaskDagControlPanel
          searchValue={searchDraft}
          searchMatchCount={searchMatchCount}
          hideTerminal={hideTerminal}
          onSearchValueChange={setSearchDraft}
          onToggleHideTerminal={() => setHideTerminal((value) => !value)}
          onFitView={() => {
            void flowInstanceRef.current?.fitView(TASK_DAG_FIT_VIEW_OPTIONS);
          }}
          onJumpToCurrentRoot={renderedVisibleGraph.visibleCurrentRootNodeId ? handleJumpToCurrentRoot : undefined}
          hasCurrentRoot={Boolean(renderedVisibleGraph.visibleCurrentRootNodeId)}
        />

        <ReactFlow<TaskDagFlowNode, TaskDagFlowEdge>
          nodes={flowGraph.nodes}
          edges={flowGraph.edges}
          nodeTypes={TASK_DAG_NODE_TYPES}
          proOptions={{ hideAttribution: true }}
          fitView
          minZoom={TASK_DAG_MIN_ZOOM}
          fitViewOptions={TASK_DAG_FIT_VIEW_OPTIONS}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          zoomOnDoubleClick={false}
          onInit={(instance) => {
            flowInstanceRef.current = instance;
            void instance.fitView(TASK_DAG_FIT_VIEW_OPTIONS);
          }}
          onPaneClick={() => {
            setSelectedTaskId(null);
            setContextMenu(null);
          }}
          onNodeClick={(_event, node) => {
            setSelectedTaskId(node.id);
            setContextMenu(null);
          }}
          onNodeDoubleClick={(_event, node) => {
            setContextMenu(null);
            handleNavigateToTaskDetail(node.id);
          }}
          onNodeContextMenu={(event, node) => {
            event.preventDefault();
            setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
          }}
        >
          <Background gap={20} color="#E7E5E4" />
          <Controls className="!rounded-lg !border-[#E7E3E0] !bg-white/90 !shadow-sm dark:!border-[#3C3836] dark:!bg-[#1C1917]/90 [&>button]:!border-[#E7E3E0] [&>button]:!bg-transparent [&>button]:!fill-[#57534E] dark:[&>button]:!border-[#3C3836] dark:[&>button]:!fill-[#A8A29E] [&>button:hover]:!bg-[#F5F0ED] dark:[&>button:hover]:!bg-[#292524]" />
        </ReactFlow>

        {contextMenu ? (
          <div
            className="fixed z-50 rounded-lg border border-[#E7E5E4] bg-white py-1 shadow-lg dark:border-[#292524] dark:bg-[#1C1917]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
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
      </div>
    </div>
  );
}
