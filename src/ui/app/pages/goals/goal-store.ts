// ---------------------------------------------------------------------------
// Goal Graph Data Model + localStorage Persistence
// ---------------------------------------------------------------------------

export type GoalStatus = 'pending' | 'completed' | 'cancelled';
export type AchieveMode = 'AND' | 'OR';

export interface GoalNode {
  id: string;
  name: string;
  status: GoalStatus;
  achieveMode: AchieveMode;
  isMe: boolean;
}

export type TaskEdgeStatus = 'pending' | 'in_progress' | 'suspended' | 'completed' | 'cancelled';

export interface TaskEdge {
  id: string;
  name: string;
  source: string;
  target: string;
  status: TaskEdgeStatus;
}

export interface GoalGraphData {
  goals: GoalNode[];
  tasks: TaskEdge[];
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

const GOAL_GRAPH_STORAGE_KEY = 'exomind:goal-graph';

export function loadGoalGraph(): GoalGraphData {
  if (typeof window === 'undefined') return createExampleData();
  try {
    const raw = window.localStorage.getItem(GOAL_GRAPH_STORAGE_KEY);
    if (!raw) return createExampleData();
    const parsed = JSON.parse(raw) as GoalGraphData;
    if (!Array.isArray(parsed.goals) || !Array.isArray(parsed.tasks)) {
      return createExampleData();
    }
    return parsed;
  } catch {
    return createExampleData();
  }
}

export function saveGoalGraph(data: GoalGraphData): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GOAL_GRAPH_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors.
  }
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let idCounter = 0;

export function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Example / seed data
// ---------------------------------------------------------------------------

export function createExampleData(): GoalGraphData {
  const meId = 'goal-me';
  const tsId = 'goal-ts';
  const projectId = 'goal-project';
  const fullstackId = 'goal-fullstack';

  return {
    goals: [
      { id: meId, name: 'Me', status: 'pending', achieveMode: 'AND', isMe: true },
      { id: tsId, name: '掌握 TypeScript', status: 'pending', achieveMode: 'AND', isMe: false },
      { id: projectId, name: '获得实战经验', status: 'pending', achieveMode: 'AND', isMe: false },
      { id: fullstackId, name: '成为全栈工程师', status: 'pending', achieveMode: 'AND', isMe: false },
    ],
    tasks: [
      { id: 'task-1', name: '学习基础知识', source: meId, target: tsId, status: 'in_progress' },
      { id: 'task-2', name: '完成项目 A', source: meId, target: projectId, status: 'pending' },
      { id: 'task-3', name: '整合前后端技能', source: tsId, target: fullstackId, status: 'pending' },
      { id: 'task-4', name: '参与开源项目', source: projectId, target: fullstackId, status: 'pending' },
    ],
  };
}
