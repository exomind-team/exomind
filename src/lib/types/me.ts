export type MeViewType = 'status' | 'learn' | 'implicit'; // me views（三个视图）

export interface MeStatusMetric {
  id: string;
  title: string;
  value: string;
  hint: string;
  tone: 'warm' | 'green' | 'blue' | 'amber' | 'rose';
}

export interface MeBehaviorPattern {
  id: string;
  title: string;
  streakText: string;
  state: 'good' | 'warn' | 'risk';
}

export interface MePatternHistoryItem {
  id: string;
  title: string;
  detail: string;
  deltaText: string;
  deltaTone: 'up' | 'down' | 'flat';
}

export interface MeStatusData {
  summaryTitle: string;
  updatedAtLabel: string;
  metrics: MeStatusMetric[];
  financeMetrics: MeStatusMetric[];
  behaviorCompletionText: string;
  behaviorPatterns: MeBehaviorPattern[];
  historyItems: MePatternHistoryItem[];
}

export interface MeLearningItem {
  id: string;
  title: string;
  source: string;
  priorityText: string;
  tone: 'warm' | 'blue' | 'purple';
}

export interface MeKnowledgeLane {
  id: string;
  title: string;
  countText: string;
  progressText: string;
  tags: string[];
}

export interface MeLearnData {
  urgentItems: MeLearningItem[];
  lanes: MeKnowledgeLane[];
}

export interface MeImplicitNode {
  id: string;
  label: string;
  x: number;
  y: number;
  emphasis: 'primary' | 'secondary' | 'tertiary';
}

export interface MeHabitLoop {
  id: string;
  name: string;
  cue: string;
  routine: string;
  reward: string;
  frequencyText: string;
  state: 'good' | 'warn' | 'risk';
}

export interface MeImplicitData {
  beliefNodes: MeImplicitNode[];
  habitLoops: MeHabitLoop[];
}

export interface MeDashboardData {
  status: MeStatusData;
  learn: MeLearnData;
  implicit: MeImplicitData;
}

