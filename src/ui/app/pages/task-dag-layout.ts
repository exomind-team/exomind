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

  // Build rank → leftmost real-node edge map for corridor X/Y alignment.
  // In LR mode, collect the minimum left-edge X per rank.
  // In TB mode, collect the minimum top-edge Y per rank.
  const rankLeadingEdge = new Map<number, number>();
  for (const node of nodes) {
    const layoutNode = graph.node(node.id);
    if (!layoutNode) {
      continue;
    }

    const size = direction === 'LR'
      ? (node.width ?? TASK_DAG_NODE_WIDTH)
      : (node.height ?? TASK_DAG_NODE_HEIGHT);
    const leadingEdge = direction === 'LR'
      ? layoutNode.x - size / 2
      : layoutNode.y - size / 2;
    const existing = rankLeadingEdge.get(layoutNode.rank);
    if (existing === undefined || leadingEdge < existing) {
      rankLeadingEdge.set(layoutNode.rank, leadingEdge);
    }
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

    // Snap intermediate (dummy) waypoints for cross-layer edges:
    // 1. Perpendicular-to-flow axis → align to target node center
    //    (LR: Y → target center Y; TB: X → target center X)
    // 2. Flow axis → align to the leading edge of the next rank's real nodes
    //    (LR: X → left edge of source's next rank; TB: Y → top edge)
    if (points.length > 2) {
      const sourceNode = graph.node(edge.v);
      const targetNode = graph.node(edge.w);
      if (sourceNode && targetNode) {
        // Find the next rank after source that has real nodes
        const sourceRank = sourceNode.rank;
        let corridorFlowCoord: number | undefined;
        for (let r = sourceRank + 1; r < targetNode.rank; r += 1) {
          const edge_pos = rankLeadingEdge.get(r);
          if (edge_pos !== undefined) {
            corridorFlowCoord = edge_pos;
            break;
          }
        }

        for (let i = 1; i < points.length - 1; i += 1) {
          if (direction === 'LR') {
            points[i] = {
              x: corridorFlowCoord ?? points[i].x,
              y: targetNode.y,
            };
          } else {
            points[i] = {
              x: targetNode.x,
              y: corridorFlowCoord ?? points[i].y,
            };
          }
        }
      }
    }

    edgePoints.set(buildDagLayoutEdgeKey(edge.v, edge.w), points);
  }

  return { nodePositions, edgePoints };
}
