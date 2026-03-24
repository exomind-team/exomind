// ---------------------------------------------------------------------------
// Force-directed layout for the goal graph using d3-force
// ---------------------------------------------------------------------------

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import type { GoalGraphData } from './goal-store';

export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  isMe: boolean;
}

interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  id: string;
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

export function computeForceLayout(
  data: GoalGraphData,
  width: number,
  height: number,
): LayoutResult {
  const cx = width / 2;
  const cy = height / 2;

  const nodes: LayoutNode[] = data.goals.map((g) => ({
    id: g.id,
    isMe: g.isMe,
    ...(g.isMe ? { fx: cx, fy: cy } : {}),
  }));

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const links: LayoutLink[] = data.tasks
    .filter((t) => nodeById.has(t.source) && nodeById.has(t.target))
    .map((t) => ({
      id: t.id,
      source: t.source,
      target: t.target,
    }));

  const simulation = forceSimulation<LayoutNode>(nodes)
    .force('charge', forceManyBody<LayoutNode>().strength(-400))
    .force('link', forceLink<LayoutNode, LayoutLink>(links).id((d) => d.id).distance(180))
    .force('center', forceCenter<LayoutNode>(cx, cy))
    .force('collide', forceCollide<LayoutNode>(60))
    .stop();

  const tickCount = 120;
  for (let i = 0; i < tickCount; i++) {
    simulation.tick();
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    positions.set(node.id, { x: node.x ?? cx, y: node.y ?? cy });
  }

  return { positions };
}
