import { BaseEdge, getBezierPath, Position, type Edge, type EdgeProps } from '@xyflow/react';

export type DagreRoutedEdgeData = {
  points?: Array<{ x: number; y: number }> | null;
  hardEdge?: boolean;
};

type Point = { x: number; y: number };

const COLLINEAR_EPSILON = 0.5;
const POINT_EPSILON = 0.1;
export const DAGRE_EDGE_CORNER_RADIUS = 20;

function formatSvgNumber(value: number): string {
  const rounded = Number(value.toFixed(1));
  if (Object.is(rounded, -0)) {
    return '0';
  }

  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatPoint(point: Point): string {
  return `${formatSvgNumber(point.x)},${formatSvgNumber(point.y)}`;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalizeVector(from: Point, to: Point): Point {
  const length = distance(from, to);
  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: (to.x - from.x) / length,
    y: (to.y - from.y) / length,
  };
}

function isSamePoint(a: Point, b: Point, epsilon = POINT_EPSILON): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

function isCollinear(a: Point, b: Point, c: Point, epsilon = COLLINEAR_EPSILON): boolean {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) < epsilon;
}

function dedupeConsecutivePoints(points: Point[]): Point[] {
  const deduped: Point[] = [];

  for (const point of points) {
    if (deduped.length === 0 || !isSamePoint(deduped[deduped.length - 1], point)) {
      deduped.push(point);
    }
  }

  return deduped;
}

function removeCollinearIntermediatePoints(points: Point[]): Point[] {
  if (points.length <= 2) {
    return points;
  }

  const keyPoints: Point[] = [points[0]];

  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = keyPoints[keyPoints.length - 1];
    const current = points[index];
    const next = points[index + 1];

    if (isCollinear(prev, current, next)) {
      continue;
    }

    keyPoints.push(current);
  }

  keyPoints.push(points[points.length - 1]);
  return keyPoints;
}

function oppositePosition(pos: Position): Position {
  switch (pos) {
    case Position.Top: return Position.Bottom;
    case Position.Bottom: return Position.Top;
    case Position.Left: return Position.Right;
    case Position.Right: return Position.Left;
    default: return Position.Bottom;
  }
}

/**
 * Extract the cubic Bezier command (`C ...`) from a full SVG path string
 * returned by ReactFlow's `getBezierPath`. Strips the leading `M x,y` prefix.
 */
function extractBezierCommand(fullPath: string): string {
  const cIndex = fullPath.indexOf('C');
  return cIndex >= 0 ? fullPath.substring(cIndex) : `L ${fullPath}`;
}

type CornerData = {
  start: Point;
  end: Point;
  cp1: Point;
  cp2: Point;
};

function computeCorner(
  prev: Point,
  current: Point,
  next: Point,
  maxRadius: number,
): CornerData | null {
  const inLen = distance(prev, current);
  const outLen = distance(current, next);
  const radius = Math.min(maxRadius, inLen / 2, outLen / 2);
  if (radius <= 0) {
    return null;
  }

  const dIn = normalizeVector(prev, current);
  const dOut = normalizeVector(current, next);
  const start = { x: current.x - dIn.x * radius, y: current.y - dIn.y * radius };
  const end = { x: current.x + dOut.x * radius, y: current.y + dOut.y * radius };
  return {
    start,
    end,
    cp1: { x: start.x + dIn.x * (radius / 3), y: start.y + dIn.y * (radius / 3) },
    cp2: { x: end.x - dOut.x * (radius / 3), y: end.y - dOut.y * (radius / 3) },
  };
}

export function buildDagreRoutedPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  dagrePoints: Array<{ x: number; y: number }>,
  cornerRadius = DAGRE_EDGE_CORNER_RADIUS,
  sourcePosition?: Position,
  targetPosition?: Position,
): string {
  const combinedPoints = dedupeConsecutivePoints([
    { x: sourceX, y: sourceY },
    ...dagrePoints.slice(1, -1),
    { x: targetX, y: targetY },
  ]);

  const keyPoints = removeCollinearIntermediatePoints(combinedPoints);
  if (keyPoints.length <= 2) {
    return `M ${formatPoint(keyPoints[0])} L ${formatPoint(keyPoints[keyPoints.length - 1])}`;
  }

  // --- Phase 1: pre-compute corners at each interior key point ---
  const corners: (CornerData | null)[] = [];
  for (let i = 1; i < keyPoints.length - 1; i += 1) {
    corners.push(computeCorner(keyPoints[i - 1], keyPoints[i], keyPoints[i + 1], cornerRadius));
  }

  const useFlowBezier = sourcePosition != null && targetPosition != null;
  const commands: string[] = [`M ${formatPoint(keyPoints[0])}`];

  // --- Phase 2a: entry segment (source → first corner start) ---
  const firstCorner = corners[0] ?? null;
  const entryTarget = firstCorner ? firstCorner.start : keyPoints[1];

  if (useFlowBezier) {
    const [entryPath] = getBezierPath({
      sourceX: keyPoints[0].x,
      sourceY: keyPoints[0].y,
      sourcePosition,
      targetX: entryTarget.x,
      targetY: entryTarget.y,
      targetPosition: oppositePosition(sourcePosition),
    });
    commands.push(extractBezierCommand(entryPath));
  } else {
    commands.push(`L ${formatPoint(entryTarget)}`);
  }

  // --- Phase 2b: corners + corridor straight segments ---
  for (let i = 0; i < corners.length; i += 1) {
    const corner = corners[i];
    if (corner) {
      commands.push(
        `C ${formatPoint(corner.cp1)} ${formatPoint(corner.cp2)} ${formatPoint(corner.end)}`,
      );
    } else {
      // No corner (radius too small) — line through the key point
      commands.push(`L ${formatPoint(keyPoints[i + 1])}`);
    }

    // Straight segment to the next corner's start (if not the last corner)
    if (i < corners.length - 1) {
      const nextCorner = corners[i + 1];
      const nextTarget = nextCorner ? nextCorner.start : keyPoints[i + 2];
      commands.push(`L ${formatPoint(nextTarget)}`);
    }
  }

  // --- Phase 2c: exit segment (last corner end → target) ---
  const lastCorner = corners[corners.length - 1] ?? null;
  const exitFrom = lastCorner ? lastCorner.end : keyPoints[keyPoints.length - 2];
  const target = keyPoints[keyPoints.length - 1];

  if (useFlowBezier) {
    const [exitPath] = getBezierPath({
      sourceX: exitFrom.x,
      sourceY: exitFrom.y,
      sourcePosition: oppositePosition(targetPosition),
      targetX: target.x,
      targetY: target.y,
      targetPosition,
    });
    commands.push(extractBezierCommand(exitPath));
  } else {
    commands.push(`L ${formatPoint(target)}`);
  }

  return commands.join(' ');
}

export function DagreRoutedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps<Edge<DagreRoutedEdgeData>>): JSX.Element {
  const points = data?.points;

  // Adjacent-layer edges (≤3 dagre points) have no meaningful dummy routing —
  // use ReactFlow's built-in Bezier which produces smoother curves for short edges.
  // Cross-layer edges (≥4 points) carry dummy-node waypoints that must be followed
  // to preserve Sugiyama's crossing-minimisation result.
  if (!points || points.length <= 3) {
    const [path] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
  }

  const path = buildDagreRoutedPath(
    sourceX, sourceY, targetX, targetY, points,
    DAGRE_EDGE_CORNER_RADIUS, sourcePosition, targetPosition,
  );
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
