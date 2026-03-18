import dagre from '@dagrejs/dagre';
import { TASK_DAG_NODE_HEIGHT, TASK_DAG_NODE_WIDTH } from './task-dag-flow';

export type DagDirection = 'TB' | 'LR' | 'auto';
export type ResolvedDagDirection = Exclude<DagDirection, 'auto'>;

type DagLayoutNode = {
  id: string;
  width?: number;
  height?: number;
};

type DagLayoutEdge = {
  source: string;
  target: string;
};

export function resolveDagDirection(
  direction: DagDirection,
  isDesktop: boolean,
): ResolvedDagDirection {
  if (direction === 'auto') {
    return isDesktop ? 'LR' : 'TB';
  }

  return direction;
}

export function layoutDagNodes(
  nodes: DagLayoutNode[],
  edges: DagLayoutEdge[],
  direction: ResolvedDagDirection,
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    graph.setNode(node.id, {
      width: node.width ?? TASK_DAG_NODE_WIDTH,
      height: node.height ?? TASK_DAG_NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const layoutNode = graph.node(node.id);
    if (!layoutNode) {
      continue;
    }

    const width = node.width ?? TASK_DAG_NODE_WIDTH;
    const height = node.height ?? TASK_DAG_NODE_HEIGHT;
    positions.set(node.id, {
      x: layoutNode.x - width / 2,
      y: layoutNode.y - height / 2,
    });
  }

  return positions;
}
