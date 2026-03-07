import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import type { TaskGraph } from '@/lib/task/task-dag-graph';
import type { TaskNode } from '@/lib/types/task';

export const TASK_DAG_NODE_WIDTH = 256;
export const TASK_DAG_NODE_HEIGHT = 140;

const COLUMN_GAP = 320;
const ROW_GAP = 180;

const STATUS_LABEL: Record<TaskNode['status'], string> = {
  not_started: '未开始',
  in_progress: '进行中',
  suspended: '已挂起',
  completed: '已完成',
  abandoned: '已放弃',
};

const PRIORITY_LABEL: Record<TaskNode['priority'], string> = {
  low: '低优先级',
  medium: '中优先级',
  high: '高优先级',
};

function resolveExecutionLabel(node: TaskGraph['nodes'][number]): string {
  if (node.status === 'in_progress') return '进行中';
  if (node.status === 'suspended') return '已挂起';
  if (node.isExecutable && node.isBlocked) return '可执行（软阻塞提醒）';
  if (node.isExecutable) return '可执行';
  if (node.isBlocked) return '受阻';
  return '待处理';
}

export type TaskDagFlowNodeData = {
  title: string;
  statusLabel: string;
  priorityLabel: string;
  executionLabel: string;
  isCurrentRoot: boolean;
  isBlocked: boolean;
  isExecutable: boolean;
};

export type TaskDagFlowNode = Node<TaskDagFlowNodeData, 'taskDag'>;
export type TaskDagFlowEdge = Edge;

export function buildTaskDagFlow(graph: TaskGraph): {
  nodes: TaskDagFlowNode[];
  edges: TaskDagFlowEdge[];
} {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, string[]>();
  const depthById = new Map<string, number>();
  const rowsByDepth = new Map<number, string[]>();

  for (const edge of graph.edges) {
    const incoming = incomingByTarget.get(edge.target) ?? [];
    incoming.push(edge.source);
    incomingByTarget.set(edge.target, incoming);
  }

  for (const taskId of graph.topologicalOrder) {
    const incomingDepths = (incomingByTarget.get(taskId) ?? [])
      .map((sourceId) => depthById.get(sourceId))
      .filter((depth): depth is number => depth !== undefined);
    const depth = incomingDepths.length > 0 ? Math.max(...incomingDepths) + 1 : 0;
    depthById.set(taskId, depth);
    const rows = rowsByDepth.get(depth) ?? [];
    rows.push(taskId);
    rowsByDepth.set(depth, rows);
  }

  const nodes = graph.topologicalOrder
    .map((taskId) => nodeById.get(taskId))
    .filter((node): node is TaskGraph['nodes'][number] => Boolean(node))
    .map((node) => {
      const depth = depthById.get(node.id) ?? 0;
      const row = rowsByDepth.get(depth)?.indexOf(node.id) ?? 0;
      return {
        id: node.id,
        type: 'taskDag',
        position: {
          x: depth * COLUMN_GAP,
          y: row * ROW_GAP,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: false,
        data: {
          title: node.title,
          statusLabel: STATUS_LABEL[node.status],
          priorityLabel: PRIORITY_LABEL[node.priority],
          executionLabel: resolveExecutionLabel(node),
          isCurrentRoot: node.id === graph.currentRootNodeId,
          isBlocked: node.isBlocked,
          isExecutable: node.isExecutable,
        },
      } satisfies TaskDagFlowNode;
    });

  const edges = graph.edges.map((edge) => {
    const hardEdge = edge.type === 'hard';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: false,
      selectable: false,
      style: hardEdge
        ? { stroke: '#C75B3A', strokeWidth: 2.25 }
        : { stroke: '#78716C', strokeWidth: 1.75, strokeDasharray: '7 5' },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: hardEdge ? '#C75B3A' : '#78716C',
      },
    } satisfies TaskDagFlowEdge;
  });

  return { nodes, edges };
}
