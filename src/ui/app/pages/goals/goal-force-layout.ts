// ---------------------------------------------------------------------------
// Continuous force-directed simulation for goal graph (Obsidian-style)
// ---------------------------------------------------------------------------
// Nodes float, repel, and are connected by spring-like links.
// Me node is pinned at center. Dragged nodes snap to cursor then drift
// back after release.
// ---------------------------------------------------------------------------

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import type { GoalGraphData } from './goal-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForceNode extends SimulationNodeDatum {
  id: string;
  isMe: boolean;
}

interface ForceLink extends SimulationLinkDatum<ForceNode> {
  id?: string;
}

export type PositionMap = Map<string, { x: number; y: number }>;
type TickCallback = (positions: PositionMap) => void;

// ---------------------------------------------------------------------------
// GoalForceSimulation — long-lived, mutable, RAF-driven
// ---------------------------------------------------------------------------

export class GoalForceSimulation {
  private simulation: Simulation<ForceNode, ForceLink>;
  private nodes: ForceNode[] = [];
  private links: ForceLink[] = [];
  private readonly cx: number;
  private readonly cy: number;
  private readonly onTick: TickCallback;
  private rafId: number | null = null;
  private dirty = false;

  constructor(
    data: GoalGraphData,
    width: number,
    height: number,
    onTick: TickCallback,
  ) {
    this.cx = width / 2;
    this.cy = height / 2;
    this.onTick = onTick;

    this.buildNodesAndLinks(data, true);

    this.simulation = forceSimulation<ForceNode>(this.nodes)
      .force('charge', forceManyBody<ForceNode>().strength(-350))
      .force(
        'link',
        forceLink<ForceNode, ForceLink>(this.links)
          .id((d) => d.id)
          .distance(200)
          .strength(0.4),
      )
      .force('center', forceCenter<ForceNode>(this.cx, this.cy).strength(0.05))
      .force('collide', forceCollide<ForceNode>(55))
      .alphaDecay(0.018)
      .velocityDecay(0.35)
      .on('tick', () => {
        this.dirty = true;
      });

    this.startRafLoop();
  }

  // ---- RAF loop (batches d3 ticks into animation frames) ----

  private startRafLoop(): void {
    const loop = () => {
      if (this.dirty) {
        this.dirty = false;
        this.emitPositions();
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private emitPositions(): void {
    const positions: PositionMap = new Map();
    for (const node of this.nodes) {
      positions.set(node.id, {
        x: node.x ?? this.cx,
        y: node.y ?? this.cy,
      });
    }
    this.onTick(positions);
  }

  // ---- Data management ----

  private buildNodesAndLinks(data: GoalGraphData, initial: boolean): void {
    const existingById = new Map(this.nodes.map((n) => [n.id, n]));

    this.nodes = data.goals.map((g) => {
      const existing = existingById.get(g.id);
      if (existing) {
        existing.isMe = g.isMe;
        if (g.isMe) {
          existing.fx = this.cx;
          existing.fy = this.cy;
        }
        return existing;
      }
      // New node — scatter around center
      const angle = Math.random() * Math.PI * 2;
      const dist = initial ? 120 + Math.random() * 80 : 60 + Math.random() * 40;
      return {
        id: g.id,
        isMe: g.isMe,
        x: g.isMe ? this.cx : this.cx + Math.cos(angle) * dist,
        y: g.isMe ? this.cy : this.cy + Math.sin(angle) * dist,
        fx: g.isMe ? this.cx : null,
        fy: g.isMe ? this.cy : null,
      };
    });

    const nodeIds = new Set(this.nodes.map((n) => n.id));
    this.links = data.tasks
      .filter((t) => nodeIds.has(t.source) && nodeIds.has(t.target))
      .map((t) => ({ source: t.source, target: t.target }));
  }

  /** Merge new graph data into the live simulation (preserves positions). */
  updateData(data: GoalGraphData): void {
    this.buildNodesAndLinks(data, false);
    this.simulation.nodes(this.nodes);

    // Re-apply link force with updated links
    this.simulation.force(
      'link',
      forceLink<ForceNode, ForceLink>(this.links)
        .id((d) => d.id)
        .distance(200)
        .strength(0.4),
    );

    this.simulation.alpha(0.6).restart();
  }

  // ---- Drag interaction ----

  /** Pin a node to a specific position (during drag). */
  pinNode(id: string, x: number, y: number): void {
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    node.fx = x;
    node.fy = y;
    // Gentle reheat so other nodes react
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.15)).restart();
  }

  /** Release a pinned node (after drag). Me stays pinned. */
  releaseNode(id: string): void {
    const node = this.nodes.find((n) => n.id === id);
    if (node && !node.isMe) {
      node.fx = null;
      node.fy = null;
    }
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.3)).restart();
  }

  /** Give the simulation a kick. */
  reheat(): void {
    this.simulation.alpha(0.5).restart();
  }

  /** Stop simulation and cancel RAF. */
  destroy(): void {
    this.simulation.stop();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
