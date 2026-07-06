export type IntentProgramState =
  | 'draft'
  | 'authored'
  | 'delegated'
  | 'running'
  | 'awaiting_review'
  | 'accepted'
  | 'overridden'
  | 'paused'
  | 'expired'
  | 'needs_reauthoring'
  | 'retired';

export type IntentProgramLane = 'A' | 'B';

export type IntentProgramRunState =
  | 'running'
  | 'awaiting_review'
  | 'accepted'
  | 'overridden'
  | 'rejected';

export type RecertificationVerdict = 'pass' | 'partial' | 'fail';

export interface IntentProgramHumanGate {
  requiredWhen: string[];
  reason: string;
}

export interface IntentProgramGuardrail {
  id: string;
  label: string;
  kind: 'tool_allowlist' | 'input_scope' | 'output_scope' | 'human_gate' | 'truth_write';
  enforced: boolean;
}

export interface IntentProgramRecertification {
  cadenceDays: number;
  nextReviewAt: string;
  lastReviewedAt?: string;
  lastVerdict?: RecertificationVerdict;
  lastNote?: string;
}

export interface IntentProgramRunRecord {
  id: string;
  programId: string;
  startedAt: string;
  completedAt?: string;
  state: IntentProgramRunState;
  inputSnapshot: string;
  executorSnapshot: string[];
  machineOutput: string;
  humanOutput?: string;
  decisionNote?: string;
  verificationSnapshot: string;
}

export interface IntentProgram {
  id: string;
  title: string;
  author: string;
  authoredAt: string;
  state: IntentProgramState;
  lane: IntentProgramLane;
  intent: string;
  trigger: string;
  inputs: string[];
  executors: string[];
  forbidden: string[];
  guardrails: IntentProgramGuardrail[];
  verification: string[];
  sourcePolicy: string;
  humanGate: IntentProgramHumanGate;
  output: string;
  truthPolicy: string;
  overridePolicy: string;
  logPolicy: string;
  recertification: IntentProgramRecertification;
  runs: IntentProgramRunRecord[];
}

export interface IntentProgramMetrics {
  total: number;
  delegated: number;
  awaitingHumanReview: number;
  needsReauthoring: number;
  averageSovereigntyScore: number;
}

export interface IntentProgramAuditEvent {
  id: string;
  timestamp: number;
  content: string;
  tags: string[];
}

export interface IntentProgramStorage {
  read(): Promise<IntentProgram[] | null>;
  write(programs: IntentProgram[]): Promise<void>;
}

export interface RecertifyIntentProgramInput {
  verdict: RecertificationVerdict;
  note: string;
}
