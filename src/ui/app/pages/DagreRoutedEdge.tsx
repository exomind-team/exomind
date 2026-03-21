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

  // When flow-direction positions are available, render every segment as a
  // ReactFlow Bezier curve.  Each curve starts/ends with zero slope in the
  // flow direction, producing consistently smooth transitions at every
  // waypoint — entry, corridor bends, and exit alike.
  if (sourcePosition != null && targetPosition != null) {
    return buildAllBezierPath(keyPoints, sourcePosition, targetPosition);
  }

  // Fallback: polyline with rounded corners (used by unit tests without positions).
  return buildRoundedPolylinePath(keyPoints, cornerRadius);
}

/**
 * Every segment between consecutive key points is rendered using ReactFlow's
 * `getBezierPath`, with control points aligned to the layout flow direction.
 *
 * For a TB layout every segment uses Bottom → Top; for LR it uses Right → Left.
 * The result is a chain of smooth S-curves that naturally straighten out when
 * consecutive points share the same axis (vertical/horizontal corridor).
 */
function buildAllBezierPath(
  keyPoints: Point[],
  sourcePosition: Position,
  _targetPosition: Position,
): string {
  const tgtPos = oppositePosition(sourcePosition);
  const segments: string[] = [];

  for (let i = 0; i < keyPoints.length - 1; i += 1) {
    const from = keyPoints[i];
    const to = keyPoints[i + 1];
    const [segPath] = getBezierPath({
      sourceX: from.x,
      sourceY: from.y,
      sourcePosition,
      targetX: to.x,
      targetY: to.y,
      targetPosition: tgtPos,
    });

    if (i === 0) {
      segments.push(segPath);
    } else {
      segments.push(extractBezierCommand(segPath));
    }
  }

  return segments.join(' ');
}

/**
 * Legacy path builder: straight segments (`L`) with cubic Bézier rounded
 * corners (`C`) at each bend.  Kept as fallback for contexts where
 * ReactFlow Position information is unavailable (e.g. pure unit tests).
 */
function buildRoundedPolylinePath(keyPoints: Point[], cornerRadius: number): string {
  const commands = [`M ${formatPoint(keyPoints[0])}`];

  for (let index = 1; index < keyPoints.length - 1; index += 1) {
    const prev = keyPoints[index - 1];
    const current = keyPoints[index];
    const next = keyPoints[index + 1];
    const incomingLength = distance(prev, current);
    const outgoingLength = distance(current, next);
    const radius = Math.min(cornerRadius, incomingLength / 2, outgoingLength / 2);

    if (radius <= 0) {
      commands.push(`L ${formatPoint(current)}`);
      continue;
    }

    const incomingDirection = normalizeVector(prev, current);
    const outgoingDirection = normalizeVector(current, next);
    const start = {
      x: current.x - incomingDirection.x * radius,
      y: current.y - incomingDirection.y * radius,
    };
    const end = {
      x: current.x + outgoingDirection.x * radius,
      y: current.y + outgoingDirection.y * radius,
    };
    const controlPoint1 = {
      x: start.x + incomingDirection.x * (radius / 3),
      y: start.y + incomingDirection.y * (radius / 3),
    };
    const controlPoint2 = {
      x: end.x - outgoingDirection.x * (radius / 3),
      y: end.y - outgoingDirection.y * (radius / 3),
    };

    commands.push(`L ${formatPoint(start)}`);
    commands.push(`C ${formatPoint(controlPoint1)} ${formatPoint(controlPoint2)} ${formatPoint(end)}`);
  }

  commands.push(`L ${formatPoint(keyPoints[keyPoints.length - 1])}`);
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

  // Snap intermediate dummy points to the actual ReactFlow handle coordinate
  // so the corridor aligns precisely — no residual curves.
  // The layout layer already chose source vs target alignment based on dagre's
  // corridor position; here we refine to the exact handle coordinate.
  const isHorizontalFlow = sourcePosition === Position.Right || sourcePosition === Position.Left;
  const corridorCross = isHorizontalFlow ? points[1].y : points[1].x;
  const closerToTarget = isHorizontalFlow
    ? Math.abs(corridorCross - targetY) <= Math.abs(corridorCross - sourceY)
    : Math.abs(corridorCross - targetX) <= Math.abs(corridorCross - sourceX);
  const snapCrossValue = isHorizontalFlow
    ? (closerToTarget ? targetY : sourceY)
    : (closerToTarget ? targetX : sourceX);
  const snappedPoints = points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    return isHorizontalFlow
      ? { x: p.x, y: snapCrossValue }
      : { x: snapCrossValue, y: p.y };
  });

  const path = buildDagreRoutedPath(
    sourceX, sourceY, targetX, targetY, snappedPoints,
    DAGRE_EDGE_CORNER_RADIUS, sourcePosition, targetPosition,
  );
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
