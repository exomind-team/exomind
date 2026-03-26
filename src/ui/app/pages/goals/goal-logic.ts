import type {
  CancelGoalParams,
  CompletionRule,
  CreateEdgeParams,
  CreateGoalParams,
  DeleteEdgeParams,
  GoalDisplayStatus,
  GoalGraph,
  GoalLogicOptions,
  GoalNode,
  NodeId,
  Result,
  SplitEdgeParams,
  TaskEdge,
  TaskEdgeId,
  TaskEdgeStatus,
  UpdateEdgeParams,
  UpdateGoalParams,
} from './goal-types';

function defaultCreateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowOf(options?: GoalLogicOptions): number {
  return options?.now?.() ?? Date.now();
}

function createIdOf(prefix: string, options?: GoalLogicOptions): string {
  return options?.createId?.(prefix) ?? defaultCreateId(prefix);
}

function cloneGraph(graph: GoalGraph): GoalGraph {
  return {
    me: { ...graph.me },
    goals: graph.goals.map((goal) => ({
      ...goal,
      completionRule: goal.completionRule.map((clause) => [...clause]),
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function findGoal(graph: GoalGraph, goalId: string): GoalNode | undefined {
  return graph.goals.find((goal) => goal.id === goalId);
}

function findEdge(graph: GoalGraph, edgeId: TaskEdgeId): TaskEdge | undefined {
  return graph.edges.find((edge) => edge.id === edgeId);
}

function nodeExists(graph: GoalGraph, nodeId: NodeId): boolean {
  return nodeId === graph.me.id || graph.goals.some((goal) => goal.id === nodeId);
}

function isCancelledGoal(graph: GoalGraph, nodeId: NodeId): boolean {
  return nodeId !== graph.me.id && Boolean(findGoal(graph, nodeId)?.cancelled);
}

function ruleIncludesOnlyInEdges(
  rule: CompletionRule,
  inEdgeIds: Set<string>,
): boolean {
  return rule.every((clause) => clause.every((edgeId) => inEdgeIds.has(edgeId)));
}

function dedupeClause(clause: string[]): string[] {
  return Array.from(new Set(clause));
}

function sanitizeCompletionRule(rule: CompletionRule): CompletionRule {
  return rule
    .map((clause) => dedupeClause(clause.filter(Boolean)))
    .filter((clause) => clause.length > 0);
}

function addEdgeToRule(rule: CompletionRule, edgeId: TaskEdgeId, clauseIndex: number): CompletionRule {
  const next = rule.map((clause) => [...clause]);
  const index = clauseIndex >= 0 ? clauseIndex : 0;

  if (!next[index]) {
    next[index] = [edgeId];
    return next;
  }

  if (!next[index].includes(edgeId)) {
    next[index].push(edgeId);
  }

  return next;
}

function removeEdgeFromRule(rule: CompletionRule, edgeId: TaskEdgeId): CompletionRule {
  return rule
    .map((clause) => clause.filter((candidate) => candidate !== edgeId))
    .filter((clause) => clause.length > 0);
}

function replaceEdgeInRule(rule: CompletionRule, previousEdgeId: TaskEdgeId, nextEdgeId: TaskEdgeId): CompletionRule {
  return rule
    .map((clause) => dedupeClause(clause.map((edgeId) => (edgeId === previousEdgeId ? nextEdgeId : edgeId))))
    .filter((clause) => clause.length > 0);
}

function isCompletedGoal(graph: GoalGraph, goalId: string, options?: GoalLogicOptions): boolean {
  const goal = findGoal(graph, goalId);
  if (!goal) return false;
  return deriveGoalDisplayStatus(goal, getInEdges(graph, goalId), { graph, ...options }) === 'completed';
}

export function getEdgeStatus(
  edge: TaskEdge,
  options?: Pick<GoalLogicOptions, 'edgeOverrides' | 'getTaskStatus'>,
): TaskEdgeStatus {
  const override = options?.edgeOverrides?.get(edge.id);
  if (override) return override;
  if (!edge.taskNodeRef) return 'pending';
  return options?.getTaskStatus?.(edge.taskNodeRef) ?? 'pending';
}

export function evaluateCompletion(
  rule: CompletionRule,
  options: Pick<GoalLogicOptions, 'edgeOverrides' | 'getTaskStatus'> & { graph: GoalGraph },
): boolean {
  if (rule.length === 0) return false;

  for (const clause of rule) {
    if (clause.length === 0) continue;
    const allCompleted = clause.every((edgeId) => {
      const edge = findEdge(options.graph, edgeId);
      if (!edge) return false;
      return getEdgeStatus(edge, options) === 'completed';
    });
    if (allCompleted) return true;
  }

  return false;
}

export function getInEdges(graph: GoalGraph, goalId: string): TaskEdge[] {
  return graph.edges.filter((edge) => edge.target === goalId);
}

export function getOutEdges(graph: GoalGraph, nodeId: NodeId): TaskEdge[] {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

export function deriveGoalDisplayStatus(
  goal: GoalNode,
  inEdges: TaskEdge[],
  options: Pick<GoalLogicOptions, 'edgeOverrides' | 'getTaskStatus'> & { graph: GoalGraph },
): GoalDisplayStatus {
  if (goal.cancelled) return 'cancelled';
  if (evaluateCompletion(goal.completionRule, options)) return 'completed';

  const statuses = inEdges.map((edge) => getEdgeStatus(edge, options));
  if (statuses.some((status) => status === 'in_progress')) return 'in_progress';
  if (statuses.some((status) => status === 'suspended')) return 'suspended';
  if (
    statuses.length > 0
    && statuses.every((status) => status === 'completed' || status === 'cancelled')
  ) {
    return 'suspended';
  }

  return 'pending';
}

export function wouldCreateCycle(
  graph: GoalGraph,
  source: NodeId,
  target: string,
  ignoreEdgeId?: string,
): boolean {
  const adjacency = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (edge.id === ignoreEdgeId) continue;
    const sourceGoal = edge.source === graph.me.id ? undefined : findGoal(graph, edge.source);
    const targetGoal = findGoal(graph, edge.target);
    if (sourceGoal?.cancelled || targetGoal?.cancelled) continue;

    const next = adjacency.get(edge.source) ?? [];
    next.push(edge.target);
    adjacency.set(edge.source, next);
  }

  const proposal = adjacency.get(source) ?? [];
  proposal.push(target);
  adjacency.set(source, proposal);

  const stack = [target];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      stack.push(next);
    }
  }

  return false;
}

export function createGoal(
  graph: GoalGraph,
  params: CreateGoalParams,
  options?: GoalLogicOptions,
): Result<{ graph: GoalGraph; goal: GoalNode; edge: TaskEdge }> {
  if (!nodeExists(graph, params.fromNode)) {
    return { ok: false, error: '源节点不存在' };
  }
  if (params.direction === 'upstream' && params.fromNode === graph.me.id) {
    return { ok: false, error: 'Me 不能作为上游创建目标的 target' };
  }
  if (params.direction === 'downstream' && isCancelledGoal(graph, params.fromNode)) {
    return { ok: false, error: '已取消的目标不能发起新任务' };
  }
  if (params.direction === 'upstream' && isCompletedGoal(graph, params.fromNode, options)) {
    return { ok: false, error: '已完成的目标不能添加新任务' };
  }

  const timestamp = nowOf(options);
  const goalId = createIdOf('goal', options);
  const edgeId = createIdOf('edge', options);
  const newGoal: GoalNode = {
    id: goalId,
    title: params.title ?? '',
    description: params.description ?? '',
    cancelled: false,
    completionRule: params.direction === 'downstream' ? [[edgeId]] : [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const newEdge: TaskEdge = {
    id: edgeId,
    title: '',
    description: '',
    source: params.direction === 'downstream' ? params.fromNode : goalId,
    target: params.direction === 'downstream' ? goalId : params.fromNode,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const nextGraph = cloneGraph(graph);
  nextGraph.goals.push(newGoal);
  nextGraph.edges.push(newEdge);

  if (params.direction === 'upstream') {
    const targetGoal = findGoal(nextGraph, params.fromNode);
    if (!targetGoal) {
      return { ok: false, error: '目标节点不存在' };
    }
    targetGoal.completionRule = addEdgeToRule(
      targetGoal.completionRule,
      newEdge.id,
      params.rulePosition?.clauseIndex ?? 0,
    );
    targetGoal.updatedAt = timestamp;
  }

  return { ok: true, value: { graph: nextGraph, goal: newGoal, edge: newEdge } };
}

export function createEdge(
  graph: GoalGraph,
  params: CreateEdgeParams,
  options?: GoalLogicOptions,
): Result<{ graph: GoalGraph; edge: TaskEdge }> {
  if (!nodeExists(graph, params.source) || !findGoal(graph, params.target)) {
    return { ok: false, error: '端点不存在' };
  }
  if (params.source === params.target) {
    return { ok: false, error: '不能连到自己' };
  }
  if (isCancelledGoal(graph, params.source)) {
    return { ok: false, error: '已取消的目标不能发起新任务' };
  }
  if (isCancelledGoal(graph, params.target) || isCompletedGoal(graph, params.target, options)) {
    return { ok: false, error: '已完成的目标不能添加新任务' };
  }
  if (wouldCreateCycle(graph, params.source, params.target)) {
    return { ok: false, error: '不能形成环' };
  }

  const timestamp = nowOf(options);
  const edge: TaskEdge = {
    id: createIdOf('edge', options),
    title: params.title ?? '',
    description: params.description ?? '',
    source: params.source,
    target: params.target,
    taskNodeRef: params.taskNodeRef,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const nextGraph = cloneGraph(graph);
  nextGraph.edges.push(edge);

  const targetGoal = findGoal(nextGraph, params.target) as GoalNode;
  targetGoal.completionRule = addEdgeToRule(
    targetGoal.completionRule,
    edge.id,
    params.rulePosition.clauseIndex,
  );
  targetGoal.updatedAt = timestamp;

  return { ok: true, value: { graph: nextGraph, edge } };
}

export function cancelGoal(
  graph: GoalGraph,
  params: CancelGoalParams,
  options?: GoalLogicOptions,
): Result<{ graph: GoalGraph }> {
  if (params.goalId === graph.me.id) {
    return { ok: false, error: 'Me 不可取消' };
  }

  const goal = findGoal(graph, params.goalId);
  if (!goal) return { ok: false, error: '目标不存在' };
  if (goal.cancelled) return { ok: false, error: '目标已取消' };
  if (isCompletedGoal(graph, goal.id, options)) {
    return { ok: false, error: '已完成的目标不能取消' };
  }

  const nextGraph = cloneGraph(graph);
  const nextGoal = findGoal(nextGraph, params.goalId) as GoalNode;
  nextGoal.cancelled = true;
  nextGoal.updatedAt = nowOf(options);
  return { ok: true, value: { graph: nextGraph } };
}

export function deleteEdge(
  graph: GoalGraph,
  params: DeleteEdgeParams,
  options?: GoalLogicOptions,
): Result<{ graph: GoalGraph; autoAddedEdge?: TaskEdge }> {
  const edge = findEdge(graph, params.edgeId);
  if (!edge) return { ok: false, error: '边不存在' };
  if (isCompletedGoal(graph, edge.target, options)) {
    return { ok: false, error: '已完成的目标不能修改入边' };
  }

  const timestamp = nowOf(options);
  const nextGraph = cloneGraph(graph);
  nextGraph.edges = nextGraph.edges.filter((candidate) => candidate.id !== params.edgeId);

  const targetGoal = findGoal(nextGraph, edge.target) as GoalNode;
  targetGoal.completionRule = removeEdgeFromRule(targetGoal.completionRule, edge.id);
  targetGoal.updatedAt = timestamp;

  const remainingInEdges = getInEdges(nextGraph, edge.target);
  if (remainingInEdges.length === 0) {
    const autoEdge: TaskEdge = {
      id: createIdOf('edge', options),
      title: '',
      description: '',
      source: nextGraph.me.id,
      target: edge.target,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    nextGraph.edges.push(autoEdge);
    targetGoal.completionRule = addEdgeToRule(targetGoal.completionRule, autoEdge.id, 0);
    targetGoal.updatedAt = timestamp;
    return { ok: true, value: { graph: nextGraph, autoAddedEdge: autoEdge } };
  }

  return { ok: true, value: { graph: nextGraph } };
}

export function splitEdge(
  graph: GoalGraph,
  params: SplitEdgeParams,
  options?: GoalLogicOptions,
): Result<{ graph: GoalGraph; midGoal: GoalNode; newEdge: TaskEdge }> {
  const edge = findEdge(graph, params.edgeId);
  if (!edge) return { ok: false, error: '边不存在' };
  if (isCompletedGoal(graph, edge.target, options)) {
    return { ok: false, error: '已完成目标的入边不可拆解' };
  }

  let existingGoal: GoalNode | undefined;
  if (params.insertMode === 'existing') {
    if (!params.existingGoalId) return { ok: false, error: '请选择中间目标' };
    existingGoal = findGoal(graph, params.existingGoalId);
    if (!existingGoal) return { ok: false, error: '中间目标不存在' };
    if (existingGoal.cancelled || isCompletedGoal(graph, existingGoal.id, options)) {
      return { ok: false, error: '中间目标不可用' };
    }
  }

  const midGoalId = params.insertMode === 'existing'
    ? params.existingGoalId as string
    : createIdOf('goal', options);

  if (midGoalId === edge.source || midGoalId === edge.target) {
    return { ok: false, error: '中间目标不能与原边端点重复' };
  }

  const newEdgeId = createIdOf('edge', options);
  const timestamp = nowOf(options);
  const originalEdgePlacement = params.originalEdgePlacement;
  const sourceToMid: TaskEdge = originalEdgePlacement === 'first-half'
    ? {
        ...edge,
        source: edge.source,
        target: midGoalId,
        updatedAt: timestamp,
      }
    : {
        id: newEdgeId,
        title: '',
        description: '',
        source: edge.source,
        target: midGoalId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  const midToTarget: TaskEdge = originalEdgePlacement === 'second-half'
    ? {
        ...edge,
        source: midGoalId,
        target: edge.target,
        updatedAt: timestamp,
      }
    : {
        id: newEdgeId,
        title: '',
        description: '',
        source: midGoalId,
        target: edge.target,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

  const validationGraph: GoalGraph = cloneGraph(graph);
  validationGraph.edges = validationGraph.edges.filter((candidate) => candidate.id !== edge.id);
  for (const candidate of [sourceToMid, midToTarget]) {
    if (candidate.source === candidate.target) {
      return { ok: false, error: '不能连到自己' };
    }
    if (wouldCreateCycle(validationGraph, candidate.source, candidate.target)) {
      return { ok: false, error: '不能形成环' };
    }
    validationGraph.edges.push(candidate);
  }

  const nextGraph = cloneGraph(graph);
  nextGraph.edges = nextGraph.edges.filter((candidate) => candidate.id !== edge.id);

  const midGoal = params.insertMode === 'existing'
    ? (findGoal(nextGraph, midGoalId) as GoalNode)
    : {
        id: midGoalId,
        title: params.newGoalTitle ?? '',
        description: params.newGoalDescription ?? '',
        cancelled: false,
        completionRule: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };

  if (params.insertMode === 'new') {
    nextGraph.goals.push(midGoal);
  }

  nextGraph.edges.push(sourceToMid);
  nextGraph.edges.push(midToTarget);

  if (params.insertMode === 'existing') {
    const nextMidGoal = findGoal(nextGraph, midGoalId) as GoalNode;
    nextMidGoal.completionRule = addEdgeToRule(
      nextMidGoal.completionRule,
      sourceToMid.target === midGoalId ? sourceToMid.id : midToTarget.id,
      params.rulePosition.clauseIndex,
    );
    nextMidGoal.updatedAt = timestamp;
  } else {
    const nextMidGoal = findGoal(nextGraph, midGoalId) as GoalNode;
    nextMidGoal.completionRule = [[sourceToMid.target === midGoalId ? sourceToMid.id : midToTarget.id]];
    nextMidGoal.updatedAt = timestamp;
  }

  const originalTargetGoal = findGoal(nextGraph, edge.target) as GoalNode;
  if (originalEdgePlacement === 'first-half') {
    originalTargetGoal.completionRule = replaceEdgeInRule(originalTargetGoal.completionRule, edge.id, midToTarget.id);
    originalTargetGoal.updatedAt = timestamp;
  }

  return {
    ok: true,
    value: {
      graph: nextGraph,
      midGoal,
      newEdge: originalEdgePlacement === 'second-half' ? sourceToMid : midToTarget,
    },
  };
}

export function updateGoal(
  graph: GoalGraph,
  params: UpdateGoalParams,
  options?: GoalLogicOptions,
): Result<{ graph: GoalGraph }> {
  const goal = findGoal(graph, params.goalId);
  if (!goal) return { ok: false, error: '目标不存在' };
  if (goal.cancelled || isCompletedGoal(graph, goal.id, options)) {
    return { ok: false, error: '当前目标已冻结' };
  }

  const nextGraph = cloneGraph(graph);
  const nextGoal = findGoal(nextGraph, params.goalId) as GoalNode;

  if (params.completionRule) {
    const normalizedRule = sanitizeCompletionRule(params.completionRule);
    const inEdgeIds = new Set(getInEdges(nextGraph, params.goalId).map((edge) => edge.id));
    if (!ruleIncludesOnlyInEdges(normalizedRule, inEdgeIds)) {
      return { ok: false, error: '完成规则只能引用当前目标的入边' };
    }
    nextGoal.completionRule = normalizedRule;
  }

  if (params.title !== undefined) nextGoal.title = params.title;
  if (params.description !== undefined) nextGoal.description = params.description;
  nextGoal.updatedAt = nowOf(options);

  return { ok: true, value: { graph: nextGraph } };
}

export function updateEdge(
  graph: GoalGraph,
  params: UpdateEdgeParams,
  options?: GoalLogicOptions,
): Result<{ graph: GoalGraph }> {
  const edge = findEdge(graph, params.edgeId);
  if (!edge) return { ok: false, error: '边不存在' };
  if (isCancelledGoal(graph, edge.target) || isCompletedGoal(graph, edge.target, options)) {
    return { ok: false, error: '当前边已冻结' };
  }

  const nextGraph = cloneGraph(graph);
  const nextEdge = findEdge(nextGraph, params.edgeId) as TaskEdge;
  if (params.title !== undefined) nextEdge.title = params.title;
  if (params.description !== undefined) nextEdge.description = params.description;
  if ('taskNodeRef' in params) nextEdge.taskNodeRef = params.taskNodeRef;
  nextEdge.updatedAt = nowOf(options);
  return { ok: true, value: { graph: nextGraph } };
}

export function getHopDistance(
  graph: GoalGraph,
  goalId: string,
  options?: Pick<GoalLogicOptions, 'edgeOverrides' | 'getTaskStatus'>,
): number {
  const queue: Array<{ nodeId: NodeId; distance: number }> = [{ nodeId: graph.me.id, distance: 0 }];
  const visited = new Set<NodeId>([graph.me.id]);

  while (queue.length > 0) {
    const current = queue.shift() as { nodeId: NodeId; distance: number };
    if (current.nodeId === goalId) return current.distance;

    for (const edge of getOutEdges(graph, current.nodeId)) {
      const targetGoal = findGoal(graph, edge.target);
      if (!targetGoal || targetGoal.cancelled) continue;
      if (getEdgeStatus(edge, options) === 'cancelled') continue;
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push({ nodeId: edge.target, distance: current.distance + 1 });
      }
    }
  }

  return Number.POSITIVE_INFINITY;
}

export function setEdgeStatusOverride(
  edgeOverrides: ReadonlyMap<TaskEdgeId, TaskEdgeStatus>,
  edgeId: TaskEdgeId,
  status: TaskEdgeStatus,
): Map<TaskEdgeId, TaskEdgeStatus> {
  const next = new Map(edgeOverrides);
  next.set(edgeId, status);
  return next;
}

export function clearEdgeStatusOverride(
  edgeOverrides: ReadonlyMap<TaskEdgeId, TaskEdgeStatus>,
  edgeId: TaskEdgeId,
): Map<TaskEdgeId, TaskEdgeStatus> {
  const next = new Map(edgeOverrides);
  next.delete(edgeId);
  return next;
}

export function clearAllEdgeStatusOverrides(
  _edgeOverrides: ReadonlyMap<TaskEdgeId, TaskEdgeStatus>,
): Map<TaskEdgeId, TaskEdgeStatus> {
  return new Map();
}
