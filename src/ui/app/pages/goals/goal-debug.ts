import type { GoalGraph } from './goal-types';

type PointLike = { x: number; y: number };

export interface GraphSummary {
  meId: string;
  meName: string;
  totalGoals: number;
  activeGoals: number;
  cancelledGoals: number;
  totalEdges: number;
}

export interface ViewportSummary {
  x: number;
  y: number;
  zoom: number;
  xBucket: number;
  yBucket: number;
  zoomBucket: number;
}

export interface PositionSummary {
  count: number;
  ids: string[];
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minXBucket: number;
    maxXBucket: number;
    minYBucket: number;
    maxYBucket: number;
  } | null;
  centroid: {
    x: number;
    y: number;
  } | null;
  sample: Array<{
    id: string;
    x: number;
    y: number;
  }>;
}

let goalDebugSequence = 0;

function stringifyPayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return '"[unserializable-payload]"';
  }
}

function round(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function bucket(value: number, step = 24): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value / step) * step;
}

export function warnGoalDebug(event: string, payload: Record<string, unknown> = {}): void {
  goalDebugSequence += 1;
  console.warn(`[goals][#747][${goalDebugSequence}] ${event} ${stringifyPayload(payload)}`, payload);
}

export function summarizeGraph(graph: GoalGraph): GraphSummary {
  return {
    meId: graph.me.id,
    meName: graph.me.name,
    totalGoals: graph.goals.length,
    activeGoals: graph.goals.filter((goal) => !goal.cancelled).length,
    cancelledGoals: graph.goals.filter((goal) => goal.cancelled).length,
    totalEdges: graph.edges.length,
  };
}

export function summarizeViewport(viewport: { x: number; y: number; zoom: number }): ViewportSummary {
  return {
    x: round(viewport.x),
    y: round(viewport.y),
    zoom: round(viewport.zoom, 3),
    xBucket: bucket(viewport.x, 32),
    yBucket: bucket(viewport.y, 32),
    zoomBucket: round(viewport.zoom, 1),
  };
}

export function summarizePositions(positions: ReadonlyMap<string, PointLike>): PositionSummary {
  const entries = [...positions.entries()];
  if (entries.length === 0) {
    return {
      count: 0,
      ids: [],
      bounds: null,
      centroid: null,
      sample: [],
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let totalX = 0;
  let totalY = 0;
  const sample = entries
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .slice(0, 5)
    .map(([id, point]) => ({
      id,
      x: round(point.x),
      y: round(point.y),
    }));

  for (const [, point] of entries) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    totalX += point.x;
    totalY += point.y;
  }

  return {
    count: entries.length,
    ids: entries.map(([id]) => id).sort(),
    bounds: {
      minX: round(minX),
      maxX: round(maxX),
      minY: round(minY),
      maxY: round(maxY),
      minXBucket: bucket(minX),
      maxXBucket: bucket(maxX),
      minYBucket: bucket(minY),
      maxYBucket: bucket(maxY),
    },
    centroid: {
      x: round(totalX / entries.length),
      y: round(totalY / entries.length),
    },
    sample,
  };
}
