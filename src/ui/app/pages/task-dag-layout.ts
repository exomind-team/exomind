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
    ranksep: 60,
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

  // Build rank → boundary edge maps for corridor alignment.
  // Leading edge: leftmost node edge in LR (or topmost in TB).
  // Trailing edge: rightmost node edge in LR (or bottommost in TB).
  const rankLeadingEdge = new Map<number, number>();
  const rankTrailingEdge = new Map<number, number>();
  for (const node of nodes) {
    const layoutNode = graph.node(node.id);
    if (!layoutNode) {
      continue;
    }

    const size = direction === 'LR'
      ? (node.width ?? TASK_DAG_NODE_WIDTH)
      : (node.height ?? TASK_DAG_NODE_HEIGHT);
    const leading = direction === 'LR'
      ? layoutNode.x - size / 2
      : layoutNode.y - size / 2;
    const trailing = direction === 'LR'
      ? layoutNode.x + size / 2
      : layoutNode.y + size / 2;

    const existingLead = rankLeadingEdge.get(layoutNode.rank);
    if (existingLead === undefined || leading < existingLead) {
      rankLeadingEdge.set(layoutNode.rank, leading);
    }
    const existingTrail = rankTrailingEdge.get(layoutNode.rank);
    if (existingTrail === undefined || trailing > existingTrail) {
      rankTrailingEdge.set(layoutNode.rank, trailing);
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

    // Snap intermediate (dummy) waypoints for cross-layer edges.
    // Two candidate corridor waypoints exist (dual symmetry):
    //   A (entry): flow-coord = next-rank leading edge, cross-coord = target center
    //   B (exit):  flow-coord = prev-rank trailing edge, cross-coord = source center
    // Pick whichever produces a shorter total path (source → waypoint → target).
    if (points.length > 2) {
      const sourceNode = graph.node(edge.v);
      const targetNode = graph.node(edge.w);
      if (sourceNode && targetNode) {
        // Candidate A: entry waypoint near source
        let flowA: number | undefined;
        for (let r = sourceNode.rank + 1; r < targetNode.rank; r += 1) {
          const pos = rankLeadingEdge.get(r);
          if (pos !== undefined) { flowA = pos; break; }
        }

        // Candidate B: exit waypoint near target
        let flowB: number | undefined;
        for (let r = targetNode.rank - 1; r > sourceNode.rank; r -= 1) {
          const pos = rankTrailingEdge.get(r);
          if (pos !== undefined) { flowB = pos; break; }
        }

        // Use dagre's original corridor coordinate as a referee:
        // it implicitly encodes crossing-minimisation topology.
        // If dagre placed dummies closer to the target → entry waypoint (snap to target center).
        // If dagre placed dummies closer to the source → exit waypoint (snap to source center).
        const isLR = direction === 'LR';
        const dagreCorridor = isLR ? points[1].y : points[1].x;
        const sourceCross = isLR ? sourceNode.y : sourceNode.x;
        const targetCross = isLR ? targetNode.y : targetNode.x;
        const closerToTarget = Math.abs(dagreCorridor - targetCross)
                             <= Math.abs(dagreCorridor - sourceCross);

        let chosenFlow: number;
        let chosenCross: number;
        if (closerToTarget) {
          chosenFlow = flowA ?? (isLR ? points[1].x : points[1].y);
          chosenCross = targetCross;
        } else {
          chosenFlow = flowB ?? (isLR ? points[points.length - 2].x : points[points.length - 2].y);
          chosenCross = sourceCross;
        }

        for (let i = 1; i < points.length - 1; i += 1) {
          if (direction === 'LR') {
            points[i] = { x: chosenFlow, y: chosenCross };
          } else {
            points[i] = { x: chosenCross, y: chosenFlow };
          }
        }
      }
    }

    edgePoints.set(buildDagLayoutEdgeKey(edge.v, edge.w), points);
  }

  return { nodePositions, edgePoints };
}
