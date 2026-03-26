import { create } from 'zustand';
import {
  cancelGoal as cancelGoalLogic,
  clearAllEdgeStatusOverrides as clearAllEdgeStatusOverridesLogic,
  clearEdgeStatusOverride as clearEdgeStatusOverrideLogic,
  createEdge as createEdgeLogic,
  createGoal as createGoalLogic,
  deleteEdge as deleteEdgeLogic,
  deriveGoalDisplayStatus as deriveGoalDisplayStatusLogic,
  getEdgeStatus as getEdgeStatusLogic,
  getHopDistance as getHopDistanceLogic,
  getInEdges as getInEdgesLogic,
  getOutEdges as getOutEdgesLogic,
  setEdgeStatusOverride as setEdgeStatusOverrideLogic,
  splitEdge as splitEdgeLogic,
  updateEdge as updateEdgeLogic,
  updateGoal as updateGoalLogic,
} from './goal-logic';
import type {
  CancelGoalParams,
  CreateEdgeParams,
  CreateGoalParams,
  GoalDisplayStatus,
  GoalGraph,
  GoalNode,
  GoalOpLog,
  Result,
  SplitEdgeParams,
  TaskEdge,
  TaskEdgeStatus,
  UpdateEdgeParams,
  UpdateGoalParams,
} from './goal-types';

export const GOAL_GRAPH_STORAGE_KEY = 'exomind:goal-graph';
export const GOAL_OPLOG_STORAGE_KEY = 'exomind:goal-oplog';

interface LegacyGoalNode {
  id: string;
  name: string;
  status: 'pending' | 'completed' | 'cancelled';
  achieveMode: 'AND' | 'OR';
  isMe: boolean;
}

interface LegacyTaskEdge {
  id: string;
  name: string;
  source: string;
  target: string;
  status: TaskEdgeStatus;
}

interface LegacyGoalGraphData {
  goals: LegacyGoalNode[];
  tasks: LegacyTaskEdge[];
}

interface LoadedGoalState {
  graph: GoalGraph;
  opLog: GoalOpLog[];
  edgeOverrides: Map<string, TaskEdgeStatus>;
}

export interface GoalStoreState {
  graph: GoalGraph;
  edgeOverrides: Map<string, TaskEdgeStatus>;
  opLog: GoalOpLog[];
  updateMe: (name: string) => Result<void>;
  getEdgeStatus: (edgeId: string) => TaskEdgeStatus;
  deriveGoalDisplayStatus: (goalId: string) => GoalDisplayStatus;
  getInEdges: (goalId: string) => TaskEdge[];
  getOutEdges: (nodeId: string) => TaskEdge[];
  getHopDistance: (goalId: string) => number;
  createGoal: (params: CreateGoalParams) => Result<{ goal: GoalNode; edge: TaskEdge }>;
  createEdge: (params: CreateEdgeParams) => Result<TaskEdge>;
  cancelGoal: (params: CancelGoalParams) => Result<void>;
  deleteEdge: (params: { edgeId: string }) => Result<{ autoAddedEdgeId?: string; adjustedRule: boolean }>;
  splitEdge: (params: SplitEdgeParams) => Result<{ midGoal: GoalNode; newEdge: TaskEdge }>;
  updateGoal: (params: UpdateGoalParams) => Result<void>;
  updateEdge: (params: UpdateEdgeParams) => Result<void>;
  setEdgeStatusOverride: (edgeId: string, status: TaskEdgeStatus) => void;
  clearEdgeStatusOverride: (edgeId: string) => void;
  clearAllEdgeStatusOverrides: () => void;
}

export function createEmptyGoalGraph(): GoalGraph {
  return {
    me: { id: 'me', name: 'Me' },
    goals: [],
    edges: [],
  };
}

function parseStoredOpLog(): GoalOpLog[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GOAL_OPLOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GoalOpLog[]) : [];
  } catch {
    return [];
  }
}

function isGoalGraph(value: unknown): value is GoalGraph {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as GoalGraph;
  return Boolean(
    candidate.me
      && typeof candidate.me.id === 'string'
      && Array.isArray(candidate.goals)
      && Array.isArray(candidate.edges),
  );
}

function isLegacyGoalGraph(value: unknown): value is LegacyGoalGraphData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as LegacyGoalGraphData;
  return Array.isArray(candidate.goals) && Array.isArray(candidate.tasks);
}

export function migrateLegacyGoalGraph(legacy: LegacyGoalGraphData): LoadedGoalState {
  const meGoal = legacy.goals.find((goal) => goal.isMe);
  const me = {
    id: meGoal?.id ?? 'me',
    name: meGoal?.name ?? 'Me',
  };

  const edgeOverrides = new Map<string, TaskEdgeStatus>();
  const edges: TaskEdge[] = legacy.tasks.map((task, index) => {
    if (task.status !== 'pending') {
      edgeOverrides.set(task.id, task.status);
    }
    return {
      id: task.id,
      title: task.name,
      description: '',
      source: task.source,
      target: task.target,
      createdAt: index + 1,
      updatedAt: index + 1,
    };
  });

  const goals: GoalNode[] = legacy.goals
    .filter((goal) => !goal.isMe)
    .map((goal, index) => {
      const inbound = edges.filter((edge) => edge.target === goal.id);
      if (goal.status === 'completed') {
        inbound.forEach((edge) => edgeOverrides.set(edge.id, 'completed'));
      }
      const completionRule = inbound.length === 0
        ? []
        : goal.achieveMode === 'OR'
          ? inbound.map((edge) => [edge.id])
          : [inbound.map((edge) => edge.id)];

      return {
        id: goal.id,
        title: goal.name,
        description: '',
        cancelled: goal.status === 'cancelled',
        completionRule,
        createdAt: index + 1,
        updatedAt: index + 1,
      };
    });

  return {
    graph: { me, goals, edges },
    edgeOverrides,
    opLog: [],
  };
}

function loadStoredGoalState(): LoadedGoalState {
  const fallback = {
    graph: createEmptyGoalGraph(),
    opLog: [],
    edgeOverrides: new Map<string, TaskEdgeStatus>(),
  };

  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(GOAL_GRAPH_STORAGE_KEY);
    if (!raw) {
      return { ...fallback, opLog: parseStoredOpLog() };
    }

    const parsed = JSON.parse(raw);
    if (isGoalGraph(parsed)) {
      return {
        graph: parsed,
        opLog: parseStoredOpLog(),
        edgeOverrides: new Map<string, TaskEdgeStatus>(),
      };
    }

    if (isLegacyGoalGraph(parsed)) {
      const migrated = migrateLegacyGoalGraph(parsed);
      persistGoalState(migrated.graph, migrated.opLog);
      return migrated;
    }

    return { ...fallback, opLog: parseStoredOpLog() };
  } catch {
    return { ...fallback, opLog: parseStoredOpLog() };
  }
}

function persistGoalState(graph: GoalGraph, opLog: GoalOpLog[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GOAL_GRAPH_STORAGE_KEY, JSON.stringify(graph));
  window.localStorage.setItem(GOAL_OPLOG_STORAGE_KEY, JSON.stringify(opLog));
}

function appendOpLog(
  current: GoalOpLog[],
  action: string,
  params: Record<string, unknown>,
  result?: unknown,
): GoalOpLog[] {
  return [
    ...current,
    {
      action,
      timestamp: Date.now(),
      params,
      result,
    },
  ];
}

const initialState = loadStoredGoalState();

export const useGoalStore = create<GoalStoreState>((set, get) => ({
  graph: initialState.graph,
  opLog: initialState.opLog,
  edgeOverrides: initialState.edgeOverrides,
  updateMe: (name) => {
    const state = get();
    const normalized = name.trim() || 'Me';
    const nextGraph: GoalGraph = {
      ...state.graph,
      me: {
        ...state.graph.me,
        name: normalized,
      },
    };
    const nextOpLog = appendOpLog(state.opLog, 'updateMe', { name: normalized });
    persistGoalState(nextGraph, nextOpLog);
    set({ graph: nextGraph, opLog: nextOpLog });
    return { ok: true, value: undefined };
  },
  getEdgeStatus: (edgeId) => {
    const edge = get().graph.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return 'pending';
    return getEdgeStatusLogic(edge, { edgeOverrides: get().edgeOverrides });
  },
  deriveGoalDisplayStatus: (goalId) => {
    const goal = get().graph.goals.find((candidate) => candidate.id === goalId);
    if (!goal) return 'pending';
    return deriveGoalDisplayStatusLogic(goal, getInEdgesLogic(get().graph, goalId), {
      graph: get().graph,
      edgeOverrides: get().edgeOverrides,
    });
  },
  getInEdges: (goalId) => getInEdgesLogic(get().graph, goalId),
  getOutEdges: (nodeId) => getOutEdgesLogic(get().graph, nodeId),
  getHopDistance: (goalId) => getHopDistanceLogic(get().graph, goalId, {
    edgeOverrides: get().edgeOverrides,
  }),
  createGoal: (params) => {
    const state = get();
    const result = createGoalLogic(state.graph, params, { edgeOverrides: state.edgeOverrides });
    if (!result.ok) return result;
    const nextOpLog = appendOpLog(state.opLog, 'createGoal', params as unknown as Record<string, unknown>, {
      goalId: result.value.goal.id,
      edgeId: result.value.edge.id,
    });
    persistGoalState(result.value.graph, nextOpLog);
    set({ graph: result.value.graph, opLog: nextOpLog });
    return {
      ok: true,
      value: { goal: result.value.goal, edge: result.value.edge },
    };
  },
  createEdge: (params) => {
    const state = get();
    const result = createEdgeLogic(state.graph, params, { edgeOverrides: state.edgeOverrides });
    if (!result.ok) return result;
    const nextOpLog = appendOpLog(state.opLog, 'createEdge', params as unknown as Record<string, unknown>, {
      edgeId: result.value.edge.id,
    });
    persistGoalState(result.value.graph, nextOpLog);
    set({ graph: result.value.graph, opLog: nextOpLog });
    return { ok: true, value: result.value.edge };
  },
  cancelGoal: (params) => {
    const state = get();
    const result = cancelGoalLogic(state.graph, params, { edgeOverrides: state.edgeOverrides });
    if (!result.ok) return result;
    const nextOpLog = appendOpLog(state.opLog, 'cancelGoal', params as unknown as Record<string, unknown>);
    persistGoalState(result.value.graph, nextOpLog);
    set({ graph: result.value.graph, opLog: nextOpLog });
    return { ok: true, value: undefined };
  },
  deleteEdge: (params) => {
    const state = get();
    const result = deleteEdgeLogic(state.graph, params, { edgeOverrides: state.edgeOverrides });
    if (!result.ok) return result;
    const nextOpLog = appendOpLog(state.opLog, 'deleteEdge', params as unknown as Record<string, unknown>, {
      autoAddedEdgeId: result.value.autoAddedEdge?.id,
    });
    persistGoalState(result.value.graph, nextOpLog);
    set({ graph: result.value.graph, opLog: nextOpLog });
    return {
      ok: true,
      value: {
        autoAddedEdgeId: result.value.autoAddedEdge?.id,
        adjustedRule: true,
      },
    };
  },
  splitEdge: (params) => {
    const state = get();
    const result = splitEdgeLogic(state.graph, params, { edgeOverrides: state.edgeOverrides });
    if (!result.ok) return result;
    const nextOpLog = appendOpLog(state.opLog, 'splitEdge', params as unknown as Record<string, unknown>, {
      midGoalId: result.value.midGoal.id,
      newEdgeId: result.value.newEdge.id,
    });
    persistGoalState(result.value.graph, nextOpLog);
    set({ graph: result.value.graph, opLog: nextOpLog });
    return {
      ok: true,
      value: {
        midGoal: result.value.midGoal,
        newEdge: result.value.newEdge,
      },
    };
  },
  updateGoal: (params) => {
    const state = get();
    const result = updateGoalLogic(state.graph, params, { edgeOverrides: state.edgeOverrides });
    if (!result.ok) return result;
    const nextOpLog = appendOpLog(state.opLog, 'updateGoal', params as unknown as Record<string, unknown>);
    persistGoalState(result.value.graph, nextOpLog);
    set({ graph: result.value.graph, opLog: nextOpLog });
    return { ok: true, value: undefined };
  },
  updateEdge: (params) => {
    const state = get();
    const result = updateEdgeLogic(state.graph, params, { edgeOverrides: state.edgeOverrides });
    if (!result.ok) return result;
    const nextOpLog = appendOpLog(state.opLog, 'updateEdge', params as unknown as Record<string, unknown>);
    persistGoalState(result.value.graph, nextOpLog);
    set({ graph: result.value.graph, opLog: nextOpLog });
    return { ok: true, value: undefined };
  },
  setEdgeStatusOverride: (edgeId, status) => {
    set((state) => ({
      edgeOverrides: setEdgeStatusOverrideLogic(state.edgeOverrides, edgeId, status),
    }));
  },
  clearEdgeStatusOverride: (edgeId) => {
    set((state) => ({
      edgeOverrides: clearEdgeStatusOverrideLogic(state.edgeOverrides, edgeId),
    }));
  },
  clearAllEdgeStatusOverrides: () => {
    set((state) => ({
      edgeOverrides: clearAllEdgeStatusOverridesLogic(state.edgeOverrides),
    }));
  },
}));
