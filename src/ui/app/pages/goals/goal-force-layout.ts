import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GoalGraph, NodeId } from './goal-types';

export interface ForceNode extends SimulationNodeDatum {
  id: NodeId;
  kind: 'me' | 'goal';
}

interface ForceLink extends SimulationLinkDatum<ForceNode> {}

export type PositionMap = Map<string, { x: number; y: number }>;
type TickCallback = (positions: PositionMap) => void;

interface LayoutOptions {
  showCancelled?: boolean;
}

export class GoalForceSimulation {
  private simulation: Simulation<ForceNode, ForceLink>;
  private nodes: ForceNode[] = [];
  private links: ForceLink[] = [];
  private readonly cx = 0;
  private readonly cy = 0;
  private readonly onTick: TickCallback;
  private rafId: number | null = null;
  private dirty = false;

  constructor(
    graph: GoalGraph,
    _width: number,
    _height: number,
    onTick: TickCallback,
    options?: LayoutOptions,
  ) {
    this.onTick = onTick;
    this.buildNodesAndLinks(graph, true, options);

    this.simulation = forceSimulation<ForceNode>(this.nodes)
      .force('charge', forceManyBody<ForceNode>().strength(-350))
      .force(
        'link',
        forceLink<ForceNode, ForceLink>(this.links)
          .id((node) => node.id)
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
      positions.set(String(node.id), {
        x: node.x ?? this.cx,
        y: node.y ?? this.cy,
      });
    }
    this.onTick(positions);
  }

  private buildNodesAndLinks(graph: GoalGraph, initial: boolean, options?: LayoutOptions): void {
    const existingById = new Map(this.nodes.map((node) => [String(node.id), node]));
    const showCancelled = options?.showCancelled ?? false;
    const visibleGoals = graph.goals.filter((goal) => showCancelled || !goal.cancelled);

    this.nodes = [
      {
        id: graph.me.id,
        kind: 'me',
        x: this.cx,
        y: this.cy,
        fx: this.cx,
        fy: this.cy,
      },
      ...visibleGoals.map((goal) => {
        const existing = existingById.get(goal.id);
        if (existing) {
          existing.kind = 'goal';
          return existing;
        }
        const angle = Math.random() * Math.PI * 2;
        const distance = initial ? 120 + Math.random() * 80 : 60 + Math.random() * 40;
        return {
          id: goal.id,
          kind: 'goal' as const,
          x: this.cx + Math.cos(angle) * distance,
          y: this.cy + Math.sin(angle) * distance,
          fx: null,
          fy: null,
        };
      }),
    ];

    const nodeIds = new Set(this.nodes.map((node) => String(node.id)));
    this.links = graph.edges
      .filter((edge) => nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target)))
      .map((edge) => ({ source: edge.source, target: edge.target }));
  }

  updateData(graph: GoalGraph, options?: LayoutOptions): void {
    this.buildNodesAndLinks(graph, false, options);
    this.simulation.nodes(this.nodes);
    this.simulation.force(
      'link',
      forceLink<ForceNode, ForceLink>(this.links)
        .id((node) => node.id)
        .distance(200)
        .strength(0.4),
    );
    this.simulation.alpha(0.6).restart();
  }

  pinNode(id: string, x: number, y: number): void {
    const node = this.nodes.find((candidate) => String(candidate.id) === id);
    if (!node || node.kind === 'me') return;
    node.fx = x;
    node.fy = y;
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.15)).restart();
  }

  releaseNode(id: string): void {
    const node = this.nodes.find((candidate) => String(candidate.id) === id);
    if (node && node.kind !== 'me') {
      node.fx = null;
      node.fy = null;
    }
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.3)).restart();
  }

  reheat(): void {
    this.simulation.alpha(0.5).restart();
  }

  destroy(): void {
    this.simulation.stop();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
