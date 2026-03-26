export type GoalId = string;
export type MeId = string;
export type TaskEdgeId = string;
export type TaskNodeId = string;
export type Timestamp = number;
export type NodeId = GoalId | MeId;

export type TaskEdgeStatus =
  | 'pending'
  | 'in_progress'
  | 'suspended'
  | 'completed'
  | 'cancelled';

export type GoalDisplayStatus =
  | 'pending'
  | 'in_progress'
  | 'suspended'
  | 'completed'
  | 'cancelled';

export type CompletionRule = TaskEdgeId[][];

export interface GoalNode {
  id: GoalId;
  title: string;
  description: string;
  cancelled: boolean;
  completionRule: CompletionRule;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TaskEdge {
  id: TaskEdgeId;
  title: string;
  description: string;
  source: NodeId;
  target: GoalId;
  taskNodeRef?: TaskNodeId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MeNode {
  id: MeId;
  name: string;
}

export interface GoalGraph {
  me: MeNode;
  goals: GoalNode[];
  edges: TaskEdge[];
}

export interface GoalOpLog {
  action: string;
  timestamp: Timestamp;
  params: Record<string, unknown>;
  result?: unknown;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CreateGoalParams {
  fromNode: NodeId;
  direction: 'upstream' | 'downstream';
  title?: string;
  description?: string;
  rulePosition?: { clauseIndex: number };
}

export interface CreateEdgeParams {
  source: NodeId;
  target: GoalId;
  title?: string;
  description?: string;
  taskNodeRef?: TaskNodeId;
  rulePosition: { clauseIndex: number };
}

export interface CancelGoalParams {
  goalId: GoalId;
  cascadeInTasks?: boolean;
  cascadeOutTasks?: boolean;
}

export interface DeleteEdgeParams {
  edgeId: TaskEdgeId;
}

export interface UpdateGoalParams {
  goalId: GoalId;
  title?: string;
  description?: string;
  completionRule?: CompletionRule;
}

export interface UpdateEdgeParams {
  edgeId: TaskEdgeId;
  title?: string;
  description?: string;
  taskNodeRef?: TaskNodeId;
}

export interface GoalLogicOptions {
  now?: () => number;
  createId?: (prefix: string) => string;
  edgeOverrides?: ReadonlyMap<TaskEdgeId, TaskEdgeStatus>;
  getTaskStatus?: (taskNodeRef: TaskNodeId) => TaskEdgeStatus | undefined;
}
