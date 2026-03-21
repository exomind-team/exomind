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

export type DagLayoutPoint = { x: number; y: number };

export type DagLayoutResult = {
  nodePositions: Map<string, DagLayoutPoint>;
  edgePoints: Map<string, DagLayoutPoint[]>;
};

export function buildDagLayoutEdgeKey(source: string, target: string): string {
  return `${source}\0${target}`;
}

function isDagLayoutPoint(value: unknown): value is DagLayoutPoint {
  return (
    typeof value === 'object'
    && value !== null
    && 'x' in value
    && 'y' in value
    && typeof value.x === 'number'
    && typeof value.y === 'number'
  );
}

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
): DagLayoutResult {
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

  const nodePositions = new Map<string, DagLayoutPoint>();
  for (const node of nodes) {
    const layoutNode = graph.node(node.id);
    if (!layoutNode) {
      continue;
    }

    const width = node.width ?? TASK_DAG_NODE_WIDTH;
    const height = node.height ?? TASK_DAG_NODE_HEIGHT;
    nodePositions.set(node.id, {
      x: layoutNode.x - width / 2,
      y: layoutNode.y - height / 2,
    });
  }

  const edgePoints = new Map<string, DagLayoutPoint[]>();
  for (const edge of graph.edges()) {
    const layoutEdge = graph.edge(edge);
    if (!layoutEdge || !Array.isArray(layoutEdge.points)) {
      continue;
    }

    const points = layoutEdge.points.filter(isDagLayoutPoint);
    if (points.length < 2) {
      continue;
    }

    edgePoints.set(buildDagLayoutEdgeKey(edge.v, edge.w), points);
  }

  return { nodePositions, edgePoints };
}
