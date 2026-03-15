import { ArrowLeft, Crosshair, Waypoints } from 'lucide-react';
import { Link } from '@tanstack/react-router';
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
import { buildTaskGraph } from '@/lib/task/task-dag-graph';
import { getTaskService } from '@/lib/services';
import type { TaskNode } from '@/lib/types/task';
import {
  buildTaskDagFlow,
  TASK_DAG_NODE_HEIGHT,
  TASK_DAG_NODE_WIDTH,
  type TaskDagFlowEdge,
  type TaskDagFlowNode,
  type TaskDagFlowNodeData,
} from './task-dag-flow';

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
        'w-64 rounded-2xl border bg-white px-4 py-3 text-left shadow-sm dark:bg-[#1C1917]',
        nodeData.isCurrentRoot
          ? 'border-[#C75B3A] ring-2 ring-[#FDE7DC] dark:ring-[#4A2317]'
          : nodeData.isBlocked
            ? 'border-[#EAB308]/60'
            : 'border-[#E7E5E4] dark:border-[#292524]',
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
        <span className="rounded-full bg-[#F5F0ED] px-2 py-0.5 text-[10px] font-medium text-[#78716C] dark:bg-[#292524] dark:text-[#A8A29E]">
          {nodeData.statusLabel}
        </span>
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

export function TaskDagPage() {
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<TaskDagFlowNode, TaskDagFlowEdge> | null>(null);

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

  const graph = useMemo(() => buildTaskGraph(tasks), [tasks]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const flowGraph = useMemo(() => buildTaskDagFlow(graph), [graph]);

  useEffect(() => {
    if (graph.currentRootNodeId && !selectedTaskId) {
      setSelectedTaskId(graph.currentRootNodeId);
      return;
    }

    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(graph.currentRootNodeId ?? graph.topologicalOrder[0] ?? null);
    }
  }, [graph.currentRootNodeId, graph.topologicalOrder, selectedTaskId, tasks]);

  const currentRootTask = graph.currentRootNodeId ? taskById.get(graph.currentRootNodeId) ?? null : null;
  const selectedTask = selectedTaskId ? taskById.get(selectedTaskId) ?? null : null;
  const selectedNode = selectedTaskId
    ? graph.nodes.find((node) => node.id === selectedTaskId) ?? null
    : null;

  const handleJumpToCurrentRoot = () => {
    if (!graph.currentRootNodeId) return;
    const currentRootNode = flowGraph.nodes.find((node) => node.id === graph.currentRootNodeId);
    if (!currentRootNode) return;

    setSelectedTaskId(graph.currentRootNodeId);
    flowInstanceRef.current?.setCenter(
      currentRootNode.position.x + TASK_DAG_NODE_WIDTH / 2,
      currentRootNode.position.y + TASK_DAG_NODE_HEIGHT / 2,
      { zoom: 1, duration: 250 },
    );
  };

  return (
    <div className="min-h-full bg-[#FAF7F5] px-5 py-4 dark:bg-[#0C0A09] md:px-8 lg:px-10" data-testid="task-dag-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
            <Link to="/tasks" className="inline-flex items-center gap-1 hover:text-[#1C1917] dark:hover:text-[#FAFAF9]">
              <ArrowLeft size={14} />
              返回任务
            </Link>
            <span>/</span>
            <span className="inline-flex items-center gap-1">
              <Waypoints size={14} />
              DAG 视图
            </span>
          </div>
          <h1 className="mt-2 text-xl font-semibold text-[#1C1917] dark:text-[#FAFAF9]">任务依赖 DAG</h1>
          <p className="mt-1 text-sm text-[#78716C] dark:text-[#A8A29E]">
            基于 `dependsOn` 的只读执行图，不把 `parentId` 并入 DAG 边。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="task-dag-current-root-jump"
            onClick={handleJumpToCurrentRoot}
            disabled={!graph.currentRootNodeId}
            className="inline-flex items-center gap-2 rounded-full bg-[#C75B3A] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#D6D3D1]"
          >
            <Crosshair size={16} />
            跳到当前根节点
          </button>
          {graph.currentRootNodeId ? (
            <Link
              to="/tasks/$taskId"
              params={{ taskId: graph.currentRootNodeId }}
              className="inline-flex items-center rounded-full border border-[#E7E5E4] px-4 py-2 text-sm font-semibold text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
            >
              打开当前根节点
            </Link>
          ) : null}
        </div>
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
          <div data-testid="task-dag-current-root-summary" className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A8A29E]">当前根节点</p>
              <p className="mt-2 truncate text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">
                {currentRootTask?.title ?? '暂无未阻塞节点'}
              </p>
              <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                {`节点 ${graph.nodes.length} 个 · 边 ${graph.edges.length} 条 · 未阻塞节点 ${graph.currentRootCandidateNodeIds.length} 个`}
              </p>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]">
            <h2 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">图例</h2>
            <div className="mt-3 space-y-2 text-xs text-[#78716C] dark:text-[#A8A29E]">
              <div data-testid="task-dag-legend-hard" className="flex items-center gap-2">
                <span className="h-px w-8 bg-[#C75B3A]" />
                <span>硬依赖：前置必须完成后才能开始</span>
              </div>
              <div data-testid="task-dag-legend-soft" className="flex items-center gap-2">
                <span className="h-px w-8 border-t-2 border-dashed border-[#78716C]" />
                <span>软依赖：前置待办会提示阻塞，但仍可直接开工</span>
              </div>
            </div>
          </section>

          <section
            data-testid="task-dag-selected-panel"
            className="rounded-2xl border border-[#E7E5E4] bg-white p-4 dark:border-[#292524] dark:bg-[#1C1917]"
          >
            <h2 className="text-sm font-semibold text-[#1C1917] dark:text-[#FAFAF9]">节点详情</h2>
            {selectedTask && selectedNode ? (
              <>
                <p className="mt-3 text-sm font-medium text-[#1C1917] dark:text-[#FAFAF9]">{selectedTask.title}</p>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">状态：{selectedNode.status}</p>
                <p className="mt-1 text-xs text-[#78716C] dark:text-[#A8A29E]">
                  {selectedNode.isExecutable ? '可执行' : '不可直接执行'}
                  {selectedNode.isBlocked ? ' · 有阻塞提醒' : ''}
                </p>
                <Link
                  data-testid="task-dag-selected-link"
                  to="/tasks/$taskId"
                  params={{ taskId: selectedTask.id }}
                  className="mt-3 inline-flex items-center rounded-full border border-[#E7E5E4] px-3 py-2 text-xs font-semibold text-[#57534E] dark:border-[#292524] dark:text-[#D6D3D1]"
                >
                  打开任务详情
                </Link>
              </>
            ) : (
              <p className="mt-3 text-xs text-[#78716C] dark:text-[#A8A29E]">点击节点可查看详情。</p>
            )}
          </section>
        </aside>
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-[#E7E5E4] bg-white dark:border-[#292524] dark:bg-[#1C1917]">
        <div className="h-[560px] w-full">
          <ReactFlow<TaskDagFlowNode, TaskDagFlowEdge>
            nodes={flowGraph.nodes}
            edges={flowGraph.edges}
            nodeTypes={TASK_DAG_NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            zoomOnDoubleClick={false}
            onInit={(instance) => {
              flowInstanceRef.current = instance;
              void instance.fitView({ padding: 0.2 });
            }}
            onNodeClick={(_event, node) => {
              setSelectedTaskId(node.id);
            }}
          >
            <Background gap={20} color="#E7E5E4" />
            <Controls />
          </ReactFlow>
        </div>
      </section>
    </div>
  );
}
