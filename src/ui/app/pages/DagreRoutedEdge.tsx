import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';

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

export function buildDagreRoutedPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  dagrePoints: Array<{ x: number; y: number }>,
  cornerRadius = DAGRE_EDGE_CORNER_RADIUS,
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

  const path = buildDagreRoutedPath(sourceX, sourceY, targetX, targetY, points);
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />;
}
