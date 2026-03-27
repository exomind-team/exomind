import {
  forceCollide,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force';
import { GOAL_NODE_SIZE, ME_NODE_SIZE } from './components/GoalFlowNode';
import { summarizeGraph, summarizePositions, warnGoalDebug } from './goal-debug';
import type { GoalGraph, NodeId } from './goal-types';

export interface ForceNode extends SimulationNodeDatum {
  id: NodeId;
  kind: 'me' | 'goal';
}

interface ForceLink {
  source: string;
  target: string;
}

interface EdgeSeparationSpec {
  pivot: NodeId;
  first: NodeId;
  second: NodeId;
  fallbackSign: 1 | -1;
}

export type ForcePairKind =
  | 'me-goal-repel'
  | 'goal-goal-near-repel'
  | 'goal-goal-far-attract';

export interface ForcePairSpec {
  source: NodeId;
  target: NodeId;
  kind: ForcePairKind;
  hopDistance: number | null;
  linked: boolean;
}

export type PositionMap = Map<string, { x: number; y: number }>;
type TickCallback = (positions: PositionMap) => void;

interface LayoutOptions {
  showCancelled?: boolean;
}

export interface GoalLayoutInitialPolar {
  angle: number;
  distance: number;
}

export interface GoalLayoutTestConfig {
  randomSeed?: number;
  fixedPolarSequence?: GoalLayoutInitialPolar[];
}

export interface GoalLayoutForceMask {
  meGoal?: boolean;
  goalGoal?: boolean;
  springLinks?: boolean;
  charge?: boolean;
  collide?: boolean;
  edgeSeparation?: boolean;
}

export interface GoalLayoutSimulationSample {
  before: PositionMap;
  after: PositionMap;
  alpha: number;
  stable: boolean;
  pairSpecs: ForcePairSpec[];
  links: Array<{ source: string; target: string }>;
}

const ME_GOAL_REPULSION_DISTANCE = 192;
const GOAL_NEAR_REPULSION_DISTANCE = 164;
const GOAL_FAR_ATTRACTION_DISTANCE = 308;
const ME_GOAL_REPULSION_STRENGTH = 0.08;
const GOAL_NEAR_REPULSION_STRENGTH = 0.055;
const GOAL_FAR_ATTRACTION_STRENGTH = 0.015;
const GOAL_LINK_DISTANCE = 186;
const GOAL_LINK_STRENGTH = 0.6;
const GOAL_COLLISION_RADIUS = 55;
const GOAL_CHARGE_STRENGTH = -15;
export const GOAL_LAYOUT_VELOCITY_DECAY = 0.01;
const ME_GOAL_LAYER_TOLERANCE = 12;
const EDGE_SEPARATION_STRENGTH = 0.055;
const EDGE_SEPARATION_EPSILON = 0.0001;

function getGoalLayoutTestConfig(): GoalLayoutTestConfig | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as typeof window & {
    __EXOMIND_GOAL_LAYOUT_TEST_CONFIG__?: GoalLayoutTestConfig;
  }).__EXOMIND_GOAL_LAYOUT_TEST_CONFIG__;
  return candidate ?? null;
}

export function createSeededGoalLayoutRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hashStringToUnitInterval(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

export function resolveGoalLayoutInitialPolar({
  initial,
  nextRandom,
  fixedPolarSequence,
  preferredAngle,
  preferredDistance,
  sequenceIndex,
  stableKey,
}: {
  initial: boolean;
  nextRandom: () => number;
  fixedPolarSequence?: GoalLayoutInitialPolar[];
  preferredAngle?: number;
  preferredDistance?: number;
  sequenceIndex: number;
  stableKey?: string;
}): GoalLayoutInitialPolar {
  const fixed = fixedPolarSequence?.[sequenceIndex];
  if (fixed) {
    return fixed;
  }

  const stableAngle = stableKey === undefined
    ? undefined
    : hashStringToUnitInterval(`${stableKey}:angle`) * Math.PI * 2;
  const stableDistanceFactor = stableKey === undefined
    ? undefined
    : hashStringToUnitInterval(`${stableKey}:distance`);

  return {
    angle: preferredAngle ?? stableAngle ?? nextRandom() * Math.PI * 2,
    distance: preferredDistance ?? (
      initial
        ? 120 + (stableDistanceFactor ?? nextRandom()) * 80
        : 60 + (stableDistanceFactor ?? nextRandom()) * 40
    ),
  };
}

export function resolveMeGoalRepulsionDistance(hopDistance: number | null): number {
  const resolvedHop = hopDistance !== null && hopDistance > 0 ? hopDistance : 1;
  return ME_GOAL_REPULSION_DISTANCE * resolvedHop;
}

export function resolveMeGoalRepulsionStrength(hopDistance: number | null): number {
  const resolvedHop = hopDistance !== null && hopDistance > 0 ? hopDistance : 1;
  return ME_GOAL_REPULSION_STRENGTH * resolvedHop;
}

function resolveGoalLayoutForceMask(mask?: GoalLayoutForceMask) {
  return {
    meGoal: mask?.meGoal ?? true,
    goalGoal: mask?.goalGoal ?? true,
    springLinks: mask?.springLinks ?? true,
    charge: mask?.charge ?? true,
    collide: mask?.collide ?? true,
    edgeSeparation: mask?.edgeSeparation ?? true,
  };
}

function getPairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function buildVisibleGraph(graph: GoalGraph, options?: LayoutOptions) {
  const showCancelled = options?.showCancelled ?? false;
  const visibleGoals = graph.goals.filter((goal) => showCancelled || !goal.cancelled);
  const visibleNodeIds = new Set<string>([graph.me.id, ...visibleGoals.map((goal) => goal.id)]);
  const visibleEdges = graph.edges.filter((edge) => (
    visibleNodeIds.has(String(edge.source)) && visibleNodeIds.has(String(edge.target))
  ));

  return {
    visibleGoals,
    visibleEdges,
  };
}

function buildHopAdjacency(graph: GoalGraph, options?: LayoutOptions) {
  const { visibleGoals, visibleEdges } = buildVisibleGraph(graph, options);
  const adjacency = new Map<string, Set<string>>();
  const nodeIds = [graph.me.id, ...visibleGoals.map((goal) => goal.id)];

  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, new Set());
  }

  for (const edge of visibleEdges) {
    adjacency.get(String(edge.source))?.add(String(edge.target));
    adjacency.get(String(edge.target))?.add(String(edge.source));
  }

  return adjacency;
}

function getHopDistanceBetween(adjacency: Map<string, Set<string>>, source: string, target: string): number | null {
  if (source === target) return 0;

  const visited = new Set([source]);
  const queue: Array<{ id: string; distance: number }> = [{ id: source, distance: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    for (const neighbor of adjacency.get(current.id) ?? []) {
      if (visited.has(neighbor)) continue;
      const nextDistance = current.distance + 1;
      if (neighbor === target) {
        return nextDistance;
      }
      visited.add(neighbor);
      queue.push({ id: neighbor, distance: nextDistance });
    }
  }

  return null;
}

export function buildSpringLinks(graph: GoalGraph, options?: LayoutOptions): Array<{ source: string; target: string }> {
  const { visibleEdges } = buildVisibleGraph(graph, options);
  const uniqueLinks = new Map<string, { source: string; target: string }>();

  for (const edge of visibleEdges) {
    const key = getPairKey(String(edge.source), String(edge.target));
    if (!uniqueLinks.has(key)) {
      uniqueLinks.set(key, {
        source: String(edge.source),
        target: String(edge.target),
      });
    }
  }

  return Array.from(uniqueLinks.values());
}

export function buildForcePairSpecs(graph: GoalGraph, options?: LayoutOptions): ForcePairSpec[] {
  const { visibleGoals } = buildVisibleGraph(graph, options);
  const adjacency = buildHopAdjacency(graph, options);
  const linkedGoalPairs = new Set(
    buildSpringLinks(graph, options)
      .filter((link) => link.source !== graph.me.id && link.target !== graph.me.id)
      .map((link) => getPairKey(link.source, link.target)),
  );
  const specs: ForcePairSpec[] = [];

  for (const goal of visibleGoals) {
    specs.push({
      source: graph.me.id,
      target: goal.id,
      kind: 'me-goal-repel',
      hopDistance: getHopDistanceBetween(adjacency, graph.me.id, goal.id),
      linked: false,
    });
  }

  for (let index = 0; index < visibleGoals.length; index += 1) {
    for (let inner = index + 1; inner < visibleGoals.length; inner += 1) {
      const source = visibleGoals[index];
      const target = visibleGoals[inner];
      const hopDistance = getHopDistanceBetween(adjacency, source.id, target.id);
      specs.push({
        source: source.id,
        target: target.id,
        kind: hopDistance !== null && hopDistance <= 2
          ? 'goal-goal-near-repel'
          : 'goal-goal-far-attract',
        hopDistance,
        linked: linkedGoalPairs.has(getPairKey(source.id, target.id)),
      });
    }
  }

  return specs;
}

function buildEdgeSeparationSpecs(graph: GoalGraph, options?: LayoutOptions): EdgeSeparationSpec[] {
  const { visibleGoals, visibleEdges } = buildVisibleGraph(graph, options);
  const visibleNodeIds = [graph.me.id, ...visibleGoals.map((goal) => goal.id)];
  const incidentByPivot = new Map<string, Set<string>>(visibleNodeIds.map((nodeId) => [nodeId, new Set<string>()]));
  const uniqueLogicalEdges = new Map<string, { source: string; target: string }>();

  for (const edge of visibleEdges) {
    const source = String(edge.source);
    const target = String(edge.target);
    const key = getPairKey(source, target);
    if (!uniqueLogicalEdges.has(key)) {
      uniqueLogicalEdges.set(key, { source, target });
    }
  }

  for (const edge of uniqueLogicalEdges.values()) {
    incidentByPivot.get(edge.source)?.add(edge.target);
    incidentByPivot.get(edge.target)?.add(edge.source);
  }

  const specs: EdgeSeparationSpec[] = [];
  for (const [pivot, neighbors] of incidentByPivot.entries()) {
    const orderedNeighbors = Array.from(neighbors).sort();
    for (let index = 0; index < orderedNeighbors.length; index += 1) {
      for (let inner = index + 1; inner < orderedNeighbors.length; inner += 1) {
        specs.push({
          pivot,
          first: orderedNeighbors[index],
          second: orderedNeighbors[inner],
          fallbackSign: 1,
        });
      }
    }
  }

  return specs;
}

function summarizeForcePairs(pairSpecs: ForcePairSpec[]) {
  return pairSpecs.reduce<Record<string, number>>((summary, pair) => {
    summary[pair.kind] = (summary[pair.kind] ?? 0) + 1;
    if (pair.linked) {
      summary.linked = (summary.linked ?? 0) + 1;
    }
    return summary;
  }, {});
}

function snapshotCenterPositions(nodes: ForceNode[]): PositionMap {
  const positions: PositionMap = new Map();
  for (const node of nodes) {
    positions.set(String(node.id), {
      x: node.x ?? 0,
      y: node.y ?? 0,
    });
  }
  return positions;
}

function buildGoalForceNodes({
  graph,
  options,
  initial,
  layoutTestConfig,
  nextRandom,
  initialPositions,
}: {
  graph: GoalGraph;
  options?: LayoutOptions;
  initial: boolean;
  layoutTestConfig?: GoalLayoutTestConfig | null;
  nextRandom: () => number;
  initialPositions?: Record<string, { x: number; y: number }>;
}) {
  const adjacency = buildHopAdjacency(graph, options);
  const { visibleGoals, visibleEdges } = buildVisibleGraph(graph, options);
  let placementSequenceIndex = 0;

  const nodes: ForceNode[] = [
    {
      id: graph.me.id,
      kind: 'me',
      x: initialPositions?.[graph.me.id]?.x ?? 0,
      y: initialPositions?.[graph.me.id]?.y ?? 0,
      fx: initialPositions?.[graph.me.id]?.x ?? 0,
      fy: initialPositions?.[graph.me.id]?.y ?? 0,
    },
    ...visibleGoals.map((goal) => {
      const forcedPosition = initialPositions?.[goal.id];
      if (forcedPosition) {
        return {
          id: goal.id,
          kind: 'goal' as const,
          x: forcedPosition.x,
          y: forcedPosition.y,
          fx: null,
          fy: null,
        };
      }

      const hopDistance = getHopDistanceBetween(adjacency, graph.me.id, goal.id);
      const inboundSourceId = visibleEdges.find((edge) => edge.target === goal.id)?.source;
      const inboundSourcePosition = inboundSourceId
        ? initialPositions?.[String(inboundSourceId)]
        : undefined;
      const parentRayAngle = inboundSourceId === graph.me.id
        ? Math.atan2(0, 0)
        : inboundSourcePosition
          ? Math.atan2(inboundSourcePosition.y, inboundSourcePosition.x)
          : undefined;
      const preferredAngle = parentRayAngle === undefined
        ? undefined
        : parentRayAngle + (nextRandom() - 0.5) * 0.24;
      const polar = resolveGoalLayoutInitialPolar({
        initial,
        nextRandom,
        fixedPolarSequence: layoutTestConfig?.fixedPolarSequence,
        preferredAngle,
        preferredDistance: hopDistance === null ? undefined : resolveMeGoalRepulsionDistance(hopDistance),
        sequenceIndex: placementSequenceIndex,
      });
      placementSequenceIndex += 1;
      return {
        id: goal.id,
        kind: 'goal' as const,
        x: Math.cos(polar.angle) * polar.distance,
        y: Math.sin(polar.angle) * polar.distance,
        fx: null,
        fy: null,
      };
    }),
  ];

  return {
    nodes,
    links: buildSpringLinks(graph, options).map((link) => ({
      source: link.source,
      target: link.target,
    })),
    pairSpecs: buildForcePairSpecs(graph, options),
  };
}

function filterForcePairSpecs(pairSpecs: ForcePairSpec[], mask: ReturnType<typeof resolveGoalLayoutForceMask>) {
  return pairSpecs.filter((pair) => {
    if (pair.kind === 'me-goal-repel') return mask.meGoal;
    return mask.goalGoal;
  });
}

export function simulateGoalLayoutTicks(
  graph: GoalGraph,
  {
    ticks = 60,
    options,
    layoutTestConfig,
    initialPositions,
    enabledForces,
  }: {
    ticks?: number;
    options?: LayoutOptions;
    layoutTestConfig?: GoalLayoutTestConfig | null;
    initialPositions?: Record<string, { x: number; y: number }>;
    enabledForces?: GoalLayoutForceMask;
  } = {},
): GoalLayoutSimulationSample {
  const mask = resolveGoalLayoutForceMask(enabledForces);
  const nextRandom = layoutTestConfig?.randomSeed !== undefined
    ? createSeededGoalLayoutRandom(layoutTestConfig.randomSeed)
    : Math.random;
  const built = buildGoalForceNodes({
    graph,
    options,
    initial: true,
    layoutTestConfig,
    nextRandom,
    initialPositions,
  });
  const pairSpecs = filterForcePairSpecs(built.pairSpecs, mask);
  const edgeSeparationSpecs = buildEdgeSeparationSpecs(graph, options);
  const before = snapshotCenterPositions(built.nodes);

  const simulation = forceSimulation<ForceNode>(built.nodes)
    .alpha(1)
    .alphaMin(0.003)
    .alphaDecay(0.024)
    .velocityDecay(GOAL_LAYOUT_VELOCITY_DECAY)
    .stop();

  if (mask.charge) {
    simulation.force('charge', forceManyBody<ForceNode>().strength((node) => (node.kind === 'me' ? 0 : GOAL_CHARGE_STRENGTH)));
  }
  if (pairSpecs.length > 0) {
    simulation.force('goal-relationship', createLayeredGoalForce(pairSpecs));
  }
  if (mask.springLinks && built.links.length > 0) {
    simulation.force('spring-links', createSpringAttractionForce(built.links));
  }
  if (mask.collide) {
    simulation.force('collide', forceCollide<ForceNode>(GOAL_COLLISION_RADIUS));
  }
  if (mask.edgeSeparation && edgeSeparationSpecs.length > 0) {
    simulation.force('edge-separation', createEdgeSeparationForce(edgeSeparationSpecs));
  }

  for (let index = 0; index < ticks; index += 1) {
    simulation.tick();
  }

  const after = snapshotCenterPositions(built.nodes);
  const stable = Number.isFinite(simulation.alpha())
    && simulation.alpha() < 0.2
    && built.nodes.every((node) => (
      Number.isFinite(node.x ?? NaN)
      && Number.isFinite(node.y ?? NaN)
      && Number.isFinite(node.vx ?? 0)
      && Number.isFinite(node.vy ?? 0)
    ));

  return {
    before,
    after,
    alpha: simulation.alpha(),
    stable,
    pairSpecs,
    links: built.links,
  };
}

function applyImpulse(node: ForceNode, x: number, y: number): void {
  if (node.fx !== null && node.fx !== undefined && node.fy !== null && node.fy !== undefined) {
    return;
  }
  node.vx = (node.vx ?? 0) + x;
  node.vy = (node.vy ?? 0) + y;
}

function getResolvedVector(source: ForceNode, target: ForceNode) {
  let dx = (target.x ?? 0) - (source.x ?? 0);
  let dy = (target.y ?? 0) - (source.y ?? 0);
  let distance = Math.hypot(dx, dy);

  if (distance > 0.0001) {
    return {
      dx,
      dy,
      distance,
      normalX: dx / distance,
      normalY: dy / distance,
    };
  }

  const fallbackAngle = (Number.parseInt(String(source.id).replace(/\D/g, ''), 10) || 1)
    + (Number.parseInt(String(target.id).replace(/\D/g, ''), 10) || 2);
  dx = Math.cos(fallbackAngle);
  dy = Math.sin(fallbackAngle);
  distance = 1;

  return {
    dx,
    dy,
    distance,
    normalX: dx,
    normalY: dy,
  };
}

function createLayeredGoalForce(pairSpecs: ForcePairSpec[]) {
  let nodeLookup = new Map<string, ForceNode>();

  const force = (alpha: number) => {
    for (const pair of pairSpecs) {
      const source = nodeLookup.get(String(pair.source));
      const target = nodeLookup.get(String(pair.target));
      if (!source || !target) continue;

      const vector = getResolvedVector(source, target);
      let impulse = 0;

      if (pair.kind === 'me-goal-repel') {
        const repulsionDistance = resolveMeGoalRepulsionDistance(pair.hopDistance);
        const repulsionStrength = resolveMeGoalRepulsionStrength(pair.hopDistance);
        const layerDelta = vector.distance - repulsionDistance;
        if (Math.abs(layerDelta) <= ME_GOAL_LAYER_TOLERANCE) continue;
        impulse = Math.abs(layerDelta) / repulsionDistance * repulsionStrength * alpha;
        if (layerDelta > 0) {
          applyImpulse(source, vector.normalX * impulse, vector.normalY * impulse);
          applyImpulse(target, -vector.normalX * impulse, -vector.normalY * impulse);
          continue;
        }
        applyImpulse(source, -vector.normalX * impulse, -vector.normalY * impulse);
        applyImpulse(target, vector.normalX * impulse, vector.normalY * impulse);
        continue;
      }

      if (pair.kind === 'goal-goal-near-repel') {
        const overlap = GOAL_NEAR_REPULSION_DISTANCE - vector.distance;
        if (overlap <= 0) continue;
        impulse = overlap / GOAL_NEAR_REPULSION_DISTANCE * GOAL_NEAR_REPULSION_STRENGTH * alpha;
        applyImpulse(source, -vector.normalX * impulse, -vector.normalY * impulse);
        applyImpulse(target, vector.normalX * impulse, vector.normalY * impulse);
        continue;
      }

      const stretch = vector.distance - GOAL_FAR_ATTRACTION_DISTANCE;
      if (stretch <= 0) continue;
      impulse = stretch / GOAL_FAR_ATTRACTION_DISTANCE * GOAL_FAR_ATTRACTION_STRENGTH * alpha;
      applyImpulse(source, vector.normalX * impulse, vector.normalY * impulse);
      applyImpulse(target, -vector.normalX * impulse, -vector.normalY * impulse);
    }
  };

  force.initialize = (nodes: ForceNode[]) => {
    nodeLookup = new Map(nodes.map((node) => [String(node.id), node]));
  };

  return force;
}

function createSpringAttractionForce(links: ForceLink[]) {
  let nodeLookup = new Map<string, ForceNode>();

  const force = (alpha: number) => {
    for (const link of links) {
      const source = nodeLookup.get(link.source);
      const target = nodeLookup.get(link.target);
      if (!source || !target) continue;

      const vector = getResolvedVector(source, target);
      const stretch = vector.distance - GOAL_LINK_DISTANCE;
      if (stretch <= 0) continue;

      const impulse = stretch / GOAL_LINK_DISTANCE * GOAL_LINK_STRENGTH * alpha;
      applyImpulse(source, vector.normalX * impulse, vector.normalY * impulse);
      applyImpulse(target, -vector.normalX * impulse, -vector.normalY * impulse);
    }
  };

  force.initialize = (nodes: ForceNode[]) => {
    nodeLookup = new Map(nodes.map((node) => [String(node.id), node]));
  };

  return force;
}

function applyTangentialImpulse(pivot: ForceNode, outer: ForceNode, sign: 1 | -1, magnitude: number) {
  const vector = getResolvedVector(pivot, outer);
  const ccwX = -vector.normalY;
  const ccwY = vector.normalX;
  applyImpulse(outer, ccwX * magnitude * sign, ccwY * magnitude * sign);
}

function createEdgeSeparationForce(specs: EdgeSeparationSpec[]) {
  let nodeLookup = new Map<string, ForceNode>();

  const force = (alpha: number) => {
    for (const spec of specs) {
      const pivot = nodeLookup.get(String(spec.pivot));
      const first = nodeLookup.get(String(spec.first));
      const second = nodeLookup.get(String(spec.second));
      if (!pivot || !first || !second) continue;

      const firstVector = getResolvedVector(pivot, first);
      const secondVector = getResolvedVector(pivot, second);
      const dot = Math.max(-1, Math.min(1, (
        firstVector.normalX * secondVector.normalX
        + firstVector.normalY * secondVector.normalY
      )));
      const compression = (1 + dot) / 2;
      if (compression <= 0) continue;

      const cross = firstVector.normalX * secondVector.normalY - firstVector.normalY * secondVector.normalX;
      const turnSign = Math.abs(cross) <= EDGE_SEPARATION_EPSILON
        ? spec.fallbackSign
        : (cross > 0 ? 1 : -1);
      const impulse = compression * EDGE_SEPARATION_STRENGTH * alpha;

      applyTangentialImpulse(pivot, first, turnSign === 1 ? -1 : 1, impulse);
      applyTangentialImpulse(pivot, second, turnSign === 1 ? 1 : -1, impulse);
    }
  };

  force.initialize = (nodes: ForceNode[]) => {
    nodeLookup = new Map(nodes.map((node) => [String(node.id), node]));
  };

  return force;
}

export class GoalForceSimulation {
  private simulation: Simulation<ForceNode, ForceLink>;
  private nodes: ForceNode[] = [];
  private links: ForceLink[] = [];
  private pairSpecs: ForcePairSpec[] = [];
  private edgeSeparationSpecs: EdgeSeparationSpec[] = [];
  private readonly cx = 0;
  private readonly cy = 0;
  private readonly onTick: TickCallback;
  private rafId: number | null = null;
  private dirty = false;
  private tickCount = 0;
  private emitCount = 0;
  private alphaLogBucket = 100;
  private placementSequenceIndex = 0;
  private nextRandom: () => number;
  private readonly randomSeed: number | null;
  private readonly layoutTestConfig: GoalLayoutTestConfig | null;

  constructor(
    graph: GoalGraph,
    _width: number,
    _height: number,
    onTick: TickCallback,
    options?: LayoutOptions,
  ) {
    this.onTick = onTick;
    this.layoutTestConfig = getGoalLayoutTestConfig();
    this.randomSeed = this.layoutTestConfig?.randomSeed ?? null;
    this.nextRandom = this.randomSeed !== null
      ? createSeededGoalLayoutRandom(this.randomSeed)
      : Math.random;
    this.buildNodesAndLinks(graph, true, options);
    warnGoalDebug('simulation:init', {
      graph: summarizeGraph(graph),
      visibleNodeCount: this.nodes.length,
      visibleLinkCount: this.links.length,
      positions: summarizePositions(this.snapshotPositions()),
      showCancelled: options?.showCancelled ?? false,
      layoutTestConfig: this.layoutTestConfig
        ? {
          randomSeed: this.layoutTestConfig.randomSeed ?? null,
          fixedPolarCount: this.layoutTestConfig.fixedPolarSequence?.length ?? 0,
        }
        : null,
    });

    this.simulation = forceSimulation<ForceNode>(this.nodes)
      .force('charge', forceManyBody<ForceNode>().strength((node) => (node.kind === 'me' ? 0 : GOAL_CHARGE_STRENGTH)))
      .force('goal-relationship', createLayeredGoalForce(this.pairSpecs))
      .force('spring-links', createSpringAttractionForce(this.links))
      .force('collide', forceCollide<ForceNode>(GOAL_COLLISION_RADIUS))
      .force('edge-separation', createEdgeSeparationForce(this.edgeSeparationSpecs))
      .alphaMin(0.003)
      .alphaDecay(0.024)
      .velocityDecay(GOAL_LAYOUT_VELOCITY_DECAY)
      .on('tick', () => {
        this.tickCount += 1;
        this.dirty = true;
        const alpha = this.simulation.alpha();
        const nextBucket = this.getAlphaLogBucket(alpha);
        if (this.tickCount <= 6 || this.tickCount % 20 === 0 || nextBucket !== this.alphaLogBucket) {
          this.alphaLogBucket = nextBucket;
          warnGoalDebug('simulation:tick', {
            tickCount: this.tickCount,
            alpha: Number(alpha.toFixed(4)),
            nodeCount: this.nodes.length,
            linkCount: this.links.length,
            positions: summarizePositions(this.snapshotPositions()),
          });
        }
      })
      .on('end', () => {
        warnGoalDebug('simulation:end', {
          tickCount: this.tickCount,
          emitCount: this.emitCount,
          alpha: Number(this.simulation.alpha().toFixed(4)),
          nodeCount: this.nodes.length,
          linkCount: this.links.length,
          dirty: this.dirty,
          positions: summarizePositions(this.snapshotPositions()),
        });
      });

    this.startRafLoop();
  }

  private getAlphaLogBucket(alpha: number): number {
    if (alpha <= 0.02) return 2;
    if (alpha <= 0.05) return 5;
    if (alpha <= 0.1) return 10;
    if (alpha <= 0.2) return 20;
    if (alpha <= 0.35) return 35;
    return 100;
  }

  private snapshotPositions(): PositionMap {
    const positions: PositionMap = new Map();
    for (const node of this.nodes) {
      const nodeSize = node.kind === 'me' ? ME_NODE_SIZE : GOAL_NODE_SIZE;
      positions.set(String(node.id), {
        x: (node.x ?? this.cx) - nodeSize / 2,
        y: (node.y ?? this.cy) - nodeSize / 2,
      });
    }
    return positions;
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
    const positions = this.snapshotPositions();
    this.emitCount += 1;
    if (this.emitCount <= 4 || this.emitCount % 20 === 0 || positions.size === 0) {
      warnGoalDebug('simulation:emit-positions', {
        emitCount: this.emitCount,
        tickCount: this.tickCount,
        alpha: Number(this.simulation.alpha().toFixed(4)),
        positions: summarizePositions(positions),
      });
    }
    this.onTick(positions);
  }

  private resetPlacementState(): void {
    this.placementSequenceIndex = 0;
    this.nextRandom = this.randomSeed !== null
      ? createSeededGoalLayoutRandom(this.randomSeed)
      : Math.random;
  }

  private buildNodesAndLinks(
    graph: GoalGraph,
    initial: boolean,
    options?: LayoutOptions,
    reuseExisting = true,
  ): void {
    const existingById = reuseExisting
      ? new Map(this.nodes.map((node) => [String(node.id), node]))
      : new Map<string, ForceNode>();
    const { visibleGoals, visibleEdges } = buildVisibleGraph(graph, options);
    const adjacency = buildHopAdjacency(graph, options);

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
        const hopDistance = getHopDistanceBetween(adjacency, graph.me.id, goal.id);
        const inboundSourceId = visibleEdges.find((edge) => edge.target === goal.id)?.source;
        const inboundSource = inboundSourceId === graph.me.id
          ? { x: this.cx, y: this.cy }
          : inboundSourceId
            ? existingById.get(String(inboundSourceId))
            : null;
        const parentRayAngle = inboundSource
          ? Math.atan2((inboundSource.y ?? this.cy) - this.cy, (inboundSource.x ?? this.cx) - this.cx)
          : undefined;
        const preferredAngle = parentRayAngle === undefined
          ? undefined
          : parentRayAngle + (this.nextRandom() - 0.5) * 0.24;
        const polar = resolveGoalLayoutInitialPolar({
          initial,
          nextRandom: this.nextRandom,
          fixedPolarSequence: this.layoutTestConfig?.fixedPolarSequence,
          preferredAngle,
          preferredDistance: hopDistance === null ? undefined : resolveMeGoalRepulsionDistance(hopDistance),
          sequenceIndex: this.placementSequenceIndex,
          stableKey: goal.id,
        });
        this.placementSequenceIndex += 1;
        return {
          id: goal.id,
          kind: 'goal' as const,
          x: this.cx + Math.cos(polar.angle) * polar.distance,
          y: this.cy + Math.sin(polar.angle) * polar.distance,
          fx: null,
          fy: null,
        };
      }),
    ];

    this.links = buildSpringLinks(graph, options).map((link) => ({
      source: link.source,
      target: link.target,
    }));
    this.pairSpecs = buildForcePairSpecs(graph, options);
    this.edgeSeparationSpecs = buildEdgeSeparationSpecs(graph, options);
  }

  updateData(graph: GoalGraph, options?: LayoutOptions): void {
    const previousNodeIds = new Set(
      this.nodes
        .map((node) => String(node.id))
        .filter((nodeId) => nodeId !== String(graph.me.id)),
    );
    const nextVisibleNodeIds = new Set(buildVisibleGraph(graph, options).visibleGoals.map((goal) => goal.id));
    const removedNodeIds = [...previousNodeIds].filter((nodeId) => !nextVisibleNodeIds.has(nodeId));
    const shouldResetLayout = removedNodeIds.length > 0;

    if (shouldResetLayout) {
      this.resetPlacementState();
      warnGoalDebug('simulation:reset-layout', {
        reason: 'visible-node-removed',
        removedNodeIds,
        remainingNodeIds: [...nextVisibleNodeIds],
        showCancelled: options?.showCancelled ?? false,
      });
    }

    this.buildNodesAndLinks(graph, shouldResetLayout, options, !shouldResetLayout);
    this.simulation.nodes(this.nodes);
    this.simulation.force('goal-relationship', createLayeredGoalForce(this.pairSpecs));
    this.simulation.force('spring-links', createSpringAttractionForce(this.links));
    this.simulation.force('edge-separation', createEdgeSeparationForce(this.edgeSeparationSpecs));
    warnGoalDebug('simulation:update-data', {
      graph: summarizeGraph(graph),
      visibleNodeCount: this.nodes.length,
      visibleLinkCount: this.links.length,
      forcePairs: summarizeForcePairs(this.pairSpecs),
      positions: summarizePositions(this.snapshotPositions()),
      showCancelled: options?.showCancelled ?? false,
    });
    this.simulation.alpha(0.6).restart();
  }

  pinNode(id: string, x: number, y: number): void {
    const node = this.nodes.find((candidate) => String(candidate.id) === id);
    if (!node || node.kind === 'me') return;
    node.fx = x;
    node.fy = y;
    warnGoalDebug('simulation:pin-node', {
      nodeId: id,
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      alphaBeforeRestart: Number(this.simulation.alpha().toFixed(4)),
    });
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.15)).restart();
  }

  releaseNode(id: string): void {
    const node = this.nodes.find((candidate) => String(candidate.id) === id);
    if (node && node.kind !== 'me') {
      node.fx = null;
      node.fy = null;
    }
    warnGoalDebug('simulation:release-node', {
      nodeId: id,
      alphaBeforeRestart: Number(this.simulation.alpha().toFixed(4)),
      nodeExists: Boolean(node),
    });
    this.simulation.alpha(Math.max(this.simulation.alpha(), 0.3)).restart();
  }

  reheat(): void {
    warnGoalDebug('simulation:reheat', {
      alphaBeforeRestart: Number(this.simulation.alpha().toFixed(4)),
      nodeCount: this.nodes.length,
      linkCount: this.links.length,
      forcePairs: summarizeForcePairs(this.pairSpecs),
    });
    this.simulation.alpha(0.5).restart();
  }

  destroy(): void {
    warnGoalDebug('simulation:destroy', {
      tickCount: this.tickCount,
      emitCount: this.emitCount,
      alpha: Number(this.simulation.alpha().toFixed(4)),
      positions: summarizePositions(this.snapshotPositions()),
    });
    this.simulation.stop();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
